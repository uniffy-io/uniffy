from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import delete, event, select, update
from sqlalchemy.orm import with_loader_criteria
from uniffy_proto.calls.v1.calls_pb import CallInvitationOutcome as ProtoOutcome

from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models.calls import Call, CallInvitation, CallInvitationOutcome
from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.models.chat.channel_member import ChatChannelMember
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.search import SEARCH_INDEXER_CTX_KEY
from uniffy.core.types import AccessMode, ContentType, SubjectType
from uniffy.domains.calls import invitations as invitation_module
from uniffy.domains.calls.history import CallHistoryReader
from uniffy.domains.calls.invitations import CallInvitations
from uniffy.domains.calls.jobs import history as history_jobs
from uniffy.domains.calls.operations import CallOperations
from uniffy.domains.calls.search import stage_channel_history_refresh
from uniffy.domains.permissions.access.resolver import ResourceAccessResolver
from uniffy.domains.permissions.access.types import ResourceAccessPurpose, ResourceKey
from uniffy.infrastructure.database import open_session
from uniffy.tests.integration.access.call_contention import contend
from uniffy.tests.integration.access.calls import (
    _auth_session,
    _call,
    _participant,
)
from uniffy.tests.integration.access.calls import call_publication as call_publication
from uniffy.tests.integration.access.calls import livekit as livekit

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def invite(session, call, user_id, *, expired=False):
    row = CallInvitation(
        call_id=call.id,
        user_id=user_id,
        organization_id=call.organization_id,
        expires_at=datetime.now(UTC) + timedelta(seconds=-1 if expired else 30),
    )
    session.add(row)
    session.add(
        ChatChannelMember(
            channel_id=call.channel_id,
            subject_type=SubjectType.USER,
            subject_id=user_id,
            user_id=user_id,
        )
    )
    await session.commit()
    return row


async def test_invitation_outcomes_preserve_late_attendance(session, access):
    call = await _call(session, access)
    row = await invite(session, call, access.member_id)
    ops = CallInvitations(session)
    await ops.decline(access.member_id, access.org_id, call.id)
    await ops.decline(access.member_id, access.org_id, call.id)
    await ops.stage_answer(call.id, access.member_id)
    await session.commit()
    await session.refresh(row)
    assert row.outcome == CallInvitationOutcome.DECLINED
    await _participant(session, call, access.member_id)
    record, people, _ = await CallHistoryReader(session).get_record(
        access.member_id, access.org_id, call.id
    )
    assert record.attended
    assert record.invitation_outcome == ProtoOutcome.DECLINED
    assert len(people) == 2


async def test_answer_and_expiry_are_terminal(session, access):
    call = await _call(session, access)
    row = await invite(session, call, access.member_id)
    ops = CallInvitations(session)
    await ops.stage_answer(call.id, access.member_id)
    await session.commit()
    await ops.decline(access.member_id, access.org_id, call.id)
    await session.refresh(row)
    assert row.outcome == CallInvitationOutcome.ANSWERED
    row.outcome = CallInvitationOutcome.RINGING
    row.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    await session.commit()
    await ops.stage_answer(call.id, access.member_id)
    await session.commit()
    await session.refresh(row)
    assert row.outcome == CallInvitationOutcome.MISSED


async def test_history_gates_before_paging_and_deduplicates_devices(session, access):
    call = await _call(session, access)
    await _participant(session, call, access.owner_id, device="second")
    reader = CallHistoryReader(session)
    records, cursor = await reader.list_history(access.member_id, access.org_id)
    assert not records
    with pytest.raises(PermissionDeniedError):
        await reader.get_record(access.member_id, access.org_id, call.id)
    record, people, _ = await reader.get_record(access.owner_id, access.org_id, call.id)
    assert record.participant_count == 1
    assert len(people) == 1
    await invite(session, call, access.member_id)
    records, _ = await CallHistoryReader(session).list_history(access.member_id, access.org_id)
    assert [r.call.id for r in records] == [str(call.id)]
    await session.execute(
        delete(ChatChannelMember).where(
            ChatChannelMember.channel_id == call.channel_id,
            ChatChannelMember.subject_id == access.member_id,
        )
    )
    await session.commit()
    records, _ = await CallHistoryReader(session).list_history(access.member_id, access.org_id)
    assert not records
    key = ResourceKey(ContentType.CALL, call.id)
    decision = (
        await ResourceAccessResolver(session).resolve(
            actor_id=access.member_id,
            organization_id=access.org_id,
            keys=[key],
            purpose=ResourceAccessPurpose.LIST,
        )
    )[key]
    assert not decision.can_view


async def test_history_paging_public_archived_and_deactivation(session, access):
    first = await _call(session, access)
    first.ended_at = datetime.now(UTC)
    await session.commit()
    second = await _call(session, access)
    reader = CallHistoryReader(session)
    page, cursor = await reader.list_history(access.owner_id, access.org_id, page_size=1)
    assert page[0].call.id == str(second.id)
    page, cursor = await reader.list_history(
        access.owner_id, access.org_id, page_size=1, cursor=cursor
    )
    assert page[0].call.id == str(first.id)
    assert not cursor
    await session.execute(
        update(ChatChannel)
        .where(ChatChannel.id == first.channel_id)
        .values(channel_type=ChannelType.PUBLIC, is_archived=True)
    )
    await session.commit()
    page, _ = await CallHistoryReader(session).list_history(
        access.member_id, access.org_id, channel_id=first.channel_id
    )
    assert page[0].call.id == str(first.id)
    await session.execute(
        update(OrganizationMember)
        .where(
            OrganizationMember.organization_id == access.org_id,
            OrganizationMember.user_id == access.member_id,
        )
        .values(is_active=False)
    )
    await session.commit()
    with pytest.raises(PermissionDeniedError):
        await CallHistoryReader(session).get_record(access.member_id, access.org_id, first.id)


