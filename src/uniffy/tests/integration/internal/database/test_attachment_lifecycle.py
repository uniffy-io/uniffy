"""Staged uploads link in place, derive read access from their parent, and die with it."""

from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import delete, select, update

from uniffy.core.auth.permissions import PermissionChecker
from uniffy.core.models.files.attachment import Attachment
from uniffy.core.models.files.file import File
from uniffy.core.models.files.file_version import FileVersion
from uniffy.core.models.files.folder import Folder
from uniffy.core.models.files.media_info import FileMediaInfo
from uniffy.core.models.files.storage_usage import StorageUsage
from uniffy.core.models.notes.note import Note
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.search.indexer import SearchIndexer
from uniffy.core.types import (
    AccessMode,
    ContentRole,
    ContentType,
    SubjectType,
    generate_id,
)
from uniffy.domains.files.attachments.operations import AttachmentOperations
from uniffy.domains.files.operations import FileOperations
from uniffy.domains.notes.operations import NoteOperations
from uniffy.domains.permissions.access import (
    ResourceAccessPurpose,
    ResourceAccessResolver,
    ResourceKey,
)
from uniffy.domains.permissions.members import ContentMembersOperations

pytestmark = pytest.mark.asyncio(loop_scope="session")


@pytest.fixture
def s3_mock() -> AsyncMock:
    return AsyncMock()


@pytest.fixture
def quiet_search() -> SearchIndexer:
    return MagicMock(spec=SearchIndexer)


def _file(env, *, owner_id, folder_id=None, access_mode=AccessMode.OWNER_ONLY) -> File:
    suffix = generate_id().hex[:8]
    return File(
        organization_id=env.org_id,
        owner_id=owner_id,
        filename=f"itdb-{suffix}.txt",
        original_filename=f"itdb-{suffix}.txt",
        mime_type="text/plain",
        size_bytes=10,
        storage_key=f"itdb/{suffix}",
        storage_bucket="itdb",
        folder_id=folder_id,
        access_mode=access_mode,
        baseline_role=None,
    )


def _note(env, *, access_mode: AccessMode) -> Note:
    suffix = generate_id().hex[:8]
    return Note(
        organization_id=env.org_id,
        owner_id=env.admin_id,
        title=f"itdb-note-{suffix}",
        slug=f"itdb-{suffix}",
        access_mode=access_mode,
        baseline_role=None,
    )


async def _cleanup(session, org_id) -> None:
    await session.rollback()
    await session.execute(
        update(File).where(File.organization_id == org_id).values(current_version_id=None)
    )
    org_file_ids = select(File.id).where(File.organization_id == org_id)
    await session.execute(delete(FileVersion).where(FileVersion.file_id.in_(org_file_ids)))
    await session.execute(delete(FileMediaInfo).where(FileMediaInfo.file_id.in_(org_file_ids)))
    await session.execute(delete(Attachment).where(Attachment.organization_id == org_id))
    await session.execute(delete(File).where(File.organization_id == org_id))
    await session.execute(delete(Folder).where(Folder.organization_id == org_id))
    org_note_ids = select(Note.id).where(Note.organization_id == org_id)
    await session.execute(
        delete(RealtimeYjsSnapshot).where(
            RealtimeYjsSnapshot.content_type == ContentType.NOTE,
            RealtimeYjsSnapshot.content_id.in_(org_note_ids),
        )
    )
    await session.execute(delete(Note).where(Note.organization_id == org_id))
    await session.execute(delete(ContentMember).where(ContentMember.organization_id == org_id))
    await session.execute(delete(StorageUsage).where(StorageUsage.organization_id == org_id))
    await session.commit()


async def _staged_setup(session, env, ops: AttachmentOperations) -> tuple[Folder, File]:
    staging = await ops.get_or_create_attachments_folder(env.admin_id, env.org_id)
    staged = _file(env, owner_id=env.admin_id, folder_id=staging.id)
    session.add(staged)
    await session.commit()
    return staging, staged


