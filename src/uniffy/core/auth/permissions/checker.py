"""
Core permission checking logic for all content types.

Provides centralized permission verification based on:
- Organization role (OWNER/ADMIN have elevated access)
- Content ownership
- Visibility scope (private, group, organization, public)
- Group membership
- Explicit permission grants (with expiration support)
"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.types import (
    ContentType,
    PermissionLevel,
    SubjectType,
    VisibilityScope,
)


class PermissionChecker:
    """
    Core permission checking service for all content types.

    Provides centralized logic for verifying user access to content
    based on visibility, group membership, and explicit permissions.

    Parameters
    ----------
    session : AsyncSession
        Database session for queries.

    """

    def __init__(self, session: AsyncSession) -> None:
        """
        Initialize the permission checker.

        Parameters
        ----------
        session : AsyncSession
            Database session for queries.

        """
        self.session = session

    async def can_access_content(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
        content_owner_id: UUID,
        content_visibility: VisibilityScope,
    ) -> bool:
        """
        Check if a user can access a piece of content.

        Parameters
        ----------
        user_id : UUID
            User attempting to access the content.
        organization_id : UUID
            Organization the content belongs to.
        content_type : ContentType
            Type of content (note, file, etc.).
        content_id : UUID
            ID of the content.
        content_owner_id : UUID
            Owner of the content.
        content_visibility : VisibilityScope
            Visibility scope of the content.

        Returns
        -------
        bool
            True if user can access, False otherwise.

        """
        # Owner always has access
        if content_owner_id == user_id:
            return True

        # Org OWNER/ADMIN always have full access to all org content
        if await self._is_org_admin(user_id, organization_id):
            return True

        # Check if user is in the organization
        if not await self._is_user_in_organization(user_id, organization_id):
            return False

        # Organization-wide content
        if content_visibility == VisibilityScope.ORGANIZATION:
            return True

        # Group-level content
        if content_visibility == VisibilityScope.GROUP:
            return await self._can_access_group_content(
                user_id, organization_id, content_type, content_id
            )

        # Private content - only owner (already checked above)
        if content_visibility == VisibilityScope.PRIVATE:
            # Check for explicit permission grant
            return await self._has_explicit_permission(
                user_id, content_type, content_id, organization_id
            )

        # Public content (future feature)
        return content_visibility == VisibilityScope.PUBLIC

    async def can_edit_content(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
        content_owner_id: UUID,
        content_visibility: VisibilityScope,
    ) -> bool:
        """
        Check if a user can edit a piece of content.

        Parameters
        ----------
        user_id : UUID
            User attempting to edit the content.
        organization_id : UUID
            Organization the content belongs to.
        content_type : ContentType
            Type of content (note, file, etc.).
        content_id : UUID
            ID of the content.
        content_owner_id : UUID
            Owner of the content.
        content_visibility : VisibilityScope
            Visibility scope of the content.

        Returns
        -------
        bool
            True if user can edit, False otherwise.

        """
        # Owner always can edit
        if content_owner_id == user_id:
            return True

        # Org OWNER/ADMIN always have full access to all org content
        if await self._is_org_admin(user_id, organization_id):
            return True

        # Check if user can access first
        if not await self.can_access_content(
            user_id,
            organization_id,
            content_type,
            content_id,
            content_owner_id,
            content_visibility,
        ):
            return False

        # For org-wide content, check org permission defaults
        if content_visibility == VisibilityScope.ORGANIZATION:
            # Tasks use project defaults (tasks are children of projects)
            defaults_type = ContentType.PROJECT if content_type == ContentType.TASK else content_type
            if await self._org_defaults_allow(organization_id, defaults_type, "members_can_edit"):
                return True

        # Check for explicit edit permission
        return await self._has_permission_level(
            user_id,
            content_type,
            content_id,
            organization_id,
            min_level=PermissionLevel.EDIT,
        )

    async def can_delete_content(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
        content_owner_id: UUID,
        content_visibility: VisibilityScope = VisibilityScope.PRIVATE,
    ) -> bool:
        """
        Check if a user can delete a piece of content.

        Parameters
        ----------
        user_id : UUID
            User attempting to delete the content.
        organization_id : UUID
            Organization the content belongs to.
        content_type : ContentType
            Type of content (note, file, etc.).
        content_id : UUID
            ID of the content.
        content_owner_id : UUID
            Owner of the content.
        content_visibility : VisibilityScope
            Visibility scope of the content.

        Returns
        -------
        bool
            True if user can delete, False otherwise.

        """
        # Owner always can delete
        if content_owner_id == user_id:
            return True

        # Org OWNER/ADMIN always have full access to all org content
        if await self._is_org_admin(user_id, organization_id):
            return True

        # For org-wide content, check org permission defaults
        if content_visibility == VisibilityScope.ORGANIZATION:
            defaults_type = ContentType.PROJECT if content_type == ContentType.TASK else content_type
            if await self._org_defaults_allow(organization_id, defaults_type, "members_can_delete"):
                return True

        # Check for explicit delete permission
        permission = await self._get_user_permission(
            user_id, content_type, content_id, organization_id
        )

        return permission is not None and permission.can_delete

    async def can_share_content(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
        content_owner_id: UUID,
        content_visibility: VisibilityScope = VisibilityScope.PRIVATE,
    ) -> bool:
        """
        Check if a user can share a piece of content.

        Parameters
        ----------
        user_id : UUID
            User attempting to share the content.
        organization_id : UUID
            Organization the content belongs to.
        content_type : ContentType
            Type of content (note, file, etc.).
        content_id : UUID
            ID of the content.
        content_owner_id : UUID
            Owner of the content.
        content_visibility : VisibilityScope
            Visibility scope of the content.

        Returns
        -------
        bool
            True if user can share, False otherwise.

        """
        # Owner always can share
        if content_owner_id == user_id:
            return True

        # Org OWNER/ADMIN always have full access to all org content
        if await self._is_org_admin(user_id, organization_id):
            return True

        # For org-wide content, check org permission defaults
        if content_visibility == VisibilityScope.ORGANIZATION:
            defaults_type = ContentType.PROJECT if content_type == ContentType.TASK else content_type
            if await self._org_defaults_allow(organization_id, defaults_type, "members_can_share"):
                return True

        # Check for explicit share permission
        permission = await self._get_user_permission(
            user_id, content_type, content_id, organization_id
        )

        return permission is not None and permission.can_share

    async def can_move_content(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
        content_owner_id: UUID,
    ) -> bool:
        """
        Check if a user can move a piece of content.

        Parameters
        ----------
        user_id : UUID
            User attempting to move the content.
        organization_id : UUID
            Organization the content belongs to.
        content_type : ContentType
            Type of content (note, file, etc.).
        content_id : UUID
            ID of the content.
        content_owner_id : UUID
            Owner of the content.

        Returns
        -------
        bool
            True if user can move, False otherwise.

        """
        # Owner always can move
        if content_owner_id == user_id:
            return True

        # Org OWNER/ADMIN always have full access to all org content
        if await self._is_org_admin(user_id, organization_id):
            return True

        # Check for explicit move permission
        permission = await self._get_user_permission(
            user_id, content_type, content_id, organization_id
        )

        return permission is not None and permission.can_move

    async def get_user_permission_level(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
        content_owner_id: UUID,
    ) -> PermissionLevel:
        """
        Get the user's permission level for a piece of content.

        Parameters
        ----------
        user_id : UUID
            User ID.
        organization_id : UUID
            Organization the content belongs to.
        content_type : ContentType
            Type of content.
        content_id : UUID
            ID of the content.
        content_owner_id : UUID
            Owner of the content.

        Returns
        -------
        PermissionLevel
            The user's permission level (VIEW, EDIT, ADMIN, OWNER).

        """
        # Owner has OWNER level
        if content_owner_id == user_id:
            return PermissionLevel.OWNER

        # Org OWNER/ADMIN have ADMIN level on all content
        if await self._is_org_admin(user_id, organization_id):
            return PermissionLevel.ADMIN

        # Check for explicit permission
        permission = await self._get_user_permission(
            user_id, content_type, content_id, organization_id
        )

        if permission:
            return permission.permission_level

        # Default to VIEW if user has any access
        return PermissionLevel.VIEW

    async def get_content_groups(
        self,
        content_type: ContentType,
        content_id: UUID,
        organization_id: UUID,
    ) -> list[UUID]:
        """
        Get all groups that have access to a piece of content.

        Parameters
        ----------
        content_type : ContentType
            Type of content.
        content_id : UUID
            ID of the content.
        organization_id : UUID
            Organization ID.

        Returns
        -------
        list[UUID]
            List of group IDs.

        """
        # Import here to avoid circular imports
        from uniffy.core.models.permissions.content_group_link import ContentGroupLink

        result = await self.session.execute(
            select(ContentGroupLink.group_id)
            .where(ContentGroupLink.organization_id == organization_id)
            .where(ContentGroupLink.content_type == content_type)
            .where(ContentGroupLink.content_id == content_id)
        )
        return [row[0] for row in result.all()]

    async def get_user_groups(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> list[UUID]:
        """
        Get all groups a user is a member of in an organization.

        Parameters
        ----------
        user_id : UUID
            User ID.
        organization_id : UUID
            Organization ID.

        Returns
        -------
        list[UUID]
            List of group IDs.

        """
        # Import here to avoid circular imports
        from uniffy.core.models.login.group_member import GroupMember
        from uniffy.core.models.permissions.content_group_link import ContentGroupLink

        result = await self.session.execute(
            select(GroupMember.group_id)
            .where(GroupMember.user_id == user_id)
            .where(GroupMember.is_active == True)  # noqa: E712
            .join(
                ContentGroupLink,
                ContentGroupLink.group_id == GroupMember.group_id,
            )
            .where(ContentGroupLink.organization_id == organization_id)
            .distinct()
        )
        return [row[0] for row in result.all()]

    # ─────────────────────────────────────────────────────────────
    # Private helper methods
    # ─────────────────────────────────────────────────────────────

    async def _org_defaults_allow(
        self,
        organization_id: UUID,
        content_type: ContentType,
        field: str,
    ) -> bool:
        """
        Check if org permission defaults allow the given action for a content type.

        Parameters
        ----------
        organization_id : UUID
            Organization ID.
        content_type : ContentType
            Content type to check defaults for.
        field : str
            The defaults field to check (e.g. 'members_can_edit').

        Returns
        -------
        bool
            True if the org default allows the action.

        """
        from uniffy.core.models.permissions.org_permission_defaults import (
            OrganizationPermissionDefaults,
        )

        result = await self.session.execute(
            select(getattr(OrganizationPermissionDefaults, field))
            .where(OrganizationPermissionDefaults.organization_id == organization_id)
            .where(OrganizationPermissionDefaults.content_type == content_type)
        )
        value = result.scalar_one_or_none()
        return value is True

    async def _is_user_in_organization(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> bool:
        """Check if user is a member of the organization."""
        from uniffy.core.models.login.organization_member import OrganizationMember

        result = await self.session.execute(
            select(OrganizationMember)
            .where(OrganizationMember.user_id == user_id)
            .where(OrganizationMember.organization_id == organization_id)
            .where(OrganizationMember.is_active == True)  # noqa: E712
        )
        return result.scalar_one_or_none() is not None

    async def _can_access_group_content(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
    ) -> bool:
        """Check if user can access group-level content."""
        from uniffy.core.models.login.group_member import GroupMember
        from uniffy.core.models.permissions.content_group_link import ContentGroupLink

        # Get user's groups
        user_groups_result = await self.session.execute(
            select(GroupMember.group_id)
            .where(GroupMember.user_id == user_id)
            .where(GroupMember.is_active == True)  # noqa: E712
        )
        user_group_ids = [row[0] for row in user_groups_result.all()]

        if not user_group_ids:
            return False

        # Check if content is linked to any of user's groups
        result = await self.session.execute(
            select(ContentGroupLink)
            .where(ContentGroupLink.organization_id == organization_id)
            .where(ContentGroupLink.content_type == content_type)
            .where(ContentGroupLink.content_id == content_id)
            .where(ContentGroupLink.group_id.in_(user_group_ids))
        )

        return result.scalar_one_or_none() is not None

    async def _has_explicit_permission(
        self,
        user_id: UUID,
        content_type: ContentType,
        content_id: UUID,
        organization_id: UUID,
    ) -> bool:
        """Check if user has an explicit permission grant (not expired), including group grants."""
        from sqlalchemy import or_

        from uniffy.core.models.login.group_member import GroupMember
        from uniffy.core.models.permissions.content_permission import ContentPermission

        now = datetime.now(UTC)

        # Check direct user grant
        result = await self.session.execute(
            select(ContentPermission)
            .where(ContentPermission.organization_id == organization_id)
            .where(ContentPermission.content_type == content_type)
            .where(ContentPermission.content_id == content_id)
            .where(ContentPermission.subject_type == SubjectType.USER)
            .where(ContentPermission.subject_id == user_id)
            .where(ContentPermission.can_view == True)  # noqa: E712
            .where(
                or_(
                    ContentPermission.expires_at.is_(None),
                    ContentPermission.expires_at > now,
                )
            )
        )

        if result.scalar_one_or_none() is not None:
            return True

        # Check group grant (user is member of a group that has permission)
        user_groups_subquery = (
            select(GroupMember.group_id)
            .where(GroupMember.user_id == user_id)
            .where(GroupMember.is_active == True)  # noqa: E712
        )
        group_result = await self.session.execute(
            select(ContentPermission)
            .where(ContentPermission.organization_id == organization_id)
            .where(ContentPermission.content_type == content_type)
            .where(ContentPermission.content_id == content_id)
            .where(ContentPermission.subject_type == SubjectType.GROUP)
            .where(ContentPermission.subject_id.in_(user_groups_subquery))
            .where(ContentPermission.can_view == True)  # noqa: E712
            .where(
                or_(
                    ContentPermission.expires_at.is_(None),
                    ContentPermission.expires_at > now,
                )
            )
        )

        return group_result.scalar_one_or_none() is not None

    async def _has_permission_level(
        self,
        user_id: UUID,
        content_type: ContentType,
        content_id: UUID,
        organization_id: UUID,
        min_level: PermissionLevel,
    ) -> bool:
        """Check if user has at least the specified permission level."""
        permission = await self._get_user_permission(
            user_id, content_type, content_id, organization_id
        )

        if not permission:
            return False

        # Define permission hierarchy
        level_hierarchy = {
            PermissionLevel.VIEW: 1,
            PermissionLevel.EDIT: 2,
            PermissionLevel.ADMIN: 3,
            PermissionLevel.OWNER: 4,
        }

        user_level = level_hierarchy.get(permission.permission_level, 0)
        required_level = level_hierarchy.get(min_level, 0)

        return user_level >= required_level

    async def _get_user_permission(
        self,
        user_id: UUID,
        content_type: ContentType,
        content_id: UUID,
        organization_id: UUID,
    ):
        """Get the explicit permission for a user on content (not expired).

        Also checks group-level permission grants.
        """
        from sqlalchemy import or_

        from uniffy.core.models.login.group_member import GroupMember
        from uniffy.core.models.permissions.content_permission import ContentPermission

        now = datetime.now(UTC)

        # Check direct user grant first
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
        user_permission = result.scalar_one_or_none()
        if user_permission:
            return user_permission

        # Check group grant (user is member of a group that has permission)
        user_groups_subquery = (
            select(GroupMember.group_id)
            .where(GroupMember.user_id == user_id)
            .where(GroupMember.is_active == True)  # noqa: E712
        )
        group_result = await self.session.execute(
            select(ContentPermission)
            .where(ContentPermission.organization_id == organization_id)
            .where(ContentPermission.content_type == content_type)
            .where(ContentPermission.content_id == content_id)
            .where(ContentPermission.subject_type == SubjectType.GROUP)
            .where(ContentPermission.subject_id.in_(user_groups_subquery))
            .where(
                or_(
                    ContentPermission.expires_at.is_(None),
                    ContentPermission.expires_at > now,
                )
            )
            .order_by(ContentPermission.permission_level.desc())
            .limit(1)
        )

        return group_result.scalar_one_or_none()

    async def _get_user_org_role(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> OrganizationRole | None:
        """Get the user's role in the organization."""
        result = await self.session.execute(
            select(OrganizationMember.role)
            .where(OrganizationMember.user_id == user_id)
            .where(OrganizationMember.organization_id == organization_id)
            .where(OrganizationMember.is_active == True)  # noqa: E712
        )
        row = result.scalar_one_or_none()
        return row if row else None

    async def _is_org_admin(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> bool:
        """Check if user is an organization OWNER or ADMIN."""
        role = await self._get_user_org_role(user_id, organization_id)
        return role in (OrganizationRole.OWNER, OrganizationRole.ADMIN)
