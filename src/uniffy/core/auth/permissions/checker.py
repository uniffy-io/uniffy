"""
Core permission checking logic for all content types.

Single source of truth for access decisions. Every domain operation
ultimately calls :meth:`PermissionChecker.effective_role` (directly or
through :class:`BaseContentOperations`) to resolve a user's role on a
content item, then uses the ``role_can_*`` predicates in
:mod:`uniffy.core.auth.permissions.roles` to check capabilities.

The checker caches per-request state (org role, domain admin status) so
repeated checks within a single handler do not re-query the database.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions.roles import ROLE_ORDINAL
from uniffy.core.types import (
    AccessMode,
    ContentRole,
    ContentType,
    DomainType,
    SubjectType,
)

if TYPE_CHECKING:
    from uniffy.core.models.login.organization_member import OrganizationRole

# Mapping from content type to the DomainType used by the domain-admin
# bypass. Content types that have no matching domain admin (e.g. USER,
# ROOM, CHAT_MESSAGE) are not in this map.
_CONTENT_TYPE_TO_DOMAIN: dict[ContentType, DomainType] = {
    ContentType.NOTE: DomainType.NOTES,
    ContentType.FILE: DomainType.FILES,
    ContentType.FOLDER: DomainType.FILES,
    ContentType.CALENDAR_EVENT: DomainType.CALENDAR,
    ContentType.CHAT_MESSAGE: DomainType.CHAT,
    ContentType.CHAT: DomainType.CHAT,
    ContentType.PROJECT: DomainType.PROJECTS,
    ContentType.TASK: DomainType.PROJECTS,
    ContentType.AGENT: DomainType.AGENTS,
    ContentType.PROVIDER_KEY: DomainType.AGENTS,
    ContentType.PROMPT: DomainType.AGENTS,
    ContentType.AGENT_CRON_TASK: DomainType.AGENTS,
}


class PermissionChecker:
    """
    Compute effective roles for users on content items.

    Usage
    -----
    Each handler constructs one checker per request, reuses it for every
    access decision in that request, and discards it at the end. The
    internal caches mean repeated checks on the same user/org/content are
    effectively free.

    Parameters
    ----------
    session : AsyncSession
        Database session (request-scoped).

    """

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self._org_role_cache: dict[tuple[UUID, UUID], OrganizationRole | None] = {}
        self._domain_admin_cache: dict[tuple[UUID, UUID, DomainType], bool] = {}

    async def effective_role(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
        *,
        owner_id: UUID,
        access_mode: AccessMode,
        baseline_role: ContentRole | None,
    ) -> ContentRole | None:
        """Compute the user's effective role on a content item.

        Returns ``None`` when the user has no access. Callers map the
        returned role to capabilities via the ``role_can_*`` helpers.

        Parameters
        ----------
        user_id : UUID
            User whose access we are computing.
        organization_id : UUID
            Organization scope. The user must be a member of this org
            for OPEN_TO_ORG baseline access to apply.
        content_type : ContentType
            Type of content. Must be one that has ``access_mode`` and
            ``baseline_role`` columns; delegating types (TASK, COMMENT,
            ATTACHMENT, etc.) resolve to their parent before calling.
        content_id : UUID
            ID of the content item.
        owner_id : UUID
            Owner column from the content row.
        access_mode : AccessMode
            Access mode column from the content row.
        baseline_role : ContentRole | None
            Baseline role column from the content row. Must be non-null
            iff ``access_mode == OPEN_TO_ORG``.

        Returns
        -------
        ContentRole | None
            The effective role, or None if the user has no access.

        """
        # 1. Org admin / owner bypass: always full control over everything
        #    in their organization.
        if await self._is_org_admin(user_id, organization_id):
            return ContentRole.OWNER

        # 2. Domain admin bypass: full control over their domain's
        #    content types.
        if await self._is_domain_admin_for_content(user_id, organization_id, content_type):
            return ContentRole.ADMIN

        # 3. Owner of the content.
        if owner_id == user_id:
            return ContentRole.OWNER

        # 4. Explicit member grant (direct user or via group).
        member_role = await self._get_member_role(
            organization_id, content_type, content_id, user_id
        )

        # 4a. BLOCKED is an explicit deny regardless of baseline access.
        if member_role == ContentRole.BLOCKED:
            return None

        # 4b. Non-blocked explicit grants always beat the baseline.
        if member_role is not None:
            return member_role

        # 5. Baseline from the content's access mode.
        if access_mode == AccessMode.OWNER_ONLY:
            return None

        if access_mode == AccessMode.EXPLICIT_MEMBERS:
            return None

        if access_mode == AccessMode.OPEN_TO_ORG:
            if baseline_role is None:
                return None
            if not await self._is_user_in_organization(user_id, organization_id):
                return None
            return baseline_role

        return None

    async def is_org_admin(self, user_id: UUID, organization_id: UUID) -> bool:
        """Public accessor used by callers that need to bypass role checks."""
        return await self._is_org_admin(user_id, organization_id)

    async def is_domain_admin(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
    ) -> bool:
        """Public accessor for the domain-admin bypass."""
        return await self._is_domain_admin_for_content(
            user_id, organization_id, content_type
        )

    async def get_user_org_role(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> OrganizationRole | None:
        """Public accessor for the user's org role (used by audit logging)."""
        return await self._get_user_org_role(user_id, organization_id)

    # Internal helpers

    async def _get_member_role(
        self,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
        user_id: UUID,
    ) -> ContentRole | None:
        """Highest applicable role from direct + group-derived membership.

        BLOCKED from any source wins over every other role. When multiple
        non-BLOCKED roles apply (e.g. direct EDITOR plus group VIEWER),
        the highest ordinal wins.
        """
        from uniffy.core.models.login.group_member import GroupMember
        from uniffy.core.models.permissions.content_member import ContentMember

        now = datetime.now(UTC)

        # Direct user grant -- at most one row due to unique constraint.
        direct_result = await self.session.execute(
            select(ContentMember.role)
            .where(
                ContentMember.organization_id == organization_id,
                ContentMember.content_type == content_type,
                ContentMember.content_id == content_id,
                ContentMember.subject_type == SubjectType.USER,
                ContentMember.subject_id == user_id,
                or_(
                    ContentMember.expires_at.is_(None),
                    ContentMember.expires_at > now,
                ),
            )
        )
        direct_role = direct_result.scalar_one_or_none()
        if direct_role == ContentRole.BLOCKED:
            return ContentRole.BLOCKED

        user_groups_subq = (
            select(GroupMember.group_id)
            .where(
                GroupMember.user_id == user_id,
                GroupMember.is_active == True,  # noqa: E712
            )
        )

        group_result = await self.session.execute(
            select(ContentMember.role)
            .where(
                ContentMember.organization_id == organization_id,
                ContentMember.content_type == content_type,
                ContentMember.content_id == content_id,
                ContentMember.subject_type == SubjectType.GROUP,
                ContentMember.subject_id.in_(user_groups_subq),
                or_(
                    ContentMember.expires_at.is_(None),
                    ContentMember.expires_at > now,
                ),
            )
        )
        group_roles = [row[0] for row in group_result.all()]
        if ContentRole.BLOCKED in group_roles:
            return ContentRole.BLOCKED

        candidates: list[ContentRole] = []
        if direct_role is not None:
            candidates.append(direct_role)
        candidates.extend(group_roles)

        if not candidates:
            return None

        return max(candidates, key=lambda r: ROLE_ORDINAL[r])

    async def _get_user_org_role(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> OrganizationRole | None:
        """Get the user's role in the organization. Cached per-request."""
        from uniffy.core.models.login.organization_member import OrganizationMember

        key = (user_id, organization_id)
        if key in self._org_role_cache:
            return self._org_role_cache[key]

        result = await self.session.execute(
            select(OrganizationMember.role)
            .where(
                OrganizationMember.user_id == user_id,
                OrganizationMember.organization_id == organization_id,
                OrganizationMember.is_active == True,  # noqa: E712
            )
        )
        role = result.scalar_one_or_none()
        self._org_role_cache[key] = role
        return role

    async def _is_org_admin(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> bool:
        """Return True if the user is an org OWNER or ADMIN."""
        from uniffy.core.models.login.organization_member import OrganizationRole

        role = await self._get_user_org_role(user_id, organization_id)
        return role in (OrganizationRole.OWNER, OrganizationRole.ADMIN)

    async def _is_user_in_organization(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> bool:
        """Return True if the user has an active membership in the org."""
        return await self._get_user_org_role(user_id, organization_id) is not None

    async def _is_domain_admin_for_content(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
    ) -> bool:
        """Return True if the user is a domain admin for the content's domain."""
        domain = _CONTENT_TYPE_TO_DOMAIN.get(content_type)
        if domain is None:
            return False

        key = (user_id, organization_id, domain)
        if key in self._domain_admin_cache:
            return self._domain_admin_cache[key]

        from uniffy.core.auth.domain_admin import is_domain_admin

        result = await is_domain_admin(self.session, user_id, organization_id, domain)
        self._domain_admin_cache[key] = result
        return result
