"""MoveItems refreshes each affected folder's stats once, not once per item."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import delete
from uniffy_proto.files.v1.files_pb2 import MoveItemsRequest

from uniffy.core.models.files.file import File
from uniffy.core.models.files.folder import Folder
from uniffy.core.search.indexer import SearchIndexer
from uniffy.domains.files.handlers import FilesHandlers
from uniffy.domains.files.operations import FolderOperations

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_move_items_refreshes_each_affected_folder_once(
    session, env, monkeypatch
) -> None:
    # No Meilisearch in this suite; the assertion is the refresh fan-out.
    monkeypatch.setattr(SearchIndexer, "index", AsyncMock())
    monkeypatch.setattr(SearchIndexer, "remove", AsyncMock())

    source = Folder(organization_id=env.org_id, owner_id=env.admin_id, name="itdb-src")
    target = Folder(organization_id=env.org_id, owner_id=env.admin_id, name="itdb-dst")
    session.add_all([source, target])
    await session.flush()
    files = [
        File(
            organization_id=env.org_id,
            owner_id=env.admin_id,
            filename=f"itdb-{i}.txt",
            original_filename=f"itdb-{i}.txt",
            mime_type="text/plain",
            size_bytes=10,
            storage_key=f"itdb/{i}",
            storage_bucket="itdb",
            folder_id=source.id,
        )
        for i in range(5)
    ]
    session.add_all(files)
    await session.commit()

    refreshed: list = []
    original = FolderOperations.refresh_folder_stats

    async def counting(self, folder_id, organization_id):
        refreshed.append(folder_id)
        return await original(self, folder_id, organization_id)

    monkeypatch.setattr(FolderOperations, "refresh_folder_stats", counting)

    request = MoveItemsRequest(
        organization_id=str(env.org_id),
        file_ids=[str(f.id) for f in files],
        target_folder_id=str(target.id),
    )
    try:
        with patch(
            "uniffy.domains.files.handlers.get_user_id_from_context",
            MagicMock(return_value=env.admin_id),
        ):
            response = await FilesHandlers().move_items(request, MagicMock())

        assert response.files_moved == 5
        assert sorted(refreshed, key=str) == sorted([source.id, target.id], key=str)

        for f in files:
            await session.refresh(f)
            assert f.folder_id == target.id
    finally:
        await session.rollback()
        await session.execute(delete(File).where(File.organization_id == env.org_id))
        await session.execute(delete(Folder).where(Folder.organization_id == env.org_id))
        await session.commit()
