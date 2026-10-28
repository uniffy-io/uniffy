"""A member's one-person conversation, proven on real rows: one per member, owner-only."""

import asyncio
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import exists, func, select

from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models.chat.channel import ChatChannel
from uniffy.core.models.chat.channel_category import ChatChannelCategory
from uniffy.core.models.chat.channel_member import ChatChannelMember
from uniffy.core.models.chat.message import ChatMessage, SenderType
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.permissions.domain_admin import DomainAdmin
from uniffy.core.search import SearchIndexer
from uniffy.core.search.policy import build_document_id
from uniffy.core.search.workspace import WorkspaceSearch
from uniffy.core.types import ContentType, DomainType, generate_id
from uniffy.domains.chat.access import ChatAccessChecker
from uniffy.domains.chat.categories.operations import ChatCategoryOperations
from uniffy.domains.chat.channels.operations import ChatChannelOperations
from uniffy.domains.chat.cleanup import cleanup_chat_membership_for_organization
from uniffy.domains.chat.messages.operations import ChatMessageOperations
from uniffy.domains.chat.reads.operations import ChatReadStateOperations
from uniffy.domains.chat.subjects import ChatSubject
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.domains.permissions.access import (
    ResourceAccessPurpose,
    ResourceAccessResolver,
    ResourceKey,
)
from uniffy.domains.search.operations import SearchOperations
from uniffy.domains.search.queries import UrnAvailability
from uniffy.infrastructure.database import open_session
from uniffy.infrastructure.search import MeiliSearchEngine
from uniffy.tests.integration.access.recording_search import recording_indexer

pytestmark = pytest.mark.asyncio(loop_scope="session")


def _operations(session) -> ChatChannelOperations:
    return ChatChannelOperations(session, search_indexer=recording_indexer())


async def _open(user_id, org_id):
    async with open_session() as session:
        channel = await _operations(session).open_self_dm(user_id, org_id)
        return channel.id


async def _live_self_dm_ids(session, access, user_id) -> list:
    return list(
        (
            await session.execute(
                select(ChatChannel.id).where(
                    ChatChannel.organization_id == access.org_id,
                    ChatChannel.owner_id == user_id,
                    ChatChannel.is_self_dm.is_(True),
                    ChatChannel.is_deleted.is_(False),
                )
            )
        )
        .scalars()
        .all()
    )


async def _post(session, channel: ChatChannel, content: str) -> ChatMessage:
    message = ChatMessage(
        channel_id=channel.id,
        sender_id=channel.owner_id,
        sender_type=SenderType.USER,
        content=content,
    )
    session.add(message)
    await session.commit()
    return message


async def test_concurrent_first_opens_converge_on_one_row(session, access) -> None:
    first, second = await asyncio.gather(
        _open(access.member_id, access.org_id),
        _open(access.member_id, access.org_id),
    )
    again = await _open(access.member_id, access.org_id)

    assert first == second == again
    assert await _live_self_dm_ids(session, access, access.member_id) == [first]
    members = (
        await session.execute(
            select(ChatChannelMember.subject_id).where(ChatChannelMember.channel_id == first)
        )
    ).scalars()
    assert list(members) == [access.member_id]