async def test_staged_file_links_in_place_and_stays_private(
    session, env, s3_mock, quiet_search
) -> None:
    ops = AttachmentOperations(session, s3_mock, quiet_search)
    try:
        staging, staged = await _staged_setup(session, env, ops)
        note = _note(env, access_mode=AccessMode.OWNER_ONLY)
        session.add(note)
        await session.commit()

        attachment = await ops.attach_file(
            env.admin_id, env.org_id, ContentType.NOTE, note.id, staged.id
        )
        await session.commit()

        assert attachment.file_id == staged.id
        assert attachment.source_file_id == staged.id
        await session.refresh(staged)
        assert staged.access_mode == AccessMode.OWNER_ONLY
        assert staged.baseline_role is None
        assert staged.folder_id == staging.id
        s3_mock.copy_object.assert_not_awaited()
    finally:
        await _cleanup(session, env.org_id)


async def test_attach_indexes_the_attachment_file(
    session, env, s3_mock, quiet_search: SearchIndexer
) -> None:
    # Mention chips resolve previews from the raw search document; an attach
    # without a doc leaves every authorized reader on a permanent retry card.
    index_mock = AsyncMock()
    quiet_search.index = index_mock
    ops = AttachmentOperations(session, s3_mock, quiet_search)
    try:
        _, staged = await _staged_setup(session, env, ops)
        note = _note(env, access_mode=AccessMode.OWNER_ONLY)
        session.add(note)
        await session.commit()

        await ops.attach_file(env.admin_id, env.org_id, ContentType.NOTE, note.id, staged.id)
        await session.commit()

        indexed_urns = {
            call.kwargs.get("urn") or (call.args[0] if call.args else None)
            for call in index_mock.await_args_list
        }
        assert f"urn:uniffy:content:FILE:{staged.id}" in indexed_urns
    finally:
        await _cleanup(session, env.org_id)


async def test_note_share_grants_viewer_on_linked_attachment_file(
    session, env, s3_mock, quiet_search
) -> None:
    ops = AttachmentOperations(session, s3_mock, quiet_search)
    try:
        _, staged = await _staged_setup(session, env, ops)
        note = _note(env, access_mode=AccessMode.EXPLICIT_MEMBERS)
        session.add(note)
        await session.commit()

        attachment = await ops.attach_file(
            env.admin_id, env.org_id, ContentType.NOTE, note.id, staged.id
        )
        await session.commit()
        assert attachment.file_id == staged.id

        direct_role = await PermissionChecker(session).effective_role(
            env.member_id,
            env.org_id,
            ContentType.FILE,
            staged.id,
            owner_id=staged.owner_id,
            access_mode=staged.access_mode,
            baseline_role=staged.baseline_role,
        )
        assert direct_role is None

        before = await FileOperations(session, search_indexer=quiet_search)._resolve_role(
            env.member_id, env.org_id, staged
        )
        assert before is None

        await ContentMembersOperations(session, quiet_search).add_member(
            actor_user_id=env.admin_id,
            organization_id=env.org_id,
            content_type=ContentType.NOTE,
            content_id=note.id,
            subject_type=SubjectType.USER,
            subject_id=env.member_id,
            role=ContentRole.VIEWER,
        )

        after = await FileOperations(session, search_indexer=quiet_search)._resolve_role(
            env.member_id, env.org_id, staged
        )
        assert after == ContentRole.VIEWER
    finally:
        await _cleanup(session, env.org_id)


async def test_claimed_staged_file_is_copied_on_second_attach(
    session, env, s3_mock, quiet_search
) -> None:
    ops = AttachmentOperations(session, s3_mock, quiet_search)
    try:
        staging, staged = await _staged_setup(session, env, ops)
        first_note = _note(env, access_mode=AccessMode.OWNER_ONLY)
        second_note = _note(env, access_mode=AccessMode.OWNER_ONLY)
        session.add_all([first_note, second_note])
        await session.commit()

        first = await ops.attach_file(
            env.admin_id, env.org_id, ContentType.NOTE, first_note.id, staged.id
        )
        await session.commit()
        second = await ops.attach_file(
            env.admin_id, env.org_id, ContentType.NOTE, second_note.id, staged.id
        )
        await session.commit()

        assert first.file_id == staged.id
        assert second.file_id != staged.id
        assert second.source_file_id == staged.id
        s3_mock.copy_object.assert_awaited_once()

        copy = await session.get(File, second.file_id)
        assert copy is not None
        assert copy.access_mode == AccessMode.OWNER_ONLY
        assert copy.folder_id == staging.id
    finally:
        await _cleanup(session, env.org_id)


