"""Folder rename fans out to child folders; tree drops refresh the destination."""

from unittest.mock import AsyncMock

import pytest
from sqlalchemy import delete

from uniffy.core.models.files.file import File
from uniffy.core.models.files.folder import Folder
from uniffy.core.search.indexer import SearchIndexer
from uniffy.domains.files.operations import FolderOperations

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _capture_publishes(monkeypatch) -> list[tuple[str, dict]]:
    published: list[tuple[str, dict]] = []

    async def capture(organization_id, urn, changes, restricted=False):
        published.append((urn, dict(changes)))

    monkeypatch.setattr(
        "uniffy.domains.files.operations.publish_mention_state", capture
    )
    return published


async def _cleanup(session, org_id) -> None:
    await session.rollback()
    await session.execute(delete(File).where(File.organization_id == org_id))
    await session.execute(delete(Folder).where(Folder.organization_id == org_id))
    await session.commit()


async def test_rename_republishes_child_files_and_folders(
    session, env, monkeypatch
) -> None:
    monkeypatch.setattr(SearchIndexer, "index", AsyncMock())
    published = await _capture_publishes(monkeypatch)

    folder_ops = FolderOperations(session)
    try:
        parent = await folder_ops.create(env.admin_id, env.org_id, "itdb-old-name")
        child_folder = await folder_ops.create(
            env.admin_id, env.org_id, "itdb-nested", parent_id=parent.id
        )
        child_file = File(
            organization_id=env.org_id,
            owner_id=env.admin_id,
            filename="itdb-doc.txt",
            original_filename="itdb-doc.txt",
            mime_type="text/plain",
            size_bytes=10,
            storage_key="itdb/doc",
            storage_bucket="itdb",
            folder_id=parent.id,
        )
        session.add(child_file)
        await session.commit()

        published.clear()
        await folder_ops.update(
            env.admin_id, env.org_id, parent.id, name="itdb-new-name"
        )

        by_urn = {urn: changes for urn, changes in published}
        file_urn = f"urn:uniffy:content:FILE:{child_file.id}"
        child_folder_urn = f"urn:uniffy:content:FOLDER:{child_folder.id}"
        assert by_urn[file_urn]["parent_label"] == "itdb-new-name"
        assert by_urn[child_folder_urn]["parent_label"] == "itdb-new-name"
    finally:
        await _cleanup(session, env.org_id)


async def test_create_folder_tree_refreshes_destination(
    session, env, monkeypatch
) -> None:
    monkeypatch.setattr(SearchIndexer, "index", AsyncMock())
    published = await _capture_publishes(monkeypatch)

    folder_ops = FolderOperations(session)
    try:
        destination = await folder_ops.create(env.admin_id, env.org_id, "itdb-dest")
        published.clear()

        await folder_ops.create_folder_tree(
            env.admin_id,
            env.org_id,
            tree=[{"name": "itdb-dropped", "children": [{"name": "itdb-inner"}]}],
            parent_id=destination.id,
        )

        destination_urn = f"urn:uniffy:content:FOLDER:{destination.id}"
        updates = [c for urn, c in published if urn == destination_urn]
        assert updates and updates[-1]["folder_count"] == "1"
    finally:
        await _cleanup(session, env.org_id)
