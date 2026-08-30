"""Folder delete publishes a mention tombstone; restore re-broadcasts the subtree."""

import pytest
from sqlalchemy import delete

from uniffy.core.models.files.folder import Folder
from uniffy.domains.files.operations import FolderOperations

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_folder_delete_tombstones_and_restore_republishes(
    session, env, search_indexer, monkeypatch
) -> None:
    published: list[tuple[str, dict]] = []

    async def capture(organization_id, urn, changes):
        published.append((urn, dict(changes)))

    monkeypatch.setattr(
        "uniffy.domains.files.folders.trash.publish_mention_state",
        capture,
    )
    monkeypatch.setattr(
        "uniffy.domains.files.folders.projection.publish_mention_state",
        capture,
    )

    folder_ops = FolderOperations(session, search_indexer=search_indexer)
    try:
        parent = await folder_ops.create(env.admin_id, env.org_id, "itdb-parent")
        child = await folder_ops.create(env.admin_id, env.org_id, "itdb-child", parent_id=parent.id)
        parent_urn = f"urn:uniffy:content:FOLDER:{parent.id}"
        child_urn = f"urn:uniffy:content:FOLDER:{child.id}"

        published.clear()
        await folder_ops.delete(env.admin_id, env.org_id, parent.id, permanent=False, recursive=True)
        tombstones = [
            p for p in published if p[0] == parent_urn and p[1].get("urn_status") == "DELETED"
        ]
        assert len(tombstones) == 1
        assert tombstones[0][1] == {"urn_status": "DELETED"}

        published.clear()
        await folder_ops.restore_folder(env.admin_id, env.org_id, parent.id)
        assert any(p[0] == child_urn for p in published)
        assert any(p[0] == parent_urn for p in published)
    finally:
        await session.rollback()
        await session.execute(delete(Folder).where(Folder.organization_id == env.org_id))
        await session.commit()
