import asyncio
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import func, select, text

from uniffy.core.database import SESSION_FACTORY_CTX_KEY
from uniffy.core.errors import NotFoundError
from uniffy.core.events.bus import emit_notification, event_from_json
from uniffy.core.events.types import NotificationEvent
from uniffy.core.models.agents.chat_trigger import AgentChatTrigger, ChatTriggerStatus
from uniffy.core.models.chat.channel import ChatChannel
from uniffy.core.models.chat.channel_resource import ChatChannelResource
from uniffy.core.models.chat.delivery import ChatDelivery, ChatDeliveryEffect, ChatDeliveryStatus
from uniffy.core.models.chat.draft import ChatDraft
from uniffy.core.models.chat.message import ChatMessage, SenderType
from uniffy.core.models.notifications.outbox import NotificationOutbox
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.search import SEARCH_INDEXER_CTX_KEY
from uniffy.core.types import ContentType, NotificationType, generate_id
from uniffy.domains.agents.bridge import triggers as admission
from uniffy.domains.agents.bridge.jobs import triggers as invocations
from uniffy.domains.chat.delivery_operations import retry_failed_delivery
from uniffy.domains.chat.jobs import delivery
from uniffy.domains.chat.messages import outbox, sending
from uniffy.domains.chat.messages.operations import ChatMessageOperations
from uniffy.domains.chat.resources.operations import ChatResourceOperations
from uniffy.infrastructure.database import open_session

pytestmark = pytest.mark.asyncio(loop_scope="session")


@pytest.fixture
def context(monkeypatch):
    monkeypatch.setattr(delivery, "publish_user_chat_events", AsyncMock())
    monkeypatch.setattr(delivery, "invalidate_cached_channel_resources", AsyncMock())
    monkeypatch.setattr(delivery, "enqueue_job", AsyncMock())
    monkeypatch.setattr(delivery, "wake_chat_triggers", AsyncMock())
    indexer = MagicMock(index=AsyncMock(), search=MagicMock(delete_document=AsyncMock()))
    return {SESSION_FACTORY_CTX_KEY: open_session, SEARCH_INDEXER_CTX_KEY: indexer}


async def stage(session, threads, effect):
    row = ChatDelivery(message_id=threads.root_b_id, organization_id=threads.org_id, effect=effect)
    session.add(row)
    await session.commit()
    return row


async def test_send_commits_work_despite_queue_failure(threads, session, monkeypatch):
    monkeypatch.setattr(sending, "check_chat_mutation_limit", AsyncMock())
    monkeypatch.setattr(outbox, "enqueue_job", AsyncMock(side_effect=ConnectionError()))
    monkeypatch.setattr(ChatMessageOperations, "_publish_send_event", AsyncMock())
    async with open_session() as transaction:
        message, _, _ = await ChatMessageOperations(transaction).send_message(
            user_id=threads.user_id,
            organization_id=threads.org_id,
            channel_id=threads.channel_id,
            content="durable message",
            client_message_id=generate_id(),
        )
    rows = (
        await session.scalars(select(ChatDelivery).where(ChatDelivery.message_id == message.id))
    ).all()
    assert {row.effect for row in rows} == set(ChatDeliveryEffect)
    assert await session.get(ChatMessage, message.id) is not None


async def test_delivery_intent_rolls_back_with_message(threads, session):
    mid = generate_id()
    async with open_session() as transaction:
        message = ChatMessage(
            id=mid, channel_id=threads.channel_id, sender_id=threads.user_id, content="rollback"
        )
        transaction.add(message)
        await transaction.flush()
        await outbox.stage_message_delivery(transaction, message, threads.org_id)
        await transaction.flush()
        await transaction.rollback()
    assert await session.get(ChatMessage, mid) is None
    assert (
        await session.scalar(
            select(func.count()).select_from(ChatDelivery).where(ChatDelivery.message_id == mid)
        )
        == 0
    )


