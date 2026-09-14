"""Channel visibility controls historical attachment rows before projections catch up."""

import asyncio
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from uniffy.core.errors import PermissionDeniedError
from uniffy.core.models.chat.channel import ChannelType
from uniffy.core.models.chat.channel_member import ChatChannelMember
from uniffy.core.models.chat.message import ChatMessage
from uniffy.core.models.chat.search_acl_refresh import ChatSearchAclRefresh
from uniffy.core.models.files.file import File
from uniffy.core.models.files.folder import Folder
from uniffy.core.types import AccessMode, ContentRole, ContentType, SubjectType
from uniffy.domains.chat.channels import updates
from uniffy.domains.chat.jobs import jobs
from uniffy.domains.files import routes
from uniffy.domains.files.attachments.folders import get_or_create_personal_attachments_folder
from uniffy.domains.files.attachments.operations import AttachmentOperations
from uniffy.domains.files.operations import FileOperations
from uniffy.domains.permissions.access import (
    ResourceAccessPurpose,
    ResourceAccessResolver,
    ResourceKey,
)
from uniffy.infrastructure.database.session import get_database_url
from uniffy.tests.integration.chat.test_channel_visibility_roundtrip import (
    _operations,
    _seed,
    _teardown,
)

pytestmark = pytest.mark.asyncio(loop_scope="session")
COMPLETE = "complete"


@pytest_asyncio.fixture(loop_scope="session")
async def env(session, monkeypatch):
    seeded = await _seed(session)
    monkeypatch.setattr(updates, "invalidate_cached_member_ids", AsyncMock())
    monkeypatch.setattr(updates, "publish_dismissed_requests", AsyncMock())
    try:
        yield seeded
    finally:
        await _teardown(session, seeded)


def _quiet_operations(session):
    ops = _operations(session)
    ops._claim_visibility_refresh = AsyncMock(return_value=False)
    ops._post_visibility_change_message = AsyncMock()
    ops._refresh_channel_live_state = AsyncMock()
    ops._publish_channel_updated = AsyncMock()
    return ops


async def _attachment(session, env, channel_id, *, root_id=None):
    folder = await get_or_create_personal_attachments_folder(session, env.owner_id, env.org_id)
    file = File(
        organization_id=env.org_id,
        owner_id=env.owner_id,
        folder_id=folder.id,
        access_mode=AccessMode.OWNER_ONLY,
        filename="history.txt",
        original_filename="history.txt",
        mime_type="text/plain",
        size_bytes=1,
        storage_key="test-no-object",
        storage_bucket="test",
    )
    message = ChatMessage(
        channel_id=channel_id,
        sender_id=env.owner_id,
        content="Historical file",
        root_id=root_id,
    )
    session.add_all([file, message])
    await session.flush()
    attachment = await AttachmentOperations(session, AsyncMock(), AsyncMock()).attach_file(
        env.owner_id,
        env.org_id,
        ContentType.CHAT_MESSAGE,
        message.id,
        file.id,
    )
    await session.commit()
    return attachment.file_id, message.id


async def _flip(session, env, channel_id, target):
    return await _quiet_operations(session).change_channel_visibility(
        env.owner_id,
        env.org_id,
        channel_id,
        target,
    )


async def test_private_flip_denies_historical_file_point_reference_and_bytes(
    session, env, monkeypatch
):
    root_file, root = await _attachment(session, env, env.public_id)
    reply_file, _ = await _attachment(session, env, env.public_id, root_id=root)
    unrelated_file, _ = await _attachment(session, env, env.private_id)
    await FileOperations(session).get_by_id(env.outsider_id, env.org_id, root_file)

    await _flip(session, env, env.public_id, ChannelType.PRIVATE)
    for id in (root_file, reply_file):
        file = await session.get(File, id)
        await session.refresh(file)
        assert file.access_mode == AccessMode.OWNER_ONLY and file.baseline_role is None
        folder = await session.get(Folder, file.folder_id)
        assert folder.owner_id == env.owner_id and not folder.is_org_attachments
        with pytest.raises(PermissionDeniedError):
            await FileOperations(session).get_by_id(env.outsider_id, env.org_id, id)

    keys = [ResourceKey(ContentType.FILE, id) for id in (root_file, reply_file)]
    decisions = await ResourceAccessResolver(session).resolve(
        actor_id=env.outsider_id,
        organization_id=env.org_id,
        keys=keys,
        purpose=ResourceAccessPurpose.REFERENCE,
    )
    assert all(not decision.can_view for decision in decisions.values())

    @asynccontextmanager
    async def same_session():
        yield session

    monkeypatch.setattr(routes, "open_session", same_session)
    storage = AsyncMock()
    with pytest.raises(HTTPException) as denied:
        await routes.stream_file(storage, env.org_id, root_file, env.outsider_id)
    assert denied.value.status_code == 403
    storage.download_object.assert_not_awaited()

    session.add(
        ChatChannelMember(
            channel_id=env.public_id,
            subject_type=SubjectType.USER,
            subject_id=env.outsider_id,
            user_id=env.outsider_id,
        )
    )
    await session.commit()
    await FileOperations(session).get_by_id(env.outsider_id, env.org_id, root_file)

    await _flip(session, env, env.public_id, ChannelType.PUBLIC)
    for id in (root_file, reply_file):
        file = await session.get(File, id)
        await session.refresh(file)
        assert (file.access_mode, file.baseline_role) == (AccessMode.OPEN_TO_ORG, ContentRole.VIEWER)
        assert (await session.get(Folder, file.folder_id)).is_org_attachments
    unrelated = await session.get(File, unrelated_file)
    assert unrelated.access_mode == AccessMode.OWNER_ONLY