async def test_removal_waits_for_first_open_and_deletes_its_conversation(
    session, access, monkeypatch
) -> None:
    opening = asyncio.Event()
    resume = asyncio.Event()
    removing = asyncio.Event()
    find_self_dm = ChatChannelOperations._find_self_dm

    async def paused_find(operations, organization_id, user_id):
        if not opening.is_set():
            opening.set()
            await resume.wait()
        return await find_self_dm(operations, organization_id, user_id)

    monkeypatch.setattr(ChatChannelOperations, "_find_self_dm", paused_find)

    async def remove_member():
        async with open_session() as remover:
            removing.set()
            return await OrganizationOperations(remover).remove_member(
                access.owner_id,
                access.org_id,
                access.member_id,
                search_indexer=recording_indexer(),
                call_lifecycle=AsyncMock(),
            )

    open_task = asyncio.create_task(_open(access.member_id, access.org_id))
    remove_task = None
    try:
        await asyncio.wait_for(opening.wait(), timeout=5)
        remove_task = asyncio.create_task(remove_member())
        await asyncio.wait_for(removing.wait(), timeout=5)
        done, _ = await asyncio.wait({remove_task}, timeout=0.2)
        assert not done
        resume.set()
        channel_id, removed = await asyncio.wait_for(
            asyncio.gather(open_task, remove_task), timeout=10
        )
    finally:
        resume.set()
        tasks = [task for task in (open_task, remove_task) if task is not None]
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    assert removed is True
    membership = await session.scalar(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == access.org_id,
            OrganizationMember.user_id == access.member_id,
        )
    )
    assert membership is not None
    assert membership.is_active is False
    assert membership.removed_at is not None
    assert (
        await session.scalar(select(ChatChannel.is_deleted).where(ChatChannel.id == channel_id))
        is True
    )
    assert (
        await session.scalar(
            select(ChatChannelMember.subject_id).where(ChatChannelMember.channel_id == channel_id)
        )
        is None
    )
    with pytest.raises(PermissionDeniedError):
        await _operations(session).open_self_dm(access.member_id, access.org_id)


async def test_a_self_lookup_never_returns_an_existing_one_to_one_dm(session, access) -> None:
    operations = _operations(session)
    pair = await operations.create_dm_with_subjects(
        access.member_id, access.org_id, [ChatSubject.user(access.peer_id)]
    )

    own = await operations.create_dm_with_subjects(
        access.member_id, access.org_id, [ChatSubject.user(access.member_id)]
    )

    assert own.id != pair.id
    assert own.is_self_dm is True
    assert pair.is_self_dm is False
    assert await _live_self_dm_ids(session, access, access.member_id) == [own.id]


async def test_moderators_reach_neither_the_channel_nor_its_messages(session, access) -> None:
    session.add(
        DomainAdmin(
            user_id=access.peer_id,
            organization_id=access.org_id,
            domain=DomainType.CHAT,
            granted_by=access.owner_id,
        )
    )
    await session.commit()
    channel = await _operations(session).open_self_dm(access.member_id, access.org_id)
    message = await _post(session, channel, "draft for the board")
    key = ResourceKey(ContentType.CHAT_MESSAGE, message.id)

    for moderator_id in (access.owner_id, access.admin_id, access.peer_id):
        with pytest.raises(PermissionDeniedError):
            await ChatAccessChecker(session).check_access(moderator_id, access.org_id, channel)
        assert not await ChatAccessChecker(session).require_elevated(
            moderator_id, access.org_id, channel.id
        )
        decision = (
            await ResourceAccessResolver(session).resolve(
                actor_id=moderator_id,
                organization_id=access.org_id,
                keys=[key],
                purpose=ResourceAccessPurpose.REFERENCE,
            )
        )[key]
        assert decision.can_view is False

    owner_decision = (
        await ResourceAccessResolver(session).resolve(
            actor_id=access.member_id,
            organization_id=access.org_id,
            keys=[key],
            purpose=ResourceAccessPurpose.REFERENCE,
        )
    )[key]
    assert owner_decision.can_view is True