async def test_effects_checkpoint_independently_and_notification_is_not_repeated(
    threads, session, context, monkeypatch
):
    message = await session.get(ChatMessage, threads.root_b_id)
    await outbox.stage_message_delivery(session, message, threads.org_id)
    await session.commit()
    monkeypatch.setattr(delivery, "stage_chat_triggers", AsyncMock(return_value=[]))
    context[SEARCH_INDEXER_CTX_KEY].index.side_effect = ConnectionError("search down")

    async def prepare(self, *args, **kwargs):
        await emit_notification(
            NotificationEvent(
                organization_id=threads.org_id,
                actor_id=threads.user_id,
                notification_type=NotificationType.CHAT_MENTION,
                title="test",
                content_type=ContentType.CHAT_MESSAGE,
                content_id=message.id,
                target_user_ids=[threads.user_id],
            )
        )
        return []

    monkeypatch.setattr(ChatMessageOperations, "prepare_delivery_notifications", prepare)
    await delivery.deliver_chat_message(context, str(message.id))
    await session.refresh(message)
    rows = (
        await session.scalars(select(ChatDelivery).where(ChatDelivery.message_id == message.id))
    ).all()
    assert len(rows) == 1 and rows[0].effect == ChatDeliveryEffect.INDEX
    assert rows[0].attempts == 1 and rows[0].last_error == "ConnectionError"
    events = (
        await session.scalars(
            select(NotificationOutbox).where(NotificationOutbox.organization_id == threads.org_id)
        )
    ).all()
    assert len(events) == 1
    assert event_from_json(events[0].payload).content_id == message.id
    rows[0].available_at = datetime.now(UTC) - timedelta(seconds=1)
    await session.commit()
    context[SEARCH_INDEXER_CTX_KEY].index.side_effect = None
    await asyncio.gather(
        *(delivery.deliver_chat_message(context, str(message.id)) for _ in range(2))
    )
    assert (
        await session.scalar(
            select(func.count())
            .select_from(ChatDelivery)
            .where(ChatDelivery.message_id == message.id)
        )
        == 0
    )
    assert (
        await session.scalar(
            select(func.count())
            .select_from(NotificationOutbox)
            .where(NotificationOutbox.organization_id == threads.org_id)
        )
        == 1
    )
    assert context[SEARCH_INDEXER_CTX_KEY].index.await_count == 2


async def test_failed_preparation_rolls_back_notification_events(
    threads, session, context, monkeypatch
):
    await stage(session, threads, ChatDeliveryEffect.NOTIFICATIONS)

    async def prepare(self, *args, **kwargs):
        await emit_notification(
            NotificationEvent(
                organization_id=threads.org_id,
                notification_type=NotificationType.CHAT_MENTION,
                title="rollback",
                actor_id=threads.user_id,
                target_user_ids=[threads.user_id],
            )
        )
        raise RuntimeError("after event staging")

    monkeypatch.setattr(ChatMessageOperations, "prepare_delivery_notifications", prepare)
    await delivery.deliver_chat_message(context, str(threads.root_b_id))
    assert (
        await session.scalar(
            select(func.count())
            .select_from(NotificationOutbox)
            .where(NotificationOutbox.organization_id == threads.org_id)
        )
        == 0
    )
    row = await session.get(ChatDelivery, (threads.root_b_id, ChatDeliveryEffect.NOTIFICATIONS))
    assert row.attempts == 1 and row.last_error == "RuntimeError"


@pytest.mark.parametrize("newer", [False, True])
async def test_delayed_delivery_preserves_newer_draft(threads, session, context, newer):
    message = await session.get(ChatMessage, threads.root_b_id)
    draft = ChatDraft(
        user_id=threads.user_id,
        organization_id=threads.org_id,
        channel_id=threads.channel_id,
        content="draft",
        updated_at=message.created_at + timedelta(seconds=1 if newer else -1),
    )
    session.add(draft)
    await stage(session, threads, ChatDeliveryEffect.NOTIFICATIONS)
    await delivery.deliver_chat_message(context, str(message.id))
    draft_id = draft.id
    session.expunge(draft)
    assert (await session.get(ChatDraft, draft_id) is not None) == newer


async def test_exhausted_effect_is_visible_and_retry_is_tenant_scoped(threads, session, context):
    row = await stage(session, threads, ChatDeliveryEffect.INDEX)
    row.attempts = delivery.MAX_DELIVERY_ATTEMPTS - 1
    await session.commit()
    context[SEARCH_INDEXER_CTX_KEY].index.side_effect = ConnectionError()
    await delivery.deliver_chat_message(context, str(threads.root_b_id))
    session.expire_all()
    row = await session.get(ChatDelivery, (threads.root_b_id, ChatDeliveryEffect.INDEX))
    assert row.status == ChatDeliveryStatus.FAILED
    with pytest.raises(NotFoundError):
        await retry_failed_delivery(
            session,
            organization_id=generate_id(),
            message_id=row.message_id,
            effect=ChatDeliveryEffect.INDEX,
            operator="tester",
            reason="recovered",
        )
    await session.rollback()
    await retry_failed_delivery(
        session,
        organization_id=threads.org_id,
        message_id=threads.root_b_id,
        effect=ChatDeliveryEffect.INDEX,
        operator="tester",
        reason="recovered",
    )
    assert row.status == ChatDeliveryStatus.PENDING and row.attempts == 0


