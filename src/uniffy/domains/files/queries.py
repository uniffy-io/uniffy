"""Permission-filtered file and trash queries."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import String, and_, cast, func, or_, select
from sqlalchemy.orm import selectinload

from uniffy.core.models.files.file import File
from uniffy.core.models.files.folder import Folder
from uniffy.core.models.login.group import Group
from uniffy.core.models.login.group_member import GroupMember
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.models.tags.tag import TagAssignment
from uniffy.core.types import (
    AccessMode,
    ContentRole,
    ContentType,
    ParentSelection,
    SortOrder,
    SubjectType,
)


class FileQueryOperations:
    def __init__(self, files: object) -> None:
        self.files = files
        self.session = files.session
        self.content_type = files.content_type
        self.access_query = files.access_query

    async def list_trashed_items(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> tuple[list[File], list[Folder]]:
        """Flat (files, folders) of soft-deleted items owned by the user."""
        file_access = await self.access_query.build_accessible_filter(
            user_id=user_id,
            organization_id=organization_id,
            content_type=ContentType.FILE,
            content_id_column=File.id,
            owner_id_column=File.owner_id,
            access_mode_column=File.access_mode,
            baseline_role_column=File.baseline_role,
        )
        files_result = await self.session.execute(
            select(File).where(
                File.organization_id == organization_id,
                File.owner_id == user_id,
                File.is_deleted == True,  # noqa: E712
                file_access,
            )
        )
        files = list(files_result.scalars().all())

        folder_access = await self.access_query.build_accessible_filter(
            user_id=user_id,
            organization_id=organization_id,
            content_type=ContentType.FOLDER,
            content_id_column=Folder.id,
            owner_id_column=Folder.owner_id,
            access_mode_column=Folder.access_mode,
            baseline_role_column=Folder.baseline_role,
        )
        folders_result = await self.session.execute(
            select(Folder).where(
                Folder.organization_id == organization_id,
                Folder.owner_id == user_id,
                Folder.is_deleted == True,  # noqa: E712
                folder_access,
            )
        )
        folders = list(folders_result.scalars().all())

        return files, folders

    async def list_files(
        self,
        user_id: UUID,
        organization_id: UUID,
        folder_id: UUID | ParentSelection | None = None,
        access_mode: AccessMode | None = None,
        group_id: UUID | None = None,
        personal_only: bool = False,
        shared_only: bool = False,
        include_deleted: bool = False,
        tag_ids: list[UUID] | None = None,
        page: int = 1,
        page_size: int = 50,
        sort_by: str = "updated_at",
        sort_order: SortOrder = SortOrder.DESCENDING,
    ) -> tuple[list[File], int]:
        """List files with filters; folder_id 'all' means cross-folder; tag_ids AND-joined."""
        query = select(File).where(File.organization_id == organization_id)

        access_filter = await self.access_query.build_accessible_filter(
            user_id=user_id,
            organization_id=organization_id,
            content_type=self.content_type,
            content_id_column=File.id,
            owner_id_column=File.owner_id,
            access_mode_column=File.access_mode,
            baseline_role_column=File.baseline_role,
        )
        query = query.where(access_filter)
        if personal_only:
            query = query.where(File.owner_id == user_id)
        elif shared_only:
            query = query.where(
                File.owner_id != user_id,
                File.id.in_(self._explicit_grant_subquery(user_id, organization_id)),
            )

        if group_id is not None:
            now = datetime.now(UTC)
            group_member_subq = select(ContentMember.content_id).where(
                ContentMember.organization_id == organization_id,
                ContentMember.content_type == self.content_type,
                ContentMember.subject_type == SubjectType.GROUP,
                ContentMember.subject_id == group_id,
                ContentMember.role != ContentRole.BLOCKED,
                or_(
                    ContentMember.expires_at.is_(None),
                    ContentMember.expires_at > now,
                ),
            )
            query = query.where(File.id.in_(group_member_subq))

        # Folder filter with parent access check
        if folder_id is None:
            query = query.where(File.folder_id.is_(None))
        elif folder_id != ParentSelection.ALL:
            query = query.where(File.folder_id == folder_id)
        else:
            folder_access_filter = await self.access_query.build_accessible_filter(
                user_id=user_id,
                organization_id=organization_id,
                content_type=ContentType.FOLDER,
                content_id_column=Folder.id,
                owner_id_column=Folder.owner_id,
                access_mode_column=Folder.access_mode,
                baseline_role_column=Folder.baseline_role,
            )
            accessible_folders_query = select(Folder.id).where(
                Folder.organization_id == organization_id,
                folder_access_filter,
            )
            # The folder gate hides org-baseline files that merely sit inside
            # a private folder. Ownership and explicit grants pierce it: a file
            # shared directly with this user must be listable even when its
            # parent folder is not - the folder and siblings stay hidden.
            query = query.where(
                or_(
                    File.folder_id.is_(None),
                    File.folder_id.in_(accessible_folders_query),
                    File.owner_id == user_id,
                    File.id.in_(self._explicit_grant_subquery(user_id, organization_id)),
                )
            )

        if access_mode is not None:
            query = query.where(File.access_mode == access_mode)

        if not include_deleted:
            query = query.where(File.is_deleted == False)  # noqa: E712

        if tag_ids:
            query = query.where(File.id.in_(self._tag_filter_subquery(tag_ids)))

        count_query = select(func.count()).select_from(query.subquery())
        total = (await self.session.execute(count_query)).scalar() or 0

        sort_col = getattr(File, sort_by, File.updated_at)
        if sort_order == SortOrder.ASCENDING:
            query = query.order_by(sort_col.asc())
        else:
            query = query.order_by(sort_col.desc())

        query = query.offset((page - 1) * page_size).limit(page_size)
        query = query.options(selectinload(File.media_info))

        result = await self.session.execute(query)
        files = list(result.scalars().all())

        return files, total

    def _explicit_grant_subquery(self, user_id: UUID, organization_id: UUID):
        """File ids carrying a live non-BLOCKED direct or group grant for the user."""
        now = datetime.now(UTC)
        user_groups_subq = (
            select(GroupMember.group_id)
            .join(Group, Group.id == GroupMember.group_id)
            .where(
                GroupMember.user_id == user_id,
                GroupMember.is_active.is_(True),
                Group.organization_id == organization_id,
            )
        )
        return select(ContentMember.content_id).where(
            ContentMember.organization_id == organization_id,
            ContentMember.content_type == self.content_type,
            ContentMember.role != ContentRole.BLOCKED,
            or_(
                ContentMember.expires_at.is_(None),
                ContentMember.expires_at > now,
            ),
            or_(
                and_(
                    ContentMember.subject_type == SubjectType.USER,
                    ContentMember.subject_id == user_id,
                ),
                and_(
                    ContentMember.subject_type == SubjectType.GROUP,
                    ContentMember.subject_id.in_(user_groups_subq),
                ),
            ),
        )

    def _tag_filter_subquery(self, tag_ids: list[UUID]):
        """Subquery: file ids that carry every tag id in ``tag_ids``.

        Implements logical AND by joining ``tag_assignments`` against
        the synthesized ``urn:uniffy:content:FILE:{id}`` value, grouping
        by file id, and requiring the distinct tag count to match the
        requested set size.
        """
        urn_prefix = "urn:uniffy:content:FILE:"
        urn_expr = func.concat(urn_prefix, cast(File.id, String))
        return (
            select(File.id)
            .join(TagAssignment, TagAssignment.content_urn == urn_expr)
            .where(TagAssignment.tag_id.in_(tag_ids))
            .group_by(File.id)
            .having(func.count(func.distinct(TagAssignment.tag_id)) == len(tag_ids))
        )
