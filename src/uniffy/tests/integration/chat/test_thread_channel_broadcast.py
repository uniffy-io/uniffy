"""Linked message lifecycle against PostgreSQL with external delivery isolated."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from uniffy.core.errors import NotFoundError
from uniffy.core.models.chat.channel import ChannelType, ChatChannel, ChatChannelStats
from uniffy.core.models.chat.channel_member import ChannelRole, ChatChannelMember
from uniffy.core.models.chat.message import ChatMessage, ChatMessageMetadataKey
from uniffy.core.models.chat.message_revision import ChatMessageRevision
from uniffy.core.models.files.attachment import Attachment
from uniffy.core.models.files.file import File
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.login.user import User
from uniffy.core.types import AccessMode, ContentType, SubjectType, generate_id
from uniffy.domains.chat.messages import indexing, mutations, sending
from uniffy.domains.chat.messages.broadcasts import find_broadcast_peer
from uniffy.domains.chat.messages.operations import ChatMessageOperations
from uniffy.domains.files.attachments.folders import get_or_create_personal_attachments_folder
from uniffy.domains.files.attachments.operations import AttachmentOperations
from uniffy.infrastructure.database.session import get_database_url

pytestmark = pytest.mark.asyncio(loop_scope="session")
INITIAL = "Initial broadcast"
REVISED = "Revised broadcast"
SURVIVING = "Surviving message"


@pytest_asyncio.fixture(loop_scope="session")
async def broadcast_env(monkeypatch):
    engine = create_async_engine(get_database_url())
    monkeypatch.setattr(sending, "check_chat_mutation_limit", AsyncMock())
    monkeypatch.setattr(indexing, "publish_mention_state", AsyncMock())
    publish = AsyncMock()
    monkeypatch.setattr(mutations, "publish_channel_event_to_members", publish)
    monkeypatch.setattr(
        indexing.SenderResolver,
        "resolve_one",
        AsyncMock(return_value=SimpleNamespace(display_name="Sender")),
    )
    try:
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                async with AsyncSession(
                    connection, expire_on_commit=False, join_transaction_mode="create_savepoint"
                ) as session:
                    suffix = generate_id().hex
                    user = User(email=f"{suffix}@test.local", username=suffix, hashed_password="x")
                    org = Organization(name="Broadcast test", slug=suffix)
                    session.add_all([user, org])
                    await session.flush()
                    channel = ChatChannel(
                        organization_id=org.id,
                        owner_id=user.id,
                        name="Broadcast",
                        slug=suffix,
                        channel_type=ChannelType.PUBLIC,
                    )
                    session.add_all([
                        OrganizationMember(user_id=user.id, organization_id=org.id),
                        channel,
                    ])
                    await session.flush()
                    session.add_all([
                        ChatChannelMember(
                            channel_id=channel.id,
                            user_id=user.id,
                            subject_id=user.id,
                            subject_type=SubjectType.USER,
                            role=ChannelRole.OWNER,
                        ),
                        ChatChannelStats(channel_id=channel.id),
                    ])
                    root = ChatMessage(channel_id=channel.id, sender_id=user.id, content="Root")
                    session.add(root)
                    await session.commit()
                    indexer, storage = AsyncMock(), AsyncMock()
                    ops = ChatMessageOperations(session, storage=storage, search_indexer=indexer)
                    ops._post_commit_send = AsyncMock()
                    ops._get_channel_member_ids = AsyncMock(return_value=[user.id])
                    ops._update_resources = AsyncMock()
                    yield SimpleNamespace(
                        session=session,
                        ops=ops,
                        user=user.id,
                        org=org.id,
                        channel=channel,
                        root=root.id,
                        indexer=indexer,
                        publish=publish,
                        storage=storage,
                    )
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()


async def _send(env, content=INITIAL, attachments=None):
    reply, _, _ = await env.ops.send_message(
        env.user,
        env.org,
        env.channel.id,
        content,
        root_id=env.root,
        attachment_file_ids=attachments,
        also_send_to_channel=True,
    )
    copy = await find_broadcast_peer(env.session, reply)
    assert copy is not None
    return reply, copy


async def _edit(env, message, content):
    return await env.ops.update_message(env.user, env.org, env.channel.id, message.id, content)


@pytest.mark.parametrize("edit_copy", [False, True])
async def test_edit_updates_both_rows_and_only_indexes_copy(broadcast_env, edit_copy):
    env = broadcast_env
    reply, copy = await _send(env)
    await _edit(env, copy if edit_copy else reply, REVISED)
    await env.session.refresh(reply)
    await env.session.refresh(copy)
    assert reply.content == copy.content == REVISED
    revisions = (
        (
            await env.session.execute(
                select(ChatMessageRevision).where(
                    ChatMessageRevision.message_id.in_([reply.id, copy.id])
                )
            )
        )
        .scalars()
        .all()
    )
    assert {revision.message_id for revision in revisions} == {reply.id, copy.id}
    assert all(revision.content == INITIAL for revision in revisions)
    writes = env.indexer.index.await_args_list
    assert {call.kwargs["urn"] for call in writes} == {f"urn:uniffy:content:CHAT_MESSAGE:{copy.id}"}
    assert writes[-1].kwargs["title"] == REVISED
    env.indexer.remove.assert_any_await(f"urn:uniffy:content:CHAT_MESSAGE:{reply.id}")
    assert {call.args[2]["message_id"] for call in env.publish.await_args_list} == {
        str(reply.id),
        str(copy.id),
    }
    stats = await env.session.get(ChatChannelStats, env.channel.id)
    assert (stats.message_count, stats.root_message_count) == (2, 1)


async def test_mention_only_edit_removes_both_search_documents(broadcast_env):
    env = broadcast_env
    reply, copy = await _send(env)
    await _edit(env, reply, f"[[[Sender|urn:uniffy:content:USER:{env.user}]]]")
    env.indexer.index.assert_not_awaited()
    assert {call.args[0] for call in env.indexer.remove.await_args_list} == {
        f"urn:uniffy:content:CHAT_MESSAGE:{reply.id}",
        f"urn:uniffy:content:CHAT_MESSAGE:{copy.id}",
    }


@pytest.mark.parametrize("delete_copy", [False, True])
async def test_delete_one_surface_keeps_survivor_editable_and_searchable(broadcast_env, delete_copy):
    env = broadcast_env
    reply, copy = await _send(env)
    removed, survivor = (copy, reply) if delete_copy else (reply, copy)
    await env.ops.delete_message(env.user, env.org, env.channel.id, removed.id)
    await _edit(env, survivor, SURVIVING)
    await env.session.refresh(removed)
    assert removed.is_deleted and removed.content == INITIAL
    assert survivor.content == SURVIVING
    assert (
        env.indexer.index.await_args.kwargs["urn"]
        == f"urn:uniffy:content:CHAT_MESSAGE:{survivor.id}"
    )
    with pytest.raises(NotFoundError):
        await _edit(env, removed, "Resurrection")


async def test_failed_pair_edit_rolls_back_both_revisions_and_bodies(broadcast_env, monkeypatch):
    env = broadcast_env
    reply, copy = await _send(env)
    record = env.ops._record_revision

    async def fail_second(message, *, edited_by):
        if message.id == copy.id:
            raise RuntimeError("Revision storage unavailable")
        await record(message, edited_by=edited_by)

    monkeypatch.setattr(env.ops, "_record_revision", fail_second)
    with pytest.raises(RuntimeError, match="Revision storage unavailable"):
        await _edit(env, reply, "Must roll back")
    await env.session.rollback()
    await env.session.refresh(reply)
    await env.session.refresh(copy)
    assert reply.content == copy.content == INITIAL
    assert (
        not (
            await env.session.execute(
                select(ChatMessageRevision).where(
                    ChatMessageRevision.message_id.in_([reply.id, copy.id])
                )
            )
        )
        .scalars()
        .all()
    )
    env.publish.assert_not_awaited()


@pytest.mark.parametrize("staged", [False, True])
async def test_each_body_owns_its_file_through_edits_and_detach(broadcast_env, staged):
    env = broadcast_env
    folder = await get_or_create_personal_attachments_folder(env.session, env.user, env.org)
    source = File(
        organization_id=env.org,
        owner_id=env.user,
        folder_id=folder.id if staged else None,
        access_mode=AccessMode.OWNER_ONLY,
        filename="broadcast.txt",
        original_filename="broadcast.txt",
        mime_type="text/plain",
        size_bytes=1,
        storage_key="test-only-no-object",
        storage_bucket="test",
    )
    env.session.add(source)
    await env.session.flush()
    source_id = source.id
    reply, copy = await _send(
        env,
        f"Document [[[broadcast.txt|urn:uniffy:content:FILE:{source_id}]]]",
        [source_id],
    )
    attachments = (
        (
            await env.session.execute(
                select(Attachment).where(
                    Attachment.content_type == ContentType.CHAT_MESSAGE,
                    Attachment.content_id.in_([reply.id, copy.id]),
                )
            )
        )
        .scalars()
        .all()
    )
    by_message = {attachment.content_id: attachment for attachment in attachments}
    original, copied = by_message[reply.id], by_message[copy.id]
    assert original.file_id != copied.file_id
    assert (original.file_id == source_id) is staged
    for message in (reply, copy):
        urn = f"urn:uniffy:content:FILE:{by_message[message.id].file_id}"
        assert urn in message.content and urn in message.mentioned_urns
        await _edit(env, message, message.content + " edited")
    assert str(original.file_id) not in copy.content
    assert str(copied.file_id) not in reply.content
    original_id, copy_file_id = original.file_id, copied.file_id
    await AttachmentOperations(env.session, env.storage, env.indexer).detach_file(
        env.user,
        env.org,
        original.id,
    )
    await env.session.commit()
    assert await env.session.get(File, original_id) is None
    assert await env.session.get(File, copy_file_id) is not None
    assert str(copy_file_id) in copy.content
    if not staged:
        assert await env.session.get(File, source_id) is not None


async def test_concurrent_edits_from_opposite_surfaces_keep_a_single_revision_order(monkeypatch):
    schema = f"broadcast_test_{generate_id().hex}"
    admin_engine = create_async_engine(get_database_url())
    engine = create_async_engine(
        get_database_url(),
        connect_args={"server_settings": {"search_path": f"{schema},public"}},
    )
    org, user, channel_id, root_id = [generate_id() for _ in range(4)]
    channel = ChatChannel(
        id=channel_id,
        organization_id=org,
        owner_id=user,
        name="Test",
        slug=schema,
        channel_type=ChannelType.PUBLIC,
    )
    reply = ChatMessage(channel_id=channel_id, sender_id=user, root_id=root_id, content=INITIAL)
    copy = ChatMessage(
        channel_id=channel_id,
        sender_id=user,
        content=INITIAL,
        message_metadata={
            ChatMessageMetadataKey.THREAD_REPLY.value: {
                "reply_message_id": str(reply.id),
                "root_message_id": str(root_id),
            }
        },
    )
    monkeypatch.setattr(mutations, "publish_channel_event_to_members", AsyncMock())
    try:
        async with admin_engine.begin() as connection:
            await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
            for table in ("chat_messages", "chat_message_revisions", "attachments_attachments"):
                await connection.execute(
                    text(f'CREATE TABLE "{schema}".{table} (LIKE public.{table} INCLUDING ALL)')
                )
        async with AsyncSession(engine, expire_on_commit=False) as session:
            session.add_all([reply, copy])
            await session.commit()
        ready = asyncio.Barrier(2)

        async def edit(message_id, body):
            async with AsyncSession(engine, expire_on_commit=False) as session:
                ops = ChatMessageOperations(session, storage=AsyncMock(), search_indexer=AsyncMock())
                ops.access.get_channel = AsyncMock(return_value=channel)
                ops._require_message_action = AsyncMock()
                ops._get_channel_member_ids = AsyncMock(return_value=[user])
                ops._index_message = AsyncMock()
                ops._update_resources = AsyncMock()
                original_get = ops._get_message_by_id

                async def get_before_both_lock(id):
                    message = await original_get(id)
                    await ready.wait()
                    return message

                ops._get_message_by_id = get_before_both_lock
                await ops.update_message(user, org, channel_id, message_id, body)

        await asyncio.wait_for(asyncio.gather(edit(reply.id, REVISED), edit(copy.id, SURVIVING)), 5)
        async with AsyncSession(engine) as session:
            rows = (await session.execute(select(ChatMessage))).scalars().all()
            assert len({row.content for row in rows}) == 1
            revisions = (
                (
                    await session.execute(
                        select(ChatMessageRevision).order_by(
                            ChatMessageRevision.revision_no,
                        )
                    )
                )
                .scalars()
                .all()
            )
            for id in (reply.id, copy.id):
                history = [revision for revision in revisions if revision.message_id == id]
                assert [revision.revision_no for revision in history] == [1, 2]
                assert history[0].content == INITIAL
                assert {history[1].content, rows[0].content} == {REVISED, SURVIVING}
    finally:
        await engine.dispose()
        async with admin_engine.begin() as connection:
            await connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        await admin_engine.dispose()
