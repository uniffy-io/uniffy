"""SQLAlchemy WHERE-clause builders for content access filtering."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import and_, case, false, func, or_, select, true
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute
from sqlalchemy.sql import Select

from uniffy.core.auth.membership import get_active_membership
from uniffy.core.auth.permissions.support import get_active_support_access
from uniffy.core.models.permissions.org_permission_defaults import (
    OrganizationPermissionDefaults,
)
from uniffy.core.types import AccessMode, ContentRole, ContentType, SubjectType


class ContentAccessQuery:
    """Build WHERE clauses for content the user has access to."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self._active_member_cache: dict[tuple[UUID, UUID], bool] = {}
        self._support_access_cache: dict[tuple[UUID, UUID], bool] = {}

    async def is_active_member(self, user_id: UUID, organization_id: UUID) -> bool:
        key = (user_id, organization_id)
        cached = self._active_member_cache.get(key)
        if cached is not None:
            return cached

        active = (
            await get_active_membership(
                self.session,
                user_id,
                organization_id,
            )
            is not None
        )
        self._active_member_cache[key] = active
        return active

    async def has_support_access(self, user_id: UUID, organization_id: UUID) -> bool:
        key = (user_id, organization_id)
        cached = self._support_access_cache.get(key)
        if cached is not None:
            return cached
        active = await get_active_support_access(self.session, user_id, organization_id) is not None
        self._support_access_cache[key] = active
        return active

    async def has_standard_access(self, user_id: UUID, organization_id: UUID) -> bool:
        return await self.is_active_member(
            user_id, organization_id
        ) or await self.has_support_access(user_id, organization_id)

    async def build_accessible_filter(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id_column: InstrumentedAttribute,
        owner_id_column: InstrumentedAttribute,
        access_mode_column: InstrumentedAttribute,
        baseline_role_column: InstrumentedAttribute,
    ) -> Any:
        """WHERE clause selecting content accessible to the user.

        NULL ``access_mode`` / ``baseline_role`` on a row signals inheritance
        from ``permissions_org_defaults``; this filter resolves the effective
        ``(mode, baseline)`` via a correlated scalar subquery scoped to the
        same ``(organization_id, content_type)`` pair.

        The caller is still responsible for scoping the outer query to
        ``organization_id`` on the content table.
        """
        from uniffy.core.models.login.group import Group
        from uniffy.core.models.login.group_member import GroupMember
        from uniffy.core.models.permissions.content_member import ContentMember

        # Membership is resolved once per (user, org) per query object rather
        # than as a correlated EXISTS, which would ride along on every row of
        # every list query.
        if not await self.is_active_member(user_id, organization_id):
            return true() if await self.has_support_access(user_id, organization_id) else false()

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

        # Both halves of (organization_id, content_type) must be on the
        # predicate so a defaults row for a different content type cannot leak in.
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

        # Row override wins; NULL falls back to the org default; absent default
        # falls back to OWNER_ONLY (least-privilege).
        effective_mode = func.coalesce(
            access_mode_column,
            default_mode_scalar,
            AccessMode.OWNER_ONLY,
        )

        # Only meaningful on OPEN_TO_ORG rows: row's baseline wins unless it is
        # NULL, in which case the org default fills it in.
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
            self.build_not_blocked_filter(
                user_id=user_id,
                organization_id=organization_id,
                content_type=content_type,
                content_id_column=content_id_column,
            ),
            has_any_access,
        )

    def build_not_blocked_filter(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id_column: InstrumentedAttribute,
    ) -> Any:
        """WHERE clause excluding content the user is BLOCKED on (direct or via group).

        BLOCKED beats every grant, so any caller that ORs an extra allow branch
        onto ``build_accessible_filter`` (e.g. domain-membership bypasses) must
        AND this onto that branch.
        """
        from uniffy.core.models.login.group import Group
        from uniffy.core.models.login.group_member import GroupMember
        from uniffy.core.models.permissions.content_member import ContentMember

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

        return content_id_column.notin_(blocked_subq)

    async def build_shared_with_me_filter(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id_column: InstrumentedAttribute,
        owner_id_column: InstrumentedAttribute,
        access_mode_column: InstrumentedAttribute,
        baseline_role_column: InstrumentedAttribute,
    ) -> Any:
        """``build_accessible_filter`` minus owned rows (for "Shared with me")."""
        base = await self.build_accessible_filter(
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
        filter_expr = await self.build_accessible_filter(
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

    async def apply_visibility_filter(
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
        filter_expr = await self.build_accessible_filter(
            user_id=user_id,
            organization_id=organization_id,
            content_type=content_type,
            content_id_column=content_id_column,
            owner_id_column=owner_id_column,
            access_mode_column=access_mode_column,
            baseline_role_column=baseline_role_column,
        )
        return query.where(filter_expr)
