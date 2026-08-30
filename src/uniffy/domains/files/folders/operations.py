"""Public folder operations façade."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions import (
    PermissionChecker,
    role_can_delete,
    role_can_edit,
    role_can_view,
)
from uniffy.core.auth.permissions.queries import ContentAccessQuery
from uniffy.core.errors import PermissionDeniedError
from uniffy.core.models.files.folder import Folder
from uniffy.core.search import SearchIndexer
from uniffy.core.storage import ObjectStorage
from uniffy.core.types import AccessMode, ContentRole, ContentType
from uniffy.domains.files.folders.mutations import FolderMutationOperations
from uniffy.domains.files.folders.projection import FolderProjection
from uniffy.domains.files.folders.queries import FolderQueryOperations
from uniffy.domains.files.folders.trash import FolderTrashOperations
from uniffy.domains.files.folders.tree import FolderTreeOperations
from uniffy.domains.files.registration import register_file_content


class FolderOperations:
    def __init__(
        self,
        session: AsyncSession,
        storage: ObjectStorage | None = None,
        search_indexer: SearchIndexer | None = None,
    ) -> None:
        register_file_content()
        self.session = session
        self.content_type = ContentType.FOLDER
        self.access_query = ContentAccessQuery(session)
        self.permission_checker = PermissionChecker(session)
        self._storage = storage
        self._search_indexer = search_indexer
        self.projection = FolderProjection(self)
        self.mutations = FolderMutationOperations(self)
        self.trash = FolderTrashOperations(self)
        self.tree = FolderTreeOperations(self)
        self.queries = FolderQueryOperations(self)

    @property
    def storage(self) -> ObjectStorage:
        if self._storage is None:
            raise RuntimeError("Object storage is required for this folder operation")
        return self._storage

    @property
    def search_indexer(self) -> SearchIndexer:
        if self._search_indexer is None:
            raise RuntimeError("Search indexing is required for folder mutations")
        return self._search_indexer

    async def _role_for(
        self,
        user_id: UUID,
        organization_id: UUID,
        folder: Folder,
    ) -> ContentRole | None:
        return await self.permission_checker.effective_role(
            user_id=user_id,
            organization_id=organization_id,
            content_type=self.content_type,
            content_id=folder.id,
            owner_id=folder.owner_id,
            access_mode=folder.access_mode,
            baseline_role=folder.baseline_role,
        )

    async def require_view(
        self,
        user_id: UUID,
        organization_id: UUID,
        folder: Folder,
    ) -> None:
        if not role_can_view(await self._role_for(user_id, organization_id, folder)):
            raise PermissionDeniedError("view", "folder")

    async def require_edit(
        self,
        user_id: UUID,
        organization_id: UUID,
        folder: Folder,
    ) -> None:
        if not role_can_edit(await self._role_for(user_id, organization_id, folder)):
            raise PermissionDeniedError("edit", "folder")

    async def require_delete(
        self,
        user_id: UUID,
        organization_id: UUID,
        folder: Folder,
    ) -> None:
        if not role_can_delete(await self._role_for(user_id, organization_id, folder)):
            raise PermissionDeniedError("delete", "folder")

    async def get_by_id(
        self,
        folder_id: UUID,
        organization_id: UUID,
    ) -> Folder | None:
        result = await self.session.execute(
            select(Folder).where(
                Folder.id == folder_id,
                Folder.organization_id == organization_id,
            )
        )
        return result.scalar_one_or_none()

    async def _index_for_search(
        self,
        folder: Folder,
        effective_policy: tuple[AccessMode, ContentRole | None] | None = None,
    ) -> dict[str, str] | None:
        return await self.projection.index_for_search(folder, effective_policy)

    async def _effective_policy(
        self,
        organization_id: UUID,
        folder: Folder,
    ) -> tuple[AccessMode, ContentRole | None]:
        return await self.projection.effective_policy(organization_id, folder)

    async def _child_stats(
        self,
        folder: Folder,
        folder_mode: AccessMode,
    ) -> dict[str, str]:
        return await self.projection.child_stats(folder, folder_mode)

    async def refresh_folder_stats(
        self,
        folder_id: UUID | None,
        organization_id: UUID,
    ) -> None:
        await self.projection.refresh_folder_stats(folder_id, organization_id)

    async def _remove_from_search(self, folder_id: UUID) -> None:
        await self.projection.remove_from_search(folder_id)

    async def _require_moveable_under(
        self,
        folder_id: UUID,
        parent_id: UUID,
        organization_id: UUID,
    ) -> None:
        await self.mutations._require_moveable_under(folder_id, parent_id, organization_id)

    async def create(
        self,
        user_id: UUID,
        organization_id: UUID,
        name: str,
        parent_id: UUID | None = None,
        access_mode: AccessMode | None = None,
        baseline_role: ContentRole | None = None,
    ) -> Folder:
        return await self.mutations.create(
            user_id,
            organization_id,
            name,
            parent_id,
            access_mode,
            baseline_role,
        )

    async def update(
        self,
        user_id: UUID,
        organization_id: UUID,
        folder_id: UUID,
        name: str | None = None,
        parent_id: UUID | None | str = None,
        refresh_parent_stats: bool = True,
    ) -> Folder:
        return await self.mutations.update(
            user_id,
            organization_id,
            folder_id,
            name,
            parent_id,
            refresh_parent_stats,
        )

    async def _refresh_children_after_rename(
        self,
        folder_id: UUID,
        parent_label: str,
        organization_id: UUID,
    ) -> None:
        await self.mutations._refresh_children_after_rename(
            folder_id,
            parent_label,
            organization_id,
        )

    async def delete(
        self,
        user_id: UUID,
        organization_id: UUID,
        folder_id: UUID,
        permanent: bool = False,
        recursive: bool = False,
    ) -> tuple[int, int]:
        return await self.trash.delete(
            user_id,
            organization_id,
            folder_id,
            permanent,
            recursive,
        )

    async def restore_folder(
        self,
        user_id: UUID,
        organization_id: UUID,
        folder_id: UUID,
    ) -> Folder:
        return await self.trash.restore_folder(user_id, organization_id, folder_id)

    async def create_folder_tree(
        self,
        user_id: UUID,
        organization_id: UUID,
        tree: list[dict],
        parent_id: UUID | None = None,
        access_mode: AccessMode | None = None,
        baseline_role: ContentRole | None = None,
    ) -> list[dict]:
        return await self.tree.create_folder_tree(
            user_id,
            organization_id,
            tree,
            parent_id,
            access_mode,
            baseline_role,
        )

    async def ensure_named_folder(
        self,
        user_id: UUID,
        organization_id: UUID,
        name: str,
    ) -> Folder:
        return await self.tree.ensure_named_folder(user_id, organization_id, name)

    async def list_folders(
        self,
        user_id: UUID,
        organization_id: UUID,
        parent_id: UUID | None = None,
        include_deleted: bool = False,
        personal_only: bool = False,
        access_mode: AccessMode | None = None,
        limit: int | None = None,
        offset: int = 0,
    ) -> list[Folder]:
        return await self.queries.list_folders(
            user_id,
            organization_id,
            parent_id,
            include_deleted,
            personal_only,
            access_mode,
            limit,
            offset,
        )

    async def list_accessible_folders(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> list[Folder]:
        return await self.queries.list_accessible_folders(user_id, organization_id)
