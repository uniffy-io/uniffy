"""
Query builders for content access filtering.

Provides helpers to construct SQLAlchemy WHERE clauses that return only
the rows a given user has access to under the new access model:

    - content rows the user owns
    - content rows where the user has a non-BLOCKED ContentMember row
      (direct or via a group they are a member of)
    - content rows whose ``access_mode`` is ``OPEN_TO_ORG`` with a
      non-null ``baseline_role``, minus any content the user is BLOCKED
      on

The filter does NOT apply the org-admin / domain-admin bypass. Those
callers should detect the bypass at a higher level (e.g.
``BaseContentOperations.list_accessible``) and skip the filter entirely.
"""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute
from sqlalchemy.sql import Select

from uniffy.core.types import AccessMode, ContentRole, ContentType, SubjectType


class ContentAccessQuery:
    """
    Build WHERE clauses for content the user has access to.

    Parameters
    ----------
    session : AsyncSession
        Database session for sub-query construction and materialized
        lookups.

    """

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    def build_accessible_filter(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id_column: InstrumentedAttribute,
        owner_id_column: InstrumentedAttribute,
        access_mode_column: InstrumentedAttribute,
        baseline_role_column: InstrumentedAttribute,
    ) -> Any:
        """Return a WHERE clause selecting content accessible to the user.

        Caller must still scope the query to ``organization_id`` on the
        content table; this filter only handles the access part.
        """
        from uniffy.core.models.login.group_member import GroupMember
        from uniffy.core.models.permissions.content_member import ContentMember

        now = datetime.now(UTC)

        user_groups_subq = select(GroupMember.group_id).where(
            GroupMember.user_id == user_id,
            GroupMember.is_active == True,  # noqa: E712
        )

        # Content IDs the user is BLOCKED on (direct or via group).
        # These must be excluded regardless of any other grant.
        blocked_subq = select(ContentMember.content_id).where(
            ContentMember.organization_id == organization_id,
            ContentMember.content_type == content_type,
            ContentMember.role == ContentRole.BLOCKED,
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

        # Content IDs the user has a non-BLOCKED explicit grant on.
        explicit_member_subq = select(ContentMember.content_id).where(
            ContentMember.organization_id == organization_id,
            ContentMember.content_type == content_type,
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

        ownership = owner_id_column == user_id

        open_to_org = and_(
            access_mode_column == AccessMode.OPEN_TO_ORG,
            baseline_role_column.is_not(None),
        )

        has_any_access = or_(
            ownership,
            content_id_column.in_(explicit_member_subq),
            open_to_org,
        )

        return and_(
            content_id_column.notin_(blocked_subq),
            has_any_access,
        )

    def build_shared_with_me_filter(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id_column: InstrumentedAttribute,
        owner_id_column: InstrumentedAttribute,
        access_mode_column: InstrumentedAttribute,
        baseline_role_column: InstrumentedAttribute,
    ) -> Any:
        """WHERE clause for content that is shared WITH the user (not owned).

        Same logic as ``build_accessible_filter`` but the user must not
        be the owner. Useful for "Shared with me" views.
        """
        base = self.build_accessible_filter(
            user_id=user_id,
            organization_id=organization_id,
            content_type=content_type,
            content_id_column=content_id_column,
            owner_id_column=owner_id_column,
            access_mode_column=access_mode_column,
            baseline_role_column=baseline_role_column,
        )
        return and_(base, owner_id_column != user_id)

    async def get_accessible_content_ids(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id_column: InstrumentedAttribute,
        owner_id_column: InstrumentedAttribute,
        access_mode_column: InstrumentedAttribute,
        baseline_role_column: InstrumentedAttribute,
    ) -> list[UUID]:
        """Materialize the set of content IDs the user can access."""
        filter_expr = self.build_accessible_filter(
            user_id=user_id,
            organization_id=organization_id,
            content_type=content_type,
            content_id_column=content_id_column,
            owner_id_column=owner_id_column,
            access_mode_column=access_mode_column,
            baseline_role_column=baseline_role_column,
        )
        result = await self.session.execute(select(content_id_column).where(filter_expr))
        return [row[0] for row in result.all()]

    def apply_visibility_filter(
        self,
        query: Select,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id_column: InstrumentedAttribute,
        owner_id_column: InstrumentedAttribute,
        access_mode_column: InstrumentedAttribute,
        baseline_role_column: InstrumentedAttribute,
    ) -> Select:
        """Apply :meth:`build_accessible_filter` to an existing query."""
        filter_expr = self.build_accessible_filter(
            user_id=user_id,
            organization_id=organization_id,
            content_type=content_type,
            content_id_column=content_id_column,
            owner_id_column=owner_id_column,
            access_mode_column=access_mode_column,
            baseline_role_column=baseline_role_column,
        )
        return query.where(filter_expr)
