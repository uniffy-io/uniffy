"""SQLAlchemy WHERE-clause builders for content access filtering.

Returns rows the user owns, has a non-BLOCKED ContentMember row on
(direct or via group), or that are OPEN_TO_ORG with a baseline; minus
any content the user is BLOCKED on. Does NOT apply org-admin or
domain-admin bypass - callers skip the filter for those.
"""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute
from sqlalchemy.sql import Select

from uniffy.core.models.permissions.org_permission_defaults import (
    OrganizationPermissionDefaults,
)
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

        The row's stored ``access_mode`` / ``baseline_role`` may be NULL,
        signalling that the row inherits from
        ``permissions_org_defaults``. This filter resolves the effective
        ``(mode, baseline)`` via a correlated scalar subquery against the
        defaults table, scoped on the exact same
        ``(organization_id, content_type)`` pair the caller passed in.

        Caller must still scope the outer query to ``organization_id`` on
        the content table; this filter only handles the access part.
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

        # Org-default scalar subqueries scoped to (organization_id,
        # content_type). Both sides of the pair must be on the join
        # predicate so a defaults row for a different content type in
        # the same org cannot leak in.
        default_mode_scalar = (
            select(OrganizationPermissionDefaults.default_access_mode)
            .where(
                OrganizationPermissionDefaults.organization_id == organization_id,
                OrganizationPermissionDefaults.content_type == content_type,
            )
            .scalar_subquery()
        )
        default_baseline_scalar = (
            select(OrganizationPermissionDefaults.default_baseline_role)
            .where(
                OrganizationPermissionDefaults.organization_id == organization_id,
                OrganizationPermissionDefaults.content_type == content_type,
            )
            .scalar_subquery()
        )

        # Effective mode: row override wins; NULL falls back to the org
        # default; absent default falls back to OWNER_ONLY (least-privilege).
        effective_mode = func.coalesce(
            access_mode_column,
            default_mode_scalar,
            AccessMode.OWNER_ONLY,
        )

        # Effective baseline: only meaningful on OPEN_TO_ORG rows. If the
        # row carries an explicit OPEN_TO_ORG with NULL baseline, fall back
        # to the org default baseline. Otherwise the row's baseline wins.
        effective_baseline = case(
            (access_mode_column.is_(None), default_baseline_scalar),
            (
                and_(
                    access_mode_column == AccessMode.OPEN_TO_ORG,
                    baseline_role_column.is_(None),
                ),
                default_baseline_scalar,
            ),
            else_=baseline_role_column,
        )

        ownership = owner_id_column == user_id

        open_to_org = and_(
            effective_mode == AccessMode.OPEN_TO_ORG,
            effective_baseline.is_not(None),
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
