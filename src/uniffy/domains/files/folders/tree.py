"""Folder tree creation and system-folder provisioning."""

from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert

from uniffy.core.auth.permissions import (
    resolve_access_policy,
)
from uniffy.core.errors import NotFoundError
from uniffy.core.models.files.folder import Folder
from uniffy.core.types import (
    AccessMode,
    ContentRole,
    ContentType,
)

logger = logger.bind(component="files.folders.tree")


class FolderTreeOperations:
    def __init__(self, folders: object) -> None:
        self.folders = folders
        self.session = folders.session
        self.content_type = folders.content_type
        self.access_query = folders.access_query
        self.permission_checker = folders.permission_checker

    async def create_folder_tree(
        self,
        user_id: UUID,
        organization_id: UUID,
        tree: list[dict],
        parent_id: UUID | None = None,
        access_mode: AccessMode | None = None,
        baseline_role: ContentRole | None = None,
    ) -> list[dict]:
        """Create a folder tree in one transaction; returns flat [{id, name, path, parent_id}]."""
        access_mode, baseline_role = await resolve_access_policy(
            self.session,
            organization_id,
            ContentType.FOLDER,
            access_mode,
            baseline_role,
        )

        created: list[dict] = []
        created_folders: list[Folder] = []

        async def create_recursive(
            nodes: list[dict],
            current_parent_id: UUID | None,
            path_prefix: str,
            depth: int,
        ) -> None:
            if depth > 20:
                return

            for node in nodes:
                name = node.get("name", "")
                if not name:
                    continue

                path = f"{path_prefix}/{name}" if path_prefix else name

                folder = Folder(
                    organization_id=organization_id,
                    owner_id=user_id,
                    name=name,
                    parent_id=current_parent_id,
                    access_mode=access_mode,
                    baseline_role=baseline_role,
                )
                self.session.add(folder)
                await self.session.flush()

                created.append({
                    "id": folder.id,
                    "name": folder.name,
                    "path": path,
                    "parent_id": current_parent_id,
                })
                created_folders.append(folder)

                children = node.get("children", [])
                if children:
                    await create_recursive(children, folder.id, path, depth + 1)

        await create_recursive(tree, parent_id, "", 0)
        await self.session.commit()

        for folder in created_folders:
            try:
                await self.folders.projection.index_for_search(folder)
            except Exception:
                logger.opt(exception=True).warning(f"Search index failed for folder {folder.id}")

        # The dropped tree changes the destination folder's subfolder count.
        await self.folders.refresh_folder_stats(parent_id, organization_id)

        return created

    async def ensure_named_folder(
        self,
        user_id: UUID,
        organization_id: UUID,
        name: str,
    ) -> Folder:
        """Lazily create or fetch a per-user root folder by name.

        Idempotent under concurrency: 15-20 backend instances may all attempt
        to create the same auto-provisioned folder (e.g. "Recordings") on the
        user's first upload. The partial unique index
        ``uq_folders_owner_root_name_active`` covers
        ``(owner_id, organization_id, name) WHERE parent_id IS NULL AND
        is_deleted = false`` so concurrent inserts deterministically fold
        into a single row.

        Used for system-managed folders ("Recordings", "Attachments"). Always
        creates at the personal scope (``OWNER_ONLY``). Always at the root
        (``parent_id = NULL``).
        """
        existing = await self.session.execute(
            select(Folder).where(
                Folder.organization_id == organization_id,
                Folder.owner_id == user_id,
                Folder.name == name,
                Folder.parent_id.is_(None),
                Folder.is_deleted == False,  # noqa: E712
            )
        )
        folder = existing.scalar_one_or_none()
        if folder is not None:
            return folder

        now = datetime.now(UTC)
        stmt = (
            pg_insert(Folder)
            .values(
                organization_id=organization_id,
                owner_id=user_id,
                name=name,
                parent_id=None,
                access_mode=AccessMode.OWNER_ONLY,
                baseline_role=None,
                is_system=True,
                is_deleted=False,
                created_at=now,
                updated_at=now,
            )
            .on_conflict_do_nothing(
                index_elements=["owner_id", "organization_id", "name"],
                index_where=text("parent_id IS NULL AND is_deleted = false AND is_system = true"),
            )
        )
        await self.session.execute(stmt)
        await self.session.commit()

        result = await self.session.execute(
            select(Folder).where(
                Folder.organization_id == organization_id,
                Folder.owner_id == user_id,
                Folder.name == name,
                Folder.parent_id.is_(None),
                Folder.is_deleted == False,  # noqa: E712
            )
        )
        folder = result.scalar_one_or_none()
        if folder is None:
            raise NotFoundError("Folder", name)
        return folder