async def test_invitation_nonrecipient_and_end_settlement(
    session, access, livekit, call_publication
):
    call = await _call(session, access)
    pending = await invite(session, call, access.member_id)
    with pytest.raises(PermissionDeniedError):
        await CallInvitations(session).decline(access.owner_id, access.org_id, call.id)
    await session.rollback()
    await session.refresh(call)
    await CallOperations(session).end_call(access.owner_id, access.org_id, call.id)
    await session.refresh(pending)
    assert pending.outcome == CallInvitationOutcome.MISSED
    await CallInvitations(session).decline(access.member_id, access.org_id, call.id)
    assert pending.outcome == CallInvitationOutcome.MISSED


async def test_join_competes_with_decline_without_losing_attendance(
    session, access, livekit, call_publication
):
    call = await _call(session, access)
    invitation = await invite(session, call, access.member_id)
    auth = await _auth_session(session, access.member_id, access.org_id)
    outcomes = await contend(
        select(Call).where(Call.id == call.id).with_for_update(),
        [
            lambda worker: CallOperations(worker).join_call(
                access.member_id, access.org_id, call.id, "phone", auth_session_id=auth.id
            ),
            lambda worker: CallInvitations(worker).decline(access.member_id, access.org_id, call.id),
        ],
    )
    assert not any(isinstance(result, Exception) for result in outcomes)
    await session.refresh(invitation)
    assert invitation.outcome in {CallInvitationOutcome.ANSWERED, CallInvitationOutcome.DECLINED}
    record, _, _ = await CallHistoryReader(session).get_record(
        access.member_id, access.org_id, call.id
    )
    assert record.attended
    assert record.participant_count == 2
    previous = invitation.outcome
    await CallInvitations(session).decline(access.member_id, access.org_id, call.id)
    await session.refresh(invitation)
    assert invitation.outcome == previous


async def test_projection_retries_and_uses_current_parent_access(session, access, monkeypatch):
    call = await _call(session, access)
    writer = AsyncMock()
    writer.index.side_effect = RuntimeError("index unavailable")
    monkeypatch.setattr(history_jobs, "open_session", scoped_history_sessions(access.org_id))
    await history_jobs.flush_call_history({SEARCH_INDEXER_CTX_KEY: writer})
    await session.refresh(call)
    assert call.search_pending
    writer.index.side_effect = None
    await history_jobs.flush_call_history({SEARCH_INDEXER_CTX_KEY: writer})
    await session.refresh(call)
    assert not call.search_pending
    assert writer.index.call_args.kwargs["shared_user_ids"] == [access.owner_id]
    await session.execute(
        update(ChatChannel)
        .where(ChatChannel.id == call.channel_id)
        .values(channel_type=ChannelType.PUBLIC)
    )
    await stage_channel_history_refresh(session, call.channel_id)
    await session.commit()
    await history_jobs.flush_call_history({SEARCH_INDEXER_CTX_KEY: writer})
    assert writer.index.call_args.kwargs["access_mode"] == AccessMode.OPEN_TO_ORG.value
    await session.execute(
        update(ChatChannel).where(ChatChannel.id == call.channel_id).values(is_deleted=True)
    )
    await stage_channel_history_refresh(session, call.channel_id)
    await session.commit()
    await history_jobs.flush_call_history({SEARCH_INDEXER_CTX_KEY: writer})
    writer.remove.assert_awaited_with(call.urn)
    key = ResourceKey(ContentType.CALL, call.id)
    decision = (
        await ResourceAccessResolver(session).resolve(
            actor_id=access.owner_id,
            organization_id=access.org_id,
            keys=[key],
            purpose=ResourceAccessPurpose.REFERENCE,
        )
    )[key]
    assert not decision.can_view


def scoped_history_sessions(organization_id):
    @asynccontextmanager
    async def scoped():
        async with open_session() as session:

            def restrict(state):
                if state.is_select:
                    state.statement = state.statement.options(
                        with_loader_criteria(Call, Call.organization_id == organization_id)
                    )

            event.listen(session.sync_session, "do_orm_execute", restrict)
            try:
                yield session
            finally:
                event.remove(session.sync_session, "do_orm_execute", restrict)

    return scoped


async def test_cross_org_history_and_expired_invitation(session, access):
    call = await _call(session, access)
    row = await invite(session, call, access.member_id, expired=True)
    with pytest.raises(NotFoundError):
        await CallHistoryReader(session).get_record(access.outsider_id, access.other_org_id, call.id)
    record, _, _ = await CallHistoryReader(session).get_record(
        access.member_id, access.org_id, call.id
    )
    assert record.invitation_outcome == ProtoOutcome.MISSED
    assert row.outcome == CallInvitationOutcome.RINGING
    await CallInvitations(session).expire()
    await session.refresh(row)
    assert row.outcome == CallInvitationOutcome.MISSED


async def test_suppressed_calls_do_not_create_missed_invitations(session, access, monkeypatch):
    call = await _call(session, access)
    session.add(
        ChatChannelMember(
            channel_id=call.channel_id,
            subject_type=SubjectType.USER,
            subject_id=access.member_id,
            user_id=access.member_id,
        )
    )
    await session.commit()
    monkeypatch.setattr(invitation_module, "SILENT_JOIN_MEMBER_THRESHOLD", 2)
    channel = await session.get(ChatChannel, call.channel_id)
    await CallInvitations(session).stage_recipients(call, channel)
    await session.commit()
    assert not list(
        await session.scalars(select(CallInvitation).where(CallInvitation.call_id == call.id))
    )
