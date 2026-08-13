"""Folder delete publishes a mention tombstone; restore re-broadcasts the subtree."""

from unittest.mock import AsyncMock

import pytest
from sqlalchemy import delete

from uniffy.core.models.files.folder import Folder
from uniffy.core.search.indexer import SearchIndexer
from uniffy.domains.files.operations import FolderOperations

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_folder_delete_tombstones_and_restore_republishes(
    session, env, monkeypatch
) -> None:
    monkeypatch.setattr(SearchIndexer, "index", AsyncMock())
    monkeypatch.setattr(SearchIndexer, "remove", AsyncMock())
    published: list[tuple[str, dict, bool]] = []

    async def capture(organization_id, urn, changes, restricted=False):
        published.append((urn, dict(changes), restricted))

    monkeypatch.setattr(
        "uniffy.domains.files.operations.publish_mention_state", capture
    )

    folder_ops = FolderOperations(session)
    try:
        parent = await folder_ops.create(env.admin_id, env.org_id, "itdb-parent")
        child = await folder_ops.create(
            env.admin_id, env.org_id, "itdb-child", parent_id=parent.id
        )
        parent_urn = f"urn:uniffy:content:FOLDER:{parent.id}"
        child_urn = f"urn:uniffy:content:FOLDER:{child.id}"

        published.clear()
        await folder_ops.delete(
            env.admin_id, env.org_id, parent.id, permanent=False, recursive=True
        )
        tombstones = [
            p
            for p in published
            if p[0] == parent_urn and p[1].get("urn_status") == "DELETED"
        ]
        assert len(tombstones) == 1
        # A default-created folder resolves to OWNER_ONLY, so the tombstone
        # must ride the recipient-gated path.
        assert tombstones[0][2] is True

        published.clear()
        await folder_ops.restore_folder(env.admin_id, env.org_id, parent.id)
        assert any(p[0] == child_urn for p in published)
        assert any(p[0] == parent_urn for p in published)
    finally:
        await session.rollback()
        await session.execute(delete(Folder).where(Folder.organization_id == env.org_id))
        await session.commit()
