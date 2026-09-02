"""Denormalized container stats must not count children narrower than the container."""

from unittest.mock import MagicMock

import pytest
from sqlalchemy import delete

from uniffy.core.models.files.file import File
from uniffy.core.models.files.folder import Folder
from uniffy.core.models.notes.note import Note
from uniffy.core.types import AccessMode, NodeType, generate_id
from uniffy.domains.files.operations import FolderOperations
from uniffy.domains.notes.projection import NoteProjectionOperations

pytestmark = pytest.mark.asyncio(loop_scope="session")


def _file(env, folder_id, size, access_mode):
    suffix = generate_id().hex[:8]
    return File(
        organization_id=env.org_id,
        owner_id=env.admin_id,
        filename=f"itdb-{suffix}.txt",
        original_filename=f"itdb-{suffix}.txt",
        mime_type="text/plain",
        size_bytes=size,
        storage_key=f"itdb/{suffix}",
        storage_bucket="itdb",
        folder_id=folder_id,
        access_mode=access_mode,
    )


async def test_folder_stats_exclude_narrower_children(session, env) -> None:
    folder = Folder(
        organization_id=env.org_id,
        owner_id=env.admin_id,
        name="itdb-shared",
        access_mode=AccessMode.OPEN_TO_ORG,
    )
    session.add(folder)
    await session.flush()
    session.add_all([
        _file(env, folder.id, 100, AccessMode.OPEN_TO_ORG),
        _file(env, folder.id, 900, AccessMode.OWNER_ONLY),
        # NULL inherits the org default for FILE (OPEN_TO_ORG), so it counts.
        _file(env, folder.id, 10, None),
        Folder(
            organization_id=env.org_id,
            owner_id=env.admin_id,
            name="itdb-open-child",
            parent_id=folder.id,
            access_mode=AccessMode.OPEN_TO_ORG,
        ),
        # NULL inherits the org default for FOLDER (OWNER_ONLY), so it stays out.
        Folder(
            organization_id=env.org_id,
            owner_id=env.admin_id,
            name="itdb-private-child",
            parent_id=folder.id,
        ),
    ])
    await session.commit()

    folder_ops = FolderOperations(session)
    try:
        stats = await folder_ops._child_stats(folder, AccessMode.OPEN_TO_ORG)
        assert stats == {"file_count": "2", "folder_count": "1", "total_size": "110"}

        owner_view = await folder_ops._child_stats(folder, AccessMode.OWNER_ONLY)
        assert owner_view["file_count"] == "3"
        assert owner_view["folder_count"] == "2"
    finally:
        await session.rollback()
        await session.execute(delete(File).where(File.organization_id == env.org_id))
        await session.execute(delete(Folder).where(Folder.organization_id == env.org_id))
        await session.commit()


async def test_note_folder_child_count_is_visible_notes_only(session, env) -> None:
    def note(title, node_type, access_mode, parent_id=None):
        return Note(
            organization_id=env.org_id,
            owner_id=env.admin_id,
            title=title,
            slug=f"itdb-{generate_id().hex[:8]}",
            node_type=node_type,
            access_mode=access_mode,
            parent_id=parent_id,
        )

    folder_note = note("itdb-folder", NodeType.FOLDER, AccessMode.OPEN_TO_ORG)
    session.add(folder_note)
    await session.flush()
    session.add_all([
        note("itdb-open", NodeType.NOTE, AccessMode.OPEN_TO_ORG, folder_note.id),
        note("itdb-hidden", NodeType.NOTE, AccessMode.OWNER_ONLY, folder_note.id),
        note("itdb-subfolder", NodeType.FOLDER, AccessMode.OPEN_TO_ORG, folder_note.id),
    ])
    await session.commit()

    try:
        meta = await NoteProjectionOperations(
            session, MagicMock()
        )._get_search_metadata_async(folder_note)
        assert meta is not None
        assert meta["child_count"] == "1"
    finally:
        await session.rollback()
        await session.execute(
            delete(Note).where(Note.organization_id == env.org_id, Note.parent_id.is_not(None))
        )
        await session.execute(delete(Note).where(Note.organization_id == env.org_id))
        await session.commit()