async def test_recovery_retries_after_queue_outage(threads, session, context, monkeypatch):
    await stage(session, threads, ChatDeliveryEffect.INDEX)
    enqueue = AsyncMock(side_effect=ConnectionError())
    monkeypatch.setattr(delivery, "enqueue_job", enqueue)
    await delivery.recover_chat_deliveries(context)
    assert any(call.args[1] == str(threads.root_b_id) for call in enqueue.await_args_list)
    session.expire_all()
    row = await session.get(ChatDelivery, (threads.root_b_id, ChatDeliveryEffect.INDEX))
    assert row.attempts == 0 and row.status == ChatDeliveryStatus.PENDING
    row.dispatched_at = datetime.now(UTC) - timedelta(minutes=1)
    await session.commit()
    enqueue.reset_mock()
    enqueue.side_effect = None
    await delivery.recover_chat_deliveries(context)
    assert any(call.args[1] == str(threads.root_b_id) for call in enqueue.await_args_list)


async def test_agent_admission_is_unique_and_duplicate_jobs_start_once(
    threads, session, context, monkeypatch
):
    monkeypatch.setattr(admission, "is_chat_agents_enabled", AsyncMock(return_value=True))
    monkeypatch.setattr(
        admission,
        "detect_agent_mentions",
        AsyncMock(return_value=[SimpleNamespace(agent_id=threads.agent_id, rule="mention")]),
    )
    message = await session.get(ChatMessage, threads.root_b_id)
    channel = await session.get(ChatChannel, threads.channel_id)
    ids = await admission.stage_chat_triggers(session, message, channel)
    await session.commit()
    assert await admission.stage_chat_triggers(session, message, channel) == []
    await session.commit()
    monkeypatch.setattr(invocations, "is_chat_agents_enabled", AsyncMock(return_value=True))
    invoke = AsyncMock()
    monkeypatch.setattr(invocations.AgentChatBridge, "respond_to_chat_message", invoke)
    for key in (
        invocations.OBJECT_STORAGE_CTX_KEY,
        invocations.UPDATE_BUFFER_CTX_KEY,
        invocations.CALL_LIFECYCLE_CTX_KEY,
    ):
        context[key] = MagicMock()
    await asyncio.gather(*(invocations.deliver_chat_trigger(context, str(ids[0])) for _ in range(2)))
    trigger = await session.get(AgentChatTrigger, ids[0])
    assert trigger.status == ChatTriggerStatus.COMPLETED
    invoke.assert_awaited_once()
    assert invoke.await_args.kwargs["run_id"] == trigger.run_id


async def test_interrupted_agent_is_not_automatically_replayed(
    threads, session, context, monkeypatch
):
    trigger = AgentChatTrigger(
        organization_id=threads.org_id,
        message_id=threads.root_b_id,
        agent_id=threads.agent_id,
        rule="mention",
        status=ChatTriggerStatus.RUNNING,
        available_at=datetime.now(UTC) - timedelta(seconds=1),
    )
    session.add(trigger)
    await session.commit()
    enqueue = AsyncMock()
    monkeypatch.setattr(invocations, "enqueue_job_reconnecting", enqueue)
    await invocations.recover_chat_triggers(context)
    await session.refresh(trigger)
    assert (
        trigger.status == ChatTriggerStatus.UNCERTAIN and trigger.last_error == "WorkerInterrupted"
    )
    assert not any(call.args[1] == str(trigger.id) for call in enqueue.await_args_list)


async def test_delivery_tables_have_bounded_vacuum_thresholds(session):
    rows = (
        await session.execute(
            text(
                "SELECT relname, reloptions FROM pg_class WHERE relname IN ('chat_deliveries', 'agents_chat_triggers')"
            )
        )
    ).all()
    assert len(rows) == 2
    for _, options in rows:
        assert "autovacuum_vacuum_threshold=1000" in options
        assert any(option.startswith("autovacuum_vacuum_max_threshold=") for option in options)


