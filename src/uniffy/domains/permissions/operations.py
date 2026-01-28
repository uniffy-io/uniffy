"""Permission operations for content sharing and access control.

This module handles all business logic for permissions including
grant, revoke, update, list, and search operations.
"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models import ContentPermission, Group, User
from uniffy.core.models.login.group_member import GroupMember
from uniffy.core.models.shared import ContentType, PermissionLevel, SubjectType


class PermissionsOperations:
    """
    Permission CRUD operations.

    Handles granting, revoking, updating, and listing permissions
    for content sharing.
    """

    def __init__(self, session: AsyncSession) -> None:
        """
        Initialize permission operations.

        Parameters
        ----------
        session : AsyncSession
            SQLAlchemy async session for database operations.

        """
        self.session = session
        self.permission_checker = PermissionChecker(session)

    async def grant_permission(
        self,
        granted_by_user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
        content_owner_id: UUID,
        subject_type: SubjectType,
        subject_id: UUID,
        permission_level: PermissionLevel,
        can_view: bool = True,
        can_edit: bool = False,
        can_delete: bool = False,
        can_share: bool = False,
        can_move: bool = False,
        expires_at: datetime | None = None,
    ) -> ContentPermission:
        """
        Grant permission to a user or group on content.

        Parameters
        ----------
        granted_by_user_id : UUID
            User granting the permission.
        organization_id : UUID
            Organization the content belongs to.
        content_type : ContentType
            Type of content.
        content_id : UUID
            ID of the content.
        content_owner_id : UUID
            Owner of the content.
        subject_type : SubjectType
            Type of subject (USER or GROUP).
        subject_id : UUID
            ID of the user or group.
        permission_level : PermissionLevel
            Permission level to grant.
        can_view : bool
            Can view the content.
        can_edit : bool
            Can edit the content.
        can_delete : bool
            Can delete the content.
        can_share : bool
            Can share the content.
        can_move : bool
            Can move the content.
        expires_at : datetime | None
            Optional expiration time.

        Returns
        -------
        ContentPermission
            The created permission.

        Raises
        ------
        PermissionDeniedError
            If the user cannot share this content.

        """
        # Check if the granting user can share this content
        can_share_content = await self.permission_checker.can_share_content(
            user_id=granted_by_user_id,
            organization_id=organization_id,
            content_type=content_type,
            content_id=content_id,
            content_owner_id=content_owner_id,
        )
        if not can_share_content:
            raise PermissionDeniedError("share", "content")

        # Check if permission already exists
        existing = await self._get_existing_permission(
            organization_id=organization_id,
            content_type=content_type,
            content_id=content_id,
            subject_type=subject_type,
            subject_id=subject_id,
        )

        if existing:
            # Update existing permission
            existing.permission_level = permission_level
            existing.can_view = can_view
            existing.can_edit = can_edit
            existing.can_delete = can_delete
            existing.can_share = can_share
            existing.can_move = can_move
            existing.expires_at = expires_at
            existing.updated_at = datetime.now(UTC)
            await self.session.commit()
            await self.session.refresh(existing)
            return existing

        # Create new permission
        permission = ContentPermission(
            organization_id=organization_id,
            content_type=content_type,
            content_id=content_id,
            subject_type=subject_type,
            subject_id=subject_id,
            permission_level=permission_level,
            can_view=can_view,
            can_edit=can_edit,
            can_delete=can_delete,
            can_share=can_share,
            can_move=can_move,
            granted_by_user_id=granted_by_user_id,
            expires_at=expires_at,
        )
        self.session.add(permission)
        await self.session.commit()
        await self.session.refresh(permission)
        return permission

    async def revoke_permission(
        self,
        revoking_user_id: UUID,
        organization_id: UUID,
        permission_id: UUID,
        content_owner_id: UUID,
    ) -> bool:
        """
        Revoke a permission.

        Parameters
        ----------
        revoking_user_id : UUID
            User revoking the permission.
        organization_id : UUID
            Organization context.
        permission_id : UUID
            ID of the permission to revoke.
        content_owner_id : UUID
            Owner of the content.

        Returns
        -------
        bool
            True if revoked, False if not found.

        Raises
        ------
        PermissionDeniedError
            If the user cannot revoke this permission.

        """
        permission = await self._get_permission_by_id(permission_id, organization_id)
        if not permission:
            return False

        # Check if the revoking user can share this content
        can_share_content = await self.permission_checker.can_share_content(
            user_id=revoking_user_id,
            organization_id=organization_id,
            content_type=permission.content_type,
            content_id=permission.content_id,
            content_owner_id=content_owner_id,
        )
        if not can_share_content:
            raise PermissionDeniedError("revoke_permission", "content")

        await self.session.delete(permission)
        await self.session.commit()
        return True

    async def update_permission(
        self,
        updating_user_id: UUID,
        organization_id: UUID,
        permission_id: UUID,
        content_owner_id: UUID,
        permission_level: PermissionLevel | None = None,
        expires_at: datetime | None = None,
        clear_expiration: bool = False,
    ) -> ContentPermission:
        """
        Update an existing permission.

        Parameters
        ----------
        updating_user_id : UUID
            User updating the permission.
        organization_id : UUID
            Organization context.
        permission_id : UUID
            ID of the permission to update.
        content_owner_id : UUID
            Owner of the content.
        permission_level : PermissionLevel | None
            New permission level (optional).
        expires_at : datetime | None
            New expiration time (optional).
        clear_expiration : bool
            Clear the expiration if True.

        Returns
        -------
        ContentPermission
            The updated permission.

        Raises
        ------
        NotFoundError
            If permission not found.
        PermissionDeniedError
            If the user cannot update this permission.

        """
        permission = await self._get_permission_by_id(permission_id, organization_id)
        if not permission:
            raise NotFoundError("permission", permission_id)

        # Check if the updating user can share this content
        can_share_content = await self.permission_checker.can_share_content(
            user_id=updating_user_id,
            organization_id=organization_id,
            content_type=permission.content_type,
            content_id=permission.content_id,
            content_owner_id=content_owner_id,
        )
        if not can_share_content:
            raise PermissionDeniedError("update_permission", "content")

        if permission_level is not None:
            permission.permission_level = permission_level
            # Update fine-grained flags based on level
            if permission_level == PermissionLevel.VIEW:
                permission.can_view = True
                permission.can_edit = False
                permission.can_delete = False
                permission.can_share = False
                permission.can_move = False
            elif permission_level == PermissionLevel.EDIT:
                permission.can_view = True
                permission.can_edit = True
                permission.can_delete = False
                permission.can_share = False
                permission.can_move = False
            elif permission_level == PermissionLevel.ADMIN:
                permission.can_view = True
                permission.can_edit = True
                permission.can_delete = True
                permission.can_share = True
                permission.can_move = True

        if clear_expiration:
            permission.expires_at = None
        elif expires_at is not None:
            permission.expires_at = expires_at

        permission.updated_at = datetime.now(UTC)
        await self.session.commit()
        await self.session.refresh(permission)
        return permission

    async def list_content_permissions(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
        content_owner_id: UUID,
    ) -> tuple[list[ContentPermission], User | None]:
        """
        List all permissions for a piece of content.

        Parameters
        ----------
        user_id : UUID
            User requesting the list.
        organization_id : UUID
            Organization context.
        content_type : ContentType
            Type of content.
        content_id : UUID
            ID of the content.
        content_owner_id : UUID
            Owner of the content.

        Returns
        -------
        tuple[list[ContentPermission], User | None]
            (permissions, owner) - List of permissions and owner user.

        """
        # Get permissions (filter expired)
        now = datetime.now(UTC)
        result = await self.session.execute(
            select(ContentPermission)
            .where(ContentPermission.organization_id == organization_id)
            .where(ContentPermission.content_type == content_type)
            .where(ContentPermission.content_id == content_id)
            .where(
                or_(
                    ContentPermission.expires_at.is_(None),
                    ContentPermission.expires_at > now,
                )
            )
            .order_by(ContentPermission.granted_at.desc())
        )
        permissions = list(result.scalars().all())

        # Get owner
        owner_result = await self.session.execute(
            select(User).where(User.id == content_owner_id)
        )
        owner = owner_result.scalar_one_or_none()

        return (permissions, owner)

    async def get_my_permission(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
    ) -> ContentPermission | None:
        """
        Get the current user's effective permission on content.

        This method checks permissions in order of precedence:
        1. Organization owner/admin - full access
        2. Content owner - owner-level access
        3. Explicit permission grant

        Parameters
        ----------
        user_id : UUID
            User ID.
        organization_id : UUID
            Organization context.
        content_type : ContentType
            Type of content.
        content_id : UUID
            ID of the content.

        Returns
        -------
        ContentPermission | None
            The permission if found, None otherwise.
            For org admins and content owners, returns a synthetic permission.

        """
        from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole

        # Check if user is org owner/admin - they have full access
        org_member_result = await self.session.execute(
            select(OrganizationMember)
            .where(OrganizationMember.user_id == user_id)
            .where(OrganizationMember.organization_id == organization_id)
            .where(OrganizationMember.is_active == True)  # noqa: E712
        )
        org_member = org_member_result.scalar_one_or_none()

        if org_member and org_member.role in (OrganizationRole.OWNER, OrganizationRole.ADMIN):
            # Return synthetic permission with full access for org admins
            return ContentPermission(
                organization_id=organization_id,
                content_type=content_type,
                content_id=content_id,
                subject_type=SubjectType.USER,
                subject_id=user_id,
                permission_level=PermissionLevel.ADMIN,
                can_view=True,
                can_edit=True,
                can_delete=True,
                can_share=True,
                can_move=True,
                granted_by_user_id=user_id,
            )

        # Check if user is content owner - fetch content to verify
        content_owner_id = await self._get_content_owner_id(content_type, content_id)
        if content_owner_id and content_owner_id == user_id:
            # Return synthetic permission with owner-level access
            return ContentPermission(
                organization_id=organization_id,
                content_type=content_type,
                content_id=content_id,
                subject_type=SubjectType.USER,
                subject_id=user_id,
                permission_level=PermissionLevel.OWNER,
                can_view=True,
                can_edit=True,
                can_delete=True,
                can_share=True,
                can_move=True,
                granted_by_user_id=user_id,
            )

        # Check for explicit permission grant
        now = datetime.now(UTC)
        result = await self.session.execute(
            select(ContentPermission)
            .where(ContentPermission.organization_id == organization_id)
            .where(ContentPermission.content_type == content_type)
            .where(ContentPermission.content_id == content_id)
            .where(ContentPermission.subject_type == SubjectType.USER)
            .where(ContentPermission.subject_id == user_id)
            .where(
                or_(
                    ContentPermission.expires_at.is_(None),
                    ContentPermission.expires_at > now,
                )
            )
        )
        return result.scalar_one_or_none()

    async def _get_content_owner_id(
        self,
        content_type: ContentType,
        content_id: UUID,
    ) -> UUID | None:
        """
        Get the owner ID for a piece of content.

        Parameters
        ----------
        content_type : ContentType
            Type of content.
        content_id : UUID
            ID of the content.

        Returns
        -------
        UUID | None
            The owner user ID if found, None otherwise.

        """
        # Map content types to their model classes
        if content_type == ContentType.NOTE:
            from uniffy.core.models.notes.note import Note
            result = await self.session.execute(
                select(Note.owner_id).where(Note.id == content_id)
            )
            return result.scalar_one_or_none()
        # Add other content types as needed
        return None

    async def search_share_targets(
        self,
        organization_id: UUID,
        query: str,
        limit: int = 10,
        include_users: bool = True,
        include_groups: bool = True,
    ) -> list[tuple[User | Group, int]]:
        """
        Search for users and groups to share with.

        Parameters
        ----------
        organization_id : UUID
            Organization context.
        query : str
            Search query (name or email).
        limit : int
            Maximum results.
        include_users : bool
            Include users in results.
        include_groups : bool
            Include groups in results.

        Returns
        -------
        list[tuple[User | Group, int]]
            List of (user/group, member_count) tuples.

        """
        results: list[tuple[User | Group, int]] = []

        if include_users and query:
            # Search users in this organization
            from uniffy.core.models.login.organization_member import OrganizationMember

            user_query = (
                select(User)
                .join(OrganizationMember, OrganizationMember.user_id == User.id)
                .where(OrganizationMember.organization_id == organization_id)
                .where(OrganizationMember.is_active == True)  # noqa: E712
                .where(
                    or_(
                        User.email.ilike(f"%{query}%"),
                        User.full_name.ilike(f"%{query}%"),
                        User.username.ilike(f"%{query}%"),
                    )
                )
                .limit(limit)
            )
            user_result = await self.session.execute(user_query)
            for user in user_result.scalars().all():
                results.append((user, 0))

        if include_groups and query:
            # Search groups in this organization
            group_query = (
                select(Group)
                .where(Group.organization_id == organization_id)
                .where(
                    or_(
                        Group.name.ilike(f"%{query}%"),
                        Group.description.ilike(f"%{query}%"),
                    )
                )
                .limit(limit)
            )
            group_result = await self.session.execute(group_query)

            for group in group_result.scalars().all():
                # Get member count
                count_query = select(func.count()).select_from(
                    select(GroupMember)
                    .where(GroupMember.group_id == group.id)
                    .where(GroupMember.is_active == True)  # noqa: E712
                    .subquery()
                )
                count_result = await self.session.execute(count_query)
                member_count = count_result.scalar() or 0
                results.append((group, member_count))

        return results[:limit]

    async def get_permission_subject(
        self,
        permission: ContentPermission,
    ) -> tuple[User | Group | None, int]:
        """
        Get the subject (user or group) of a permission.

        Parameters
        ----------
        permission : ContentPermission
            The permission.

        Returns
        -------
        tuple[User | Group | None, int]
            (subject, member_count) - The subject and member count for groups.

        """
        if permission.subject_type == SubjectType.USER:
            result = await self.session.execute(
                select(User).where(User.id == permission.subject_id)
            )
            return (result.scalar_one_or_none(), 0)
        else:
            result = await self.session.execute(
                select(Group).where(Group.id == permission.subject_id)
            )
            group = result.scalar_one_or_none()
            if group:
                count_query = select(func.count()).select_from(
                    select(GroupMember)
                    .where(GroupMember.group_id == group.id)
                    .where(GroupMember.is_active == True)  # noqa: E712
                    .subquery()
                )
                count_result = await self.session.execute(count_query)
                member_count = count_result.scalar() or 0
                return (group, member_count)
            return (None, 0)

    async def get_user_by_id(self, user_id: UUID) -> User | None:
        """Get a user by ID."""
        result = await self.session.execute(
            select(User).where(User.id == user_id)
        )
        return result.scalar_one_or_none()

    async def _get_existing_permission(
        self,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
        subject_type: SubjectType,
        subject_id: UUID,
    ) -> ContentPermission | None:
        """Get existing permission for a subject on content."""
        result = await self.session.execute(
            select(ContentPermission)
            .where(ContentPermission.organization_id == organization_id)
            .where(ContentPermission.content_type == content_type)
            .where(ContentPermission.content_id == content_id)
            .where(ContentPermission.subject_type == subject_type)
            .where(ContentPermission.subject_id == subject_id)
        )
        return result.scalar_one_or_none()

    async def _get_permission_by_id(
        self,
        permission_id: UUID,
        organization_id: UUID,
    ) -> ContentPermission | None:
        """Get permission by ID."""
        result = await self.session.execute(
            select(ContentPermission)
            .where(ContentPermission.id == permission_id)
            .where(ContentPermission.organization_id == organization_id)
        )
        return result.scalar_one_or_none()