async def test_search_finds_a_self_conversation_message_only_for_its_owner(session, access) -> None:
    search = WorkspaceSearch(MeiliSearchEngine())
    await search.startup()
    channel = await _operations(session).open_self_dm(access.member_id, access.org_id)
    token = f"SelfNote{generate_id().hex[:12]}"
    message = await _post(session, channel, f"{token} parked link")
    urn = f"urn:uniffy:content:CHAT_MESSAGE:{message.id}"
    document_id = build_document_id(urn, access.org_id)

    await ChatMessageOperations(session, search_indexer=SearchIndexer(search))._index_message(
        message, channel, [access.member_id], sender_name="Member Tester"
    )
    # A stale document that wrongly lists the admin must still stop at PostgreSQL.
    await search.engine.patch_documents(
        [{"id": document_id, "shared_user_ids": [str(access.member_id), str(access.admin_id)]}],
        wait=True,
    )

    try:
        operations = SearchOperations(session, search)
        owner_hits, _, _ = await operations.search(access.member_id, access.org_id, token)
        admin_hits, _, _ = await operations.search(access.admin_id, access.org_id, token)
        org_owner_hits, _, _ = await operations.search(access.owner_id, access.org_id, token)
        peer_hits, _, _ = await operations.search(access.peer_id, access.org_id, token)
        admin_view = await operations.resolve_urns(access.admin_id, access.org_id, [urn])

        assert [hit.urn for hit in owner_hits] == [urn]
        assert admin_hits == []
        assert org_owner_hits == []
        assert peer_hits == []
        assert admin_view[urn].availability is not UrnAvailability.AVAILABLE
        assert admin_view[urn].title == ""
    finally:
        await search.engine.delete_document(document_id)


async def test_own_messages_leave_no_unread_count(session, access) -> None:
    channel = await _operations(session).open_self_dm(access.member_id, access.org_id)
    await _post(session, channel, "first thought")
    await _post(session, channel, "second thought")

    counts = await ChatReadStateOperations(session).get_unread_counts(
        access.member_id, access.org_id, [channel.id]
    )

    assert counts.get(channel.id, {"unread_count": 0})["unread_count"] == 0
    assert counts.get(channel.id, {"mention_count": 0})["mention_count"] == 0


async def test_moderators_cannot_file_it_under_a_category(session, access) -> None:
    channel = await _operations(session).open_self_dm(access.member_id, access.org_id)
    category = ChatChannelCategory(
        organization_id=access.org_id,
        name=f"Teams {generate_id().hex[:8]}",
        created_by=access.admin_id,
    )
    session.add(category)
    await session.commit()

    try:
        with pytest.raises(NotFoundError):
            await ChatCategoryOperations(session, recording_indexer()).move_channel_to_category(
                access.admin_id, access.org_id, channel.id, category.id
            )
        await session.refresh(channel)
        assert channel.category_id is None
    finally:
        await session.delete(category)
        await session.commit()


async def test_member_removal_leaves_no_memberless_channel(session, access) -> None:
    channel = await _operations(session).open_self_dm(access.peer_id, access.org_id)
    pair = await _operations(session).create_dm_with_subjects(
        access.peer_id, access.org_id, [ChatSubject.user(access.member_id)]
    )

    cleanup = await cleanup_chat_membership_for_organization(
        session,
        organization_id=access.org_id,
        user_id=access.peer_id,
    )
    await session.commit()

    memberless_live = (
        (
            await session.execute(
                select(ChatChannel.id).where(
                    ChatChannel.organization_id == access.org_id,
                    ChatChannel.is_deleted.is_(False),
                    ~exists().where(ChatChannelMember.channel_id == ChatChannel.id),
                )
            )
        )
        .scalars()
        .all()
    )
    await session.refresh(channel)
    await session.refresh(pair)

    assert cleanup.deleted_self_dm_ids == (channel.id,)
    assert memberless_live == []
    assert channel.is_deleted is True
    assert pair.is_deleted is False
    # The slot frees, so a re-added member opens a fresh conversation.
    reopened = await _operations(session).open_self_dm(access.peer_id, access.org_id)
    assert reopened.id != channel.id
    live = await session.scalar(
        select(func.count()).where(
            ChatChannel.owner_id == access.peer_id,
            ChatChannel.is_self_dm.is_(True),
            ChatChannel.is_deleted.is_(False),
        )
    )
    assert live == 1