async def test_non_staged_source_is_copied_and_left_untouched(
    session, env, s3_mock, quiet_search
) -> None:
    ops = AttachmentOperations(session, s3_mock, quiet_search)
    try:
        regular_folder = Folder(
            organization_id=env.org_id,
            owner_id=env.admin_id,
            name=f"itdb-docs-{generate_id().hex[:8]}",
            access_mode=AccessMode.OWNER_ONLY,
        )
        session.add(regular_folder)
        await session.flush()
        source = _file(env, owner_id=env.admin_id, folder_id=regular_folder.id)
        note = _note(env, access_mode=AccessMode.OWNER_ONLY)
        session.add_all([source, note])
        await session.commit()

        attachment = await ops.attach_file(
            env.admin_id, env.org_id, ContentType.NOTE, note.id, source.id
        )
        await session.commit()

        assert attachment.file_id != source.id
        assert attachment.source_file_id == source.id
        await session.refresh(source)
        assert source.access_mode == AccessMode.OWNER_ONLY
        assert source.folder_id == regular_folder.id
        s3_mock.copy_object.assert_awaited_once()

        staging_id = await ops.get_attachments_folder_id(env.admin_id, env.org_id)
        copy = await session.get(File, attachment.file_id)
        assert copy.folder_id == staging_id
        assert copy.access_mode == AccessMode.OWNER_ONLY
    finally:
        await _cleanup(session, env.org_id)


async def test_resolver_derives_attachment_file_view_from_note_grant(
    session, env, s3_mock, quiet_search
) -> None:
    ops = AttachmentOperations(session, s3_mock, quiet_search)
    try:
        _, staged = await _staged_setup(session, env, ops)
        note = _note(env, access_mode=AccessMode.EXPLICIT_MEMBERS)
        session.add(note)
        await session.commit()

        await ops.attach_file(env.admin_id, env.org_id, ContentType.NOTE, note.id, staged.id)
        await session.commit()

        key = ResourceKey(ContentType.FILE, staged.id)
        denied = (
            await ResourceAccessResolver(session).resolve(
                actor_id=env.member_id,
                organization_id=env.org_id,
                keys=[key],
                purpose=ResourceAccessPurpose.REFERENCE,
            )
        )[key]
        assert not denied.can_view

        await ContentMembersOperations(session, quiet_search).add_member(
            actor_user_id=env.admin_id,
            organization_id=env.org_id,
            content_type=ContentType.NOTE,
            content_id=note.id,
            subject_type=SubjectType.USER,
            subject_id=env.member_id,
            role=ContentRole.VIEWER,
        )

        granted = (
            await ResourceAccessResolver(session).resolve(
                actor_id=env.member_id,
                organization_id=env.org_id,
                keys=[key],
                purpose=ResourceAccessPurpose.REFERENCE,
            )
        )[key]
        assert granted.can_view
        assert granted.role == ContentRole.VIEWER
    finally:
        await _cleanup(session, env.org_id)


async def test_purge_removes_attachment_and_file_rows(session, env, s3_mock, quiet_search) -> None:
    ops = AttachmentOperations(session, s3_mock, quiet_search)
    try:
        _, staged = await _staged_setup(session, env, ops)
        note = _note(env, access_mode=AccessMode.OWNER_ONLY)
        session.add(note)
        await session.commit()

        attachment = await ops.attach_file(
            env.admin_id, env.org_id, ContentType.NOTE, note.id, staged.id
        )
        await session.commit()

        removed = await ops.purge_attachments_for_content(env.org_id, ContentType.NOTE, [note.id])
        await session.commit()

        assert removed == 1
        assert await session.get(Attachment, attachment.id) is None
        assert await session.get(File, staged.id) is None
        s3_mock.delete_object.assert_awaited_with(staged.storage_key)
    finally:
        await _cleanup(session, env.org_id)


