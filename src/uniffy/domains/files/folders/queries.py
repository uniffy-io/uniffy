"""Permission-filtered folder queries."""

from uuid import UUID

from sqlalchemy import select

from uniffy.core.models.files.folder import Folder
from uniffy.core.types import (
    AccessMode,
)


class FolderQueryOperations:
    def __init__(self, folders: object) -> None:
        self.folders = folders
        self.session = folders.session
        self.content_type = folders.content_type
        self.access_query = folders.access_query
        self.permission_checker = folders.permission_checker

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
        """List folders with permission filtering.

        ``limit`` is opt-in: the sidebar tree is a full-set caller and asks for
        every folder it can see. Anything that renders into a bounded surface
        (an agent tool result, an API page) passes one.
        """
        query = select(Folder).where(Folder.organization_id == organization_id)

        access_filter = await self.access_query.build_accessible_filter(
            user_id=user_id,
            organization_id=organization_id,
            content_type=self.content_type,
            content_id_column=Folder.id,
            owner_id_column=Folder.owner_id,
            access_mode_column=Folder.access_mode,
            baseline_role_column=Folder.baseline_role,
        )
        query = query.where(access_filter)
        if personal_only:
            query = query.where(Folder.owner_id == user_id)

        if parent_id is None:
            query = query.where(Folder.parent_id.is_(None))
        else:
            query = query.where(Folder.parent_id == parent_id)

        if access_mode is not None:
            query = query.where(Folder.access_mode == access_mode)

        if not include_deleted:
            query = query.where(Folder.is_deleted == False)  # noqa: E712

        query = query.order_by(Folder.name.asc())
        if limit is not None:
            query = query.offset(offset).limit(limit)

        result = await self.session.execute(query)
        return list(result.scalars().all())

    async def list_accessible_folders(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> list[Folder]:
        """Every live folder the user can access, regardless of nesting."""
        access_filter = await self.access_query.build_accessible_filter(
            user_id=user_id,
            organization_id=organization_id,
            content_type=self.content_type,
            content_id_column=Folder.id,
            owner_id_column=Folder.owner_id,
            access_mode_column=Folder.access_mode,
            baseline_role_column=Folder.baseline_role,
        )
        result = await self.session.execute(
            select(Folder)
            .where(
                Folder.organization_id == organization_id,
                Folder.is_deleted == False,  # noqa: E712
                access_filter,
            )
            .order_by(Folder.name.asc())
        )
        return list(result.scalars().all())
