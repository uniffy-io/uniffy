"""Folder creation, metadata, and placement mutations."""

from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import select

from uniffy.core.auth.permissions import (
    resolve_access_policy,
)
from uniffy.core.converters.common_proto import content_type_to_proto
from uniffy.core.errors import NotFoundError, ValidationError
from uniffy.core.models.files.file import File
from uniffy.core.models.files.folder import Folder
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import (
    AccessMode,
    ContentRole,
    ContentType,
)
from uniffy.core.valkey import ContentAccessAction, publish_content_access_changed
from uniffy.core.valkey.mentions import publish_mention_state
from uniffy.domains.files.search import FileSearchOperations

logger = logger.bind(component="files.folders.mutations")

_MAX_FOLDER_DEPTH = 64


class FolderMutationOperations:
    def __init__(self, folders: object) -> None:
        self.folders = folders
        self.session = folders.session
        self.content_type = folders.content_type
        self.access_query = folders.access_query
        self.permission_checker = folders.permission_checker

    async def _require_moveable_under(
        self,
        folder_id: UUID,
        parent_id: UUID,
        organization_id: UUID,
    ) -> None:
        """Refuse a move that would detach a subtree by filing a folder under
        itself or under one of its own descendants.
        """
        if parent_id == folder_id:
            raise ValidationError("parent_id", "A folder cannot be its own parent")

        current: UUID | None = parent_id
        # Bounded so a cycle already present in the data cannot spin here.
        for _ in range(_MAX_FOLDER_DEPTH):
            if current is None:
                return
            if current == folder_id:
                raise ValidationError("parent_id", "Cannot move a folder into its own subtree")
            current = (
                await self.session.execute(
                    select(Folder.parent_id).where(
                        Folder.id == current,
                        Folder.organization_id == organization_id,
                    )
                )
            ).scalar_one_or_none()

        raise ValidationError("parent_id", "Folder nesting is too deep")

    async def create(
        self,
        user_id: UUID,
        organization_id: UUID,
        name: str,
        parent_id: UUID | None = None,
        access_mode: AccessMode | None = None,
        baseline_role: ContentRole | None = None,
    ) -> Folder:
        """Create a new folder."""
        access_mode, baseline_role = await resolve_access_policy(
            self.session,
            organization_id,
            ContentType.FOLDER,
            access_mode,
            baseline_role,
        )

        folder = Folder(
            organization_id=organization_id,
            owner_id=user_id,
            name=name,
            parent_id=parent_id,
            access_mode=access_mode,
            baseline_role=baseline_role,
        )

        self.session.add(folder)
        await self.session.commit()
        await self.session.refresh(folder)

        # FolderOperations is standalone (not a BaseContentOperations subclass),
        # so it broadcasts the org-wide refresh directly. resolve_access_policy
        # above already materialised any inherited mode into access_mode.
        if access_mode == AccessMode.OPEN_TO_ORG:
            await publish_content_access_changed(
                content_type=content_type_to_proto(ContentType.FOLDER),
                content_id=folder.id,
                action=ContentAccessAction.GRANTED,
                organization_id=organization_id,
            )

        try:
            await self.folders.projection.index_for_search(folder)
        except Exception:
            logger.warning(f"Search index failed for folder {folder.id}")

        await self.folders.refresh_folder_stats(parent_id, organization_id)

        return folder

    async def get_by_id(
        self,
        folder_id: UUID,
        organization_id: UUID,
    ) -> Folder | None:
        """Get a folder by ID."""
        result = await self.session.execute(
            select(Folder).where(
                Folder.id == folder_id,
                Folder.organization_id == organization_id,
            )
        )
        return result.scalar_one_or_none()

    async def update(
        self,
        user_id: UUID,
        organization_id: UUID,
        folder_id: UUID,
        name: str | None = None,
        parent_id: UUID | None | str = None,
        refresh_parent_stats: bool = True,
    ) -> Folder:
        """Update a folder's metadata.

        Access policy changes (access mode, members) go through the
        MembersService, not this method. ``refresh_parent_stats=False`` lets
        bulk movers refresh each affected parent once after their loop.
        """
        folder = await self.folders.get_by_id(folder_id, organization_id)
        if not folder:
            raise NotFoundError("Folder", folder_id)

        await self.folders.require_edit(user_id, organization_id, folder)

        if isinstance(parent_id, UUID):
            await self._require_moveable_under(folder.id, parent_id, organization_id)

        previous_parent_id = folder.parent_id
        name_changed = name is not None and name != folder.name
        if name is not None:
            if len(name) > 255:
                raise ValidationError("name", "Folder name must be 255 characters or fewer")
            folder.name = name
        if parent_id == "":
            folder.parent_id = None
        elif parent_id is not None:
            folder.parent_id = parent_id

        folder.updated_at = datetime.now(UTC)

        await self.session.commit()
        await self.session.refresh(folder)

        # Re-index + broadcast the folder's own chip state (title, breadcrumb, counts).
        await self.folders.refresh_folder_stats(folder.id, organization_id)

        # Folder rename: every direct child (file or folder) carries the
        # folder name as ``parent_label`` in its search-index metadata, so
        # re-index them and broadcast a mention-state change so visible
        # chips pick up the new breadcrumb without a refresh.
        if name_changed:
            await self._refresh_children_after_rename(folder.id, folder.name, organization_id)

        if folder.parent_id != previous_parent_id and refresh_parent_stats:
            await self.folders.refresh_folder_stats(previous_parent_id, organization_id)
            await self.folders.refresh_folder_stats(folder.parent_id, organization_id)

        return folder

    async def _refresh_children_after_rename(
        self,
        folder_id: UUID,
        parent_label: str,
        organization_id: UUID,
    ) -> None:
        """Re-index every active direct child and broadcast the new
        ``parent_label`` so mention chips update live. Child folders route
        through ``refresh_folder_stats`` so each re-index ships with its
        recipient-gated broadcast.
        """
        file_ops = FileSearchOperations(self.session)
        result = await self.session.execute(
            select(File).where(
                File.folder_id == folder_id,
                File.organization_id == organization_id,
                File.is_deleted == False,  # noqa: E712
            )
        )
        files = list(result.scalars().all())
        for f in files:
            try:
                await file_ops._index_for_search(f)
            except Exception:
                logger.opt(exception=True).warning(
                    f"Failed to re-index file {f.id} after folder rename"
                )
            try:
                await publish_mention_state(
                    organization_id=f.organization_id,
                    urn=build_content_urn(ContentType.FILE, f.id),
                    changes={"parent_label": parent_label},
                )
            except Exception:
                logger.opt(exception=True).warning(f"Failed to publish parent_label for file {f.id}")

        child_folder_ids = list(
            (
                await self.session.execute(
                    select(Folder.id).where(
                        Folder.parent_id == folder_id,
                        Folder.organization_id == organization_id,
                        Folder.is_deleted == False,  # noqa: E712
                    )
                )
            ).scalars()
        )
        for child_id in child_folder_ids:
            await self.folders.refresh_folder_stats(child_id, organization_id)
