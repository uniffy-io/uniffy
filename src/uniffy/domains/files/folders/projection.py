"""Folder search projection and child statistics."""

from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import func, or_, select

from uniffy.core.auth.permissions import (
    modes_at_least_as_open,
    resolve_effective_policy,
)
from uniffy.core.models.files.file import File
from uniffy.core.models.files.folder import Folder
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import (
    AccessMode,
    ContentRole,
    ContentType,
    SubjectType,
)
from uniffy.core.valkey.mentions import publish_mention_state

logger = logger.bind(component="files.folders.projection")


class FolderProjection:
    def __init__(self, folders: object) -> None:
        self.folders = folders
        self.session = folders.session
        self.content_type = folders.content_type
        self.access_query = folders.access_query
        self.permission_checker = folders.permission_checker

    async def index_for_search(
        self,
        folder: Folder,
        effective_policy: tuple[AccessMode, ContentRole | None] | None = None,
    ) -> dict[str, str] | None:
        """System folders (auto-provisioned Attachments/Recordings) stay out
        of the index; every user owning an identical copy is pure noise.
        Returns the metadata written so callers can publish it verbatim.
        """
        if folder.is_system or folder.is_deleted:
            return None

        if effective_policy is None:
            effective_policy = await self.effective_policy(folder.organization_id, folder)
        effective_mode, effective_baseline = effective_policy

        now = datetime.now(UTC)
        members = await self.session.execute(
            select(
                ContentMember.subject_type,
                ContentMember.subject_id,
                ContentMember.role,
            ).where(
                ContentMember.organization_id == folder.organization_id,
                ContentMember.content_type == ContentType.FOLDER,
                ContentMember.content_id == folder.id,
                or_(
                    ContentMember.expires_at.is_(None),
                    ContentMember.expires_at > now,
                ),
            )
        )
        shared_users: list[UUID] = []
        shared_groups: list[UUID] = []
        blocked_users: list[UUID] = []
        blocked_groups: list[UUID] = []
        for subject_type, subject_id, role in members.all():
            blocked = role == ContentRole.BLOCKED
            if subject_type == SubjectType.USER:
                (blocked_users if blocked else shared_users).append(subject_id)
            elif subject_type == SubjectType.GROUP:
                (blocked_groups if blocked else shared_groups).append(subject_id)

        parent_label = ""
        if folder.parent_id:
            parent = await self.folders.get_by_id(folder.parent_id, folder.organization_id)
            parent_label = parent.name if parent else ""

        metadata = {
            "parent_id": str(folder.parent_id) if folder.parent_id else "",
            "parent_label": parent_label,
            **await self.child_stats(folder, effective_mode),
        }

        await self.folders.search_indexer.index(
            urn=build_content_urn(ContentType.FOLDER, folder.id),
            organization_id=folder.organization_id,
            title=folder.name,
            entity_type=ContentType.FOLDER.value,
            url_path=f"/files?folder={folder.id}",
            owner_id=folder.owner_id,
            access_mode=effective_mode.value,
            baseline_role=effective_baseline.value if effective_baseline else None,
            keywords=folder.name,
            shared_user_ids=shared_users or None,
            shared_group_ids=shared_groups or None,
            blocked_user_ids=blocked_users or None,
            blocked_group_ids=blocked_groups or None,
            metadata=metadata,
        )
        return metadata

    async def effective_policy(
        self,
        organization_id: UUID,
        folder: Folder,
    ) -> tuple[AccessMode, ContentRole | None]:
        """Materialise NULL access-policy columns against the org's defaults."""
        default_mode, default_baseline = await self.permission_checker.get_org_defaults(
            organization_id, ContentType.FOLDER
        )
        return resolve_effective_policy(
            folder.access_mode, folder.baseline_role, default_mode, default_baseline
        )

    async def child_stats(self, folder: Folder, folder_mode: AccessMode) -> dict[str, str]:
        """Direct-children counts only; recursive totals would turn every
        deep mutation into a subtree walk. Children with a narrower effective
        mode stay uncounted: the stat reaches everyone who can resolve the
        folder, so it must not disclose restricted children.
        """
        allowed = modes_at_least_as_open(folder_mode)
        file_default, _ = await self.permission_checker.get_org_defaults(
            folder.organization_id, ContentType.FILE
        )
        folder_default, _ = await self.permission_checker.get_org_defaults(
            folder.organization_id, ContentType.FOLDER
        )

        def visible(mode_column, default_mode):
            condition = mode_column.in_(allowed)
            if (default_mode or AccessMode.OWNER_ONLY) in allowed:
                condition = or_(condition, mode_column.is_(None))
            return condition

        files_row = (
            await self.session.execute(
                select(
                    func.count(File.id),
                    func.coalesce(func.sum(File.size_bytes), 0),
                ).where(
                    File.folder_id == folder.id,
                    File.organization_id == folder.organization_id,
                    File.is_deleted == False,  # noqa: E712
                    visible(File.access_mode, file_default),
                )
            )
        ).one()
        subfolder_count = (
            await self.session.execute(
                select(func.count(Folder.id)).where(
                    Folder.parent_id == folder.id,
                    Folder.organization_id == folder.organization_id,
                    Folder.is_deleted == False,  # noqa: E712
                    visible(Folder.access_mode, folder_default),
                )
            )
        ).scalar_one()
        return {
            "file_count": str(files_row[0] or 0),
            "folder_count": str(subfolder_count or 0),
            "total_size": str(files_row[1] or 0),
        }

    async def refresh_folder_stats(
        self,
        folder_id: UUID | None,
        organization_id: UUID,
    ) -> None:
        """Child mutations change the folder's indexed counts; re-index and
        broadcast so visible folder chips update without a refresh. No-ops for
        root (None), system, and trashed folders.
        """
        if folder_id is None:
            return
        folder = await self.folders.get_by_id(folder_id, organization_id)
        if not folder or folder.is_deleted or folder.is_system:
            return
        try:
            effective_policy = await self.effective_policy(organization_id, folder)
            metadata = await self.index_for_search(folder, effective_policy)
            if metadata is None:
                return
            await publish_mention_state(
                organization_id=organization_id,
                urn=build_content_urn(ContentType.FOLDER, folder.id),
                changes={"title": folder.name, **metadata},
            )
        except Exception:
            logger.opt(exception=True).warning(f"Failed to refresh folder stats for {folder_id}")

    async def remove_from_search(self, folder_id: UUID) -> None:
        try:
            await self.folders.search_indexer.remove(
                build_content_urn(ContentType.FOLDER, folder_id)
            )
        except Exception:
            logger.warning(f"Search remove failed for folder {folder_id}")
