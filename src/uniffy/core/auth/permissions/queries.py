"""
Query builders for content access filtering.

Provides helpers to construct SQLAlchemy queries that
automatically filter content based on visibility and group membership.
"""

from typing import Any
from uuid import UUID

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute
from sqlalchemy.sql import Select

from uniffy.core.types import ContentType, SubjectType, VisibilityScope


class ContentAccessQuery:
    """
    Build queries for filtering content based on user access.

    Provides helper methods to construct SQLAlchemy queries that
    automatically filter content based on visibility and group membership.

    Parameters
    ----------
    session : AsyncSession
        Database session for queries.

    """

    def __init__(self, session: AsyncSession) -> None:
        """
        Initialize the query builder.

        Parameters
        ----------
        session : AsyncSession
            Database session for queries.

        """
        self.session = session

    def build_accessible_filter(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id_column: InstrumentedAttribute,
        owner_id_column: InstrumentedAttribute,
        visibility_column: InstrumentedAttribute,
    ) -> Any:
        """
        Build a WHERE clause filter for accessible content.

        Returns a SQLAlchemy filter expression that can be used in queries
        to filter content based on user access rights.

        Parameters
        ----------
        user_id : UUID
            User ID requesting access.
        organization_id : UUID
            Organization ID.
        content_type : ContentType
            Type of content being queried.
        content_id_column : InstrumentedAttribute
            SQLAlchemy column reference for content ID.
        owner_id_column : InstrumentedAttribute
            SQLAlchemy column reference for owner ID.
        visibility_column : InstrumentedAttribute
            SQLAlchemy column reference for visibility.

        Returns
        -------
        Any
            SQLAlchemy filter expression.

        Examples
        --------
        >>> query = ContentAccessQuery(session)
        >>> filter_expr = query.build_accessible_filter(
        ...     user_id=user_id,
        ...     organization_id=org_id,
        ...     content_type=ContentType.NOTE,
        ...     content_id_column=Note.id,
        ...     owner_id_column=Note.owner_id,
        ...     visibility_column=Note.visibility
        ... )
        >>> notes = await session.execute(
        ...     select(Note).where(filter_expr)
        ... )

        """
        # Import here to avoid circular imports
        from datetime import UTC, datetime

        from uniffy.core.models.login.group_member import GroupMember
        from uniffy.core.models.permissions.content_group_link import ContentGroupLink
        from uniffy.core.models.permissions.content_permission import ContentPermission

        # User's own private content
        private_condition = and_(
            owner_id_column == user_id,
            visibility_column == VisibilityScope.PRIVATE,
        )

        # Organization-wide content
        org_condition = visibility_column == VisibilityScope.ORGANIZATION

        # Group content (subquery for user's groups)
        group_subquery = (
            select(ContentGroupLink.content_id)
            .where(ContentGroupLink.organization_id == organization_id)
            .where(ContentGroupLink.content_type == content_type)
            .where(
                ContentGroupLink.group_id.in_(
                    select(GroupMember.group_id)
                    .where(GroupMember.user_id == user_id)
                    .where(GroupMember.is_active == True)  # noqa: E712
                )
            )
        )

        group_condition = and_(
            visibility_column == VisibilityScope.GROUP,
            content_id_column.in_(group_subquery),
        )

        # Explicit permission grants (shared with specific user)
        now = datetime.now(UTC)
        user_permission_subquery = (
            select(ContentPermission.content_id)
            .where(ContentPermission.organization_id == organization_id)
            .where(ContentPermission.content_type == content_type)
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

        # Group permission grants (shared with a group the user belongs to)
        user_groups_subquery = (
            select(GroupMember.group_id)
            .where(GroupMember.user_id == user_id)
            .where(GroupMember.is_active == True)  # noqa: E712
        )
        group_permission_subquery = (
            select(ContentPermission.content_id)
            .where(ContentPermission.organization_id == organization_id)
            .where(ContentPermission.content_type == content_type)
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

        explicit_permission_condition = or_(
            content_id_column.in_(user_permission_subquery),
            content_id_column.in_(group_permission_subquery),
        )

        # Combine all conditions with OR
        return or_(
            private_condition,
            org_condition,
            group_condition,
            explicit_permission_condition,
        )

    async def get_accessible_content_ids(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id_column: InstrumentedAttribute,
        owner_id_column: InstrumentedAttribute,
        visibility_column: InstrumentedAttribute,
    ) -> list[UUID]:
        """
        Get list of content IDs accessible to a user.

        Parameters
        ----------
        user_id : UUID
            User ID requesting access.
        organization_id : UUID
            Organization ID.
        content_type : ContentType
            Type of content being queried.
        content_id_column : InstrumentedAttribute
            SQLAlchemy column reference for content ID.
        owner_id_column : InstrumentedAttribute
            SQLAlchemy column reference for owner ID.
        visibility_column : InstrumentedAttribute
            SQLAlchemy column reference for visibility.

        Returns
        -------
        list[UUID]
            List of accessible content IDs.

        """
        filter_expr = self.build_accessible_filter(
            user_id=user_id,
            organization_id=organization_id,
            content_type=content_type,
            content_id_column=content_id_column,
            owner_id_column=owner_id_column,
            visibility_column=visibility_column,
        )

        result = await self.session.execute(select(content_id_column).where(filter_expr))

        return [row[0] for row in result.all()]

    def build_personal_filter(
        self,
        user_id: UUID,
        owner_id_column: InstrumentedAttribute,
        visibility_column: InstrumentedAttribute,
    ) -> Any:
        """
        Build filter for user's personal (private) content.

        Parameters
        ----------
        user_id : UUID
            User ID.
        owner_id_column : InstrumentedAttribute
            SQLAlchemy column reference for owner ID.
        visibility_column : InstrumentedAttribute
            SQLAlchemy column reference for visibility.

        Returns
        -------
        Any
            SQLAlchemy filter expression.

        """
        return and_(
            owner_id_column == user_id,
            visibility_column == VisibilityScope.PRIVATE,
        )

    def build_group_filter(
        self,
        group_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id_column: InstrumentedAttribute,
        visibility_column: InstrumentedAttribute,
    ) -> Any:
        """
        Build filter for content in a specific group.

        Parameters
        ----------
        group_id : UUID
            Group ID.
        organization_id : UUID
            Organization ID.
        content_type : ContentType
            Type of content.
        content_id_column : InstrumentedAttribute
            SQLAlchemy column reference for content ID.
        visibility_column : InstrumentedAttribute
            SQLAlchemy column reference for visibility.

        Returns
        -------
        Any
            SQLAlchemy filter expression.

        """
        from uniffy.core.models.permissions.content_group_link import ContentGroupLink

        content_ids_subquery = (
            select(ContentGroupLink.content_id)
            .where(ContentGroupLink.organization_id == organization_id)
            .where(ContentGroupLink.content_type == content_type)
            .where(ContentGroupLink.group_id == group_id)
        )

        return and_(
            visibility_column == VisibilityScope.GROUP,
            content_id_column.in_(content_ids_subquery),
        )

    def build_organization_filter(
        self,
        visibility_column: InstrumentedAttribute,
    ) -> Any:
        """
        Build filter for organization-wide content.

        Parameters
        ----------
        visibility_column : InstrumentedAttribute
            SQLAlchemy column reference for visibility.

        Returns
        -------
        Any
            SQLAlchemy filter expression.

        """
        return visibility_column == VisibilityScope.ORGANIZATION

    def build_shared_with_me_filter(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id_column: InstrumentedAttribute,
        owner_id_column: InstrumentedAttribute,
        visibility_column: InstrumentedAttribute,
    ) -> Any:
        """
        Build filter for content shared WITH the user (not owned by user).

        Returns content where:
        - User is NOT the owner, AND
        - Content is accessible via GROUP membership, OR
        - Content is accessible via explicit permission, OR
        - Content is ORGANIZATION-wide

        Parameters
        ----------
        user_id : UUID
            User ID requesting access.
        organization_id : UUID
            Organization ID.
        content_type : ContentType
            Type of content being queried.
        content_id_column : InstrumentedAttribute
            SQLAlchemy column reference for content ID.
        owner_id_column : InstrumentedAttribute
            SQLAlchemy column reference for owner ID.
        visibility_column : InstrumentedAttribute
            SQLAlchemy column reference for visibility.

        Returns
        -------
        Any
            SQLAlchemy filter expression.

        """
        from datetime import UTC, datetime

        from uniffy.core.models.login.group_member import GroupMember
        from uniffy.core.models.permissions.content_group_link import ContentGroupLink
        from uniffy.core.models.permissions.content_permission import ContentPermission

        # Must NOT be owner
        not_owner = owner_id_column != user_id

        # Organization-wide content (not owned by user)
        org_condition = and_(
            not_owner,
            visibility_column == VisibilityScope.ORGANIZATION,
        )

        # Group content where user is member (not owned by user)
        group_subquery = (
            select(ContentGroupLink.content_id)
            .where(ContentGroupLink.organization_id == organization_id)
            .where(ContentGroupLink.content_type == content_type)
            .where(
                ContentGroupLink.group_id.in_(
                    select(GroupMember.group_id)
                    .where(GroupMember.user_id == user_id)
                    .where(GroupMember.is_active == True)  # noqa: E712
                )
            )
        )

        group_condition = and_(
            not_owner,
            visibility_column == VisibilityScope.GROUP,
            content_id_column.in_(group_subquery),
        )

        # Explicit user permission grants (not owned by user)
        now = datetime.now(UTC)
        user_permission_subquery = (
            select(ContentPermission.content_id)
            .where(ContentPermission.organization_id == organization_id)
            .where(ContentPermission.content_type == content_type)
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

        # Group permission grants (shared with a group the user belongs to)
        user_groups_subquery = (
            select(GroupMember.group_id)
            .where(GroupMember.user_id == user_id)
            .where(GroupMember.is_active == True)  # noqa: E712
        )
        group_permission_subquery = (
            select(ContentPermission.content_id)
            .where(ContentPermission.organization_id == organization_id)
            .where(ContentPermission.content_type == content_type)
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

        explicit_condition = and_(
            not_owner,
            or_(
                content_id_column.in_(user_permission_subquery),
                content_id_column.in_(group_permission_subquery),
            ),
        )

        # Combine: content shared with user via any mechanism
        return or_(org_condition, group_condition, explicit_condition)

    async def get_user_group_ids(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> list[UUID]:
        """
        Get all group IDs a user belongs to in an organization.

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
        from uniffy.core.models.login.group_member import GroupMember

        # Note: This is a simplified query. In production, you'd want to
        # join with groups table to filter by organization
        result = await self.session.execute(
            select(GroupMember.group_id)
            .where(GroupMember.user_id == user_id)
            .where(GroupMember.is_active == True)  # noqa: E712
        )

        return [row[0] for row in result.all()]

    def apply_visibility_filter(
        self,
        query: Select,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id_column: InstrumentedAttribute,
        owner_id_column: InstrumentedAttribute,
        visibility_column: InstrumentedAttribute,
    ) -> Select:
        """
        Apply accessibility filter to an existing query.

        Parameters
        ----------
        query : Select
            Existing SQLAlchemy SELECT query.
        user_id : UUID
            User ID requesting access.
        organization_id : UUID
            Organization ID.
        content_type : ContentType
            Type of content being queried.
        content_id_column : InstrumentedAttribute
            SQLAlchemy column reference for content ID.
        owner_id_column : InstrumentedAttribute
            SQLAlchemy column reference for owner ID.
        visibility_column : InstrumentedAttribute
            SQLAlchemy column reference for visibility.

        Returns
        -------
        Select
            Modified query with accessibility filter applied.

        Examples
        --------
        >>> query = select(Note).where(Note.organization_id == org_id)
        >>> query = ContentAccessQuery(session).apply_visibility_filter(
        ...     query=query,
        ...     user_id=user_id,
        ...     organization_id=org_id,
        ...     content_type=ContentType.NOTE,
        ...     content_id_column=Note.id,
        ...     owner_id_column=Note.owner_id,
        ...     visibility_column=Note.visibility
        ... )
        >>> result = await session.execute(query)

        """
        filter_expr = self.build_accessible_filter(
            user_id=user_id,
            organization_id=organization_id,
            content_type=content_type,
            content_id_column=content_id_column,
            owner_id_column=owner_id_column,
            visibility_column=visibility_column,
        )

        return query.where(filter_expr)