async def test_note_permanent_delete_purges_linked_attachment(
    session, env, s3_mock, quiet_search
) -> None:
    ops = AttachmentOperations(session, s3_mock, quiet_search)
    try:
        _, staged = await _staged_setup(session, env, ops)
        note = _note(env, access_mode=AccessMode.OWNER_ONLY)
        session.add(note)
        await session.commit()

        attachment = await ops.attach_file(
            env.admin_id, env.org_id, ContentType.NOTE, note.id, staged.id
        )
        session.add(
            RealtimeYjsSnapshot(
                content_type=ContentType.NOTE,
                content_id=note.id,
                state_vector=b"state",
                updates=b"updates",
            )
        )
        await session.commit()

        await NoteOperations(session, s3_mock, quiet_search).delete(
            env.admin_id, env.org_id, note.id, permanent=True
        )

        assert await session.get(Attachment, attachment.id) is None
        assert await session.get(File, staged.id) is None
        assert await session.get(Note, note.id) is None
        assert await session.get(RealtimeYjsSnapshot, (ContentType.NOTE, note.id)) is None
    finally:
        await _cleanup(session, env.org_id)


async def test_note_empty_trash_purges_realtime_snapshot(
    session, env, s3_mock, quiet_search
) -> None:
    note = _note(env, access_mode=AccessMode.OWNER_ONLY)
    note.is_deleted = True
    session.add_all([
        note,
        RealtimeYjsSnapshot(
            content_type=ContentType.NOTE,
            content_id=note.id,
            state_vector=b"state",
            updates=b"updates",
        ),
    ])
    await session.commit()

    try:
        count = await NoteOperations(session, s3_mock, quiet_search).empty_trash(
            env.admin_id,
            env.org_id,
        )

        assert count == 1
        assert await session.get(Note, note.id) is None
        assert await session.get(RealtimeYjsSnapshot, (ContentType.NOTE, note.id)) is None
    finally:
        await _cleanup(session, env.org_id)


async def test_reconcile_detaches_only_unreferenced_linked_attachments(
    session, env, s3_mock, quiet_search
) -> None:
    ops = AttachmentOperations(session, s3_mock, quiet_search)
    try:
        staging = await ops.get_or_create_attachments_folder(env.admin_id, env.org_id)
        dropped_upload = _file(env, owner_id=env.admin_id, folder_id=staging.id)
        kept_upload = _file(env, owner_id=env.admin_id, folder_id=staging.id)
        picked_source = _file(env, owner_id=env.admin_id)
        note = _note(env, access_mode=AccessMode.OWNER_ONLY)
        session.add_all([dropped_upload, kept_upload, picked_source, note])
        await session.commit()

        dropped_link = await ops.attach_file(
            env.admin_id, env.org_id, ContentType.NOTE, note.id, dropped_upload.id
        )
        await session.commit()
        kept_link = await ops.attach_file(
            env.admin_id, env.org_id, ContentType.NOTE, note.id, kept_upload.id
        )
        await session.commit()
        picked_copy = await ops.attach_file(
            env.admin_id, env.org_id, ContentType.NOTE, note.id, picked_source.id
        )
        await session.commit()
        assert dropped_link.file_id == dropped_upload.id
        assert kept_link.file_id == kept_upload.id
        assert picked_copy.file_id != picked_source.id

        removed = await ops.reconcile_inline_attachments(
            env.org_id,
            ContentType.NOTE,
            note.id,
            referenced_file_ids={kept_upload.id},
        )
        await session.commit()

        assert removed == 1
        assert await session.get(Attachment, dropped_link.id) is None
        assert await session.get(File, dropped_upload.id) is None
        assert await session.get(Attachment, kept_link.id) is not None
        assert await session.get(File, kept_upload.id) is not None
        assert await session.get(Attachment, picked_copy.id) is not None
        assert await session.get(File, picked_copy.file_id) is not None
    finally:
        await _cleanup(session, env.org_id)