@pytest.mark.parametrize("delivered_first", [False, True])
async def test_edit_and_delivery_count_resource_once(
    threads, session, context, monkeypatch, delivered_first
):
    urn = f"urn:uniffy:content:NOTE:{generate_id()}"
    message = await session.get(ChatMessage, threads.root_b_id)
    message.content = f"[[[note|{urn}]]] initial"
    message.created_at = datetime.now(UTC)
    await stage(session, threads, ChatDeliveryEffect.RESOURCES)
    if delivered_first:
        await delivery.deliver_chat_message(context, str(threads.root_b_id))
    monkeypatch.setattr(ChatMessageOperations, "_index_message", AsyncMock())
    await ChatMessageOperations(session).update_message(
        threads.user_id,
        threads.org_id,
        threads.channel_id,
        threads.root_b_id,
        f"[[[note|{urn}]]] edited",
    )
    await delivery.deliver_chat_message(context, str(threads.root_b_id))
    assert (
        await session.scalar(
            select(ChatChannelResource.mention_count).where(
                ChatChannelResource.channel_id == threads.channel_id,
                ChatChannelResource.urn == urn,
            )
        )
        == 1
    )


@pytest.mark.parametrize("revoked", [False, True])
async def test_agent_rechecks_deleted_message_and_membership(
    threads, session, context, monkeypatch, revoked
):
    trigger = AgentChatTrigger(
        organization_id=threads.org_id,
        message_id=threads.root_b_id,
        agent_id=threads.agent_id,
        rule="mention",
    )
    session.add(trigger)
    if revoked:
        member = await session.scalar(
            select(OrganizationMember).where(
                OrganizationMember.organization_id == threads.org_id,
                OrganizationMember.user_id == threads.user_id,
            )
        )
        member.is_active = False
    else:
        message = await session.get(ChatMessage, threads.root_b_id)
        message.is_deleted = True
    await session.commit()
    monkeypatch.setattr(invocations, "is_chat_agents_enabled", AsyncMock(return_value=True))
    invoke = AsyncMock()
    monkeypatch.setattr(invocations.AgentChatBridge, "respond_to_chat_message", invoke)
    await invocations.deliver_chat_trigger(context, str(trigger.id))
    await session.refresh(trigger)
    assert trigger.status == ChatTriggerStatus.SKIPPED
    invoke.assert_not_awaited()


@pytest.mark.parametrize("sender_type", list(SenderType))
async def test_cached_insert_preserves_sender_effects(threads, session, sender_type):
    message = await session.get(ChatMessage, threads.root_b_id)
    message.sender_type = sender_type
    await outbox.stage_message_delivery(session, message, threads.org_id)
    await session.commit()
    effects = set(
        await session.scalars(
            select(ChatDelivery.effect).where(ChatDelivery.message_id == message.id)
        )
    )
    expected = {ChatDeliveryEffect.NOTIFICATIONS, ChatDeliveryEffect.RESOURCES}
    if sender_type != SenderType.SYSTEM:
        expected.add(ChatDeliveryEffect.INDEX)
    if sender_type == SenderType.USER:
        expected.add(ChatDeliveryEffect.AGENTS)
    assert effects == expected


@pytest.mark.parametrize("delivered_first", [False, True])
async def test_deleting_delayed_message_preserves_other_resource_mentions(
    threads, session, context, delivered_first
):
    urn = f"urn:uniffy:content:NOTE:{generate_id()}"
    content = f"[[[note|{urn}]]]"
    message = await session.get(ChatMessage, threads.root_b_id)
    message.content = content
    await ChatResourceOperations(session).stage_resources_from_message(
        threads.channel_id, content, threads.user_id
    )
    await stage(session, threads, ChatDeliveryEffect.RESOURCES)
    if delivered_first:
        await delivery.deliver_chat_message(context, str(threads.root_b_id))
    context[SEARCH_INDEXER_CTX_KEY].remove = AsyncMock()
    await ChatMessageOperations(
        session, storage=MagicMock(), search_indexer=context[SEARCH_INDEXER_CTX_KEY]
    ).delete_message(
        threads.user_id,
        threads.org_id,
        threads.channel_id,
        threads.root_b_id,
    )
    await delivery.deliver_chat_message(context, str(threads.root_b_id))
    assert (
        await session.scalar(
            select(ChatChannelResource.mention_count).where(
                ChatChannelResource.channel_id == threads.channel_id,
                ChatChannelResource.urn == urn,
            )
        )
        == 1
    )