async def test_failed_flip_rolls_back_channel_and_file_policy(session, env, monkeypatch):
    file_id, _ = await _attachment(session, env, env.public_id)
    monkeypatch.setattr(
        updates, "write_audit_event", AsyncMock(side_effect=RuntimeError("Audit failed"))
    )
    with pytest.raises(RuntimeError, match="Audit failed"):
        await _flip(session, env, env.public_id, ChannelType.PRIVATE)
    await session.rollback()
    channel = await _quiet_operations(session).get_by_id(env.outsider_id, env.org_id, env.public_id)
    file = await FileOperations(session).get_by_id(env.outsider_id, env.org_id, file_id)
    assert channel.channel_type == ChannelType.PUBLIC
    assert file.access_mode == AccessMode.OPEN_TO_ORG
    assert await session.get(ChatSearchAclRefresh, env.public_id) is None


async def test_projection_failure_retains_intent_and_retry_updates_file_policy(
    session, env, monkeypatch
):
    file_id, _ = await _attachment(session, env, env.public_id)
    await _flip(session, env, env.public_id, ChannelType.PRIVATE)

    @asynccontextmanager
    async def same_session():
        yield session

    monkeypatch.setattr(jobs, "open_session", same_session)
    search = AsyncMock()
    search.update_chat_message_sharing.return_value = 0
    search.index_document.side_effect = RuntimeError("Search unavailable")
    with pytest.raises(RuntimeError, match="Search unavailable"):
        await jobs._process_channel(env.public_id, search)
    pending = await session.get(ChatSearchAclRefresh, env.public_id)
    assert pending is not None and pending.attempts == 1
    search.index_document.side_effect = None
    result = await jobs._process_channel(env.public_id, search)
    assert result["status"] == COMPLETE
    document = search.index_document.await_args.args[0]
    assert document.urn == f"urn:uniffy:content:FILE:{file_id}"
    assert document.access_mode == AccessMode.OWNER_ONLY.value
    assert document.baseline_role is None
    search.update_document_access_policy_bulk.assert_awaited_once_with(
        env.org_id,
        [(document.urn, AccessMode.OWNER_ONLY.value, None)],
    )
    assert await session.get(ChatSearchAclRefresh, env.public_id) is None


async def test_attachment_in_flight_is_included_in_private_flip(session, env):
    engine = create_async_engine(get_database_url())
    try:
        async with AsyncSession(engine, expire_on_commit=False) as attaching:
            folder = await get_or_create_personal_attachments_folder(
                attaching, env.owner_id, env.org_id
            )
            file = File(
                organization_id=env.org_id,
                owner_id=env.owner_id,
                folder_id=folder.id,
                access_mode=AccessMode.OWNER_ONLY,
                filename="racing.txt",
                original_filename="racing.txt",
                mime_type="text/plain",
                size_bytes=1,
                storage_key="test-no-object",
                storage_bucket="test",
            )
            message = ChatMessage(
                channel_id=env.public_id, sender_id=env.owner_id, content="In flight"
            )
            attaching.add_all([file, message])
            await attaching.flush()
            attached = await AttachmentOperations(attaching, AsyncMock(), AsyncMock()).attach_file(
                env.owner_id,
                env.org_id,
                ContentType.CHAT_MESSAGE,
                message.id,
                file.id,
            )
            flip = asyncio.create_task(_flip(session, env, env.public_id, ChannelType.PRIVATE))
            with pytest.raises(TimeoutError):
                await asyncio.wait_for(asyncio.shield(flip), 0.1)
            await attaching.commit()
            await asyncio.wait_for(flip, 5)
            file = await session.get(File, attached.file_id)
            assert file.access_mode == AccessMode.OWNER_ONLY
    finally:
        await engine.dispose()


async def test_attachment_waiting_for_flip_derives_committed_private_policy(
    session, env, monkeypatch
):
    locked, release = asyncio.Event(), asyncio.Event()
    write_audit = updates.write_audit_event

    async def pause_flip(*args, **kwargs):
        await write_audit(*args, **kwargs)
        locked.set()
        await release.wait()

    monkeypatch.setattr(updates, "write_audit_event", pause_flip)
    flip = asyncio.create_task(_flip(session, env, env.public_id, ChannelType.PRIVATE))
    engine = create_async_engine(get_database_url())
    try:
        await asyncio.wait_for(locked.wait(), 5)
        async with AsyncSession(engine, expire_on_commit=False) as attaching:
            task = asyncio.create_task(_attachment(attaching, env, env.public_id))
            with pytest.raises(TimeoutError):
                await asyncio.wait_for(asyncio.shield(task), 0.1)
            release.set()
            await asyncio.wait_for(flip, 5)
            file_id, _ = await asyncio.wait_for(task, 5)
        file = await session.get(File, file_id)
        assert file.access_mode == AccessMode.OWNER_ONLY
        with pytest.raises(PermissionDeniedError):
            await FileOperations(session).get_by_id(env.outsider_id, env.org_id, file_id)
    finally:
        release.set()
        await engine.dispose()
