"""Single source of truth for content access decisions."""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.membership import get_active_membership
from uniffy.core.auth.permissions.defaults import (
    resolve_effective_content_role,
)
from uniffy.core.auth.permissions.scalar import (
    ScalarAuthorizationFacts,
    load_scalar_authorization_facts,
)
from uniffy.core.models.platform.support_session import SupportSessionScope
from uniffy.core.types import (
    AccessMode,
    ContentRole,
    ContentType,
    DomainType,
)
from uniffy.domains.platform.support_session.context import (
    ActiveSupportSession,
    active_support_session_var,
)

if TYPE_CHECKING:
    from uniffy.core.models.login.organization_member import OrganizationRole

# Content types that have no matching domain admin (USER, ROOM, etc.) are
# absent and resolve to "not a domain admin".
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
    ContentType.AGENT_CRON_TASK: DomainType.AGENTS,
}


class PermissionChecker:
    """Request-scoped resolver of effective roles for users on content items."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self._org_role_cache: dict[tuple[UUID, UUID], OrganizationRole | None] = {}
        self._domain_admin_cache: dict[tuple[UUID, UUID, DomainType], bool] = {}
        self._org_defaults_cache: dict[
            tuple[UUID, ContentType], tuple[AccessMode | None, ContentRole | None]
        ] = {}
        self._authorization_facts: dict[
            tuple[UUID, UUID, ContentType, UUID], ScalarAuthorizationFacts | None
        ] = {}

    async def effective_role(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
        *,
        owner_id: UUID,
        access_mode: AccessMode | None,
        baseline_role: ContentRole | None,
    ) -> ContentRole | None:
        """Resolve the user's effective role; ``None`` means no access.

        Delegating types (TASK, COMMENT, ATTACHMENT) must resolve to their
        parent before calling. ``baseline_role`` must be non-null iff
        ``access_mode == OPEN_TO_ORG``.
        """

        facts = await self._load_authorization_facts(
            user_id=user_id,
            organization_id=organization_id,
            content_type=content_type,
            content_id=content_id,
        )
        if facts is None or not facts.is_active_user:
            return None

        if facts.is_system_admin and facts.organization_role is None:
            if facts.support_session_id is None or facts.support_scope is None:
                return None
            active_support_session_var.set(
                ActiveSupportSession(
                    session_id=facts.support_session_id,
                    organization_id=organization_id,
                    support_user_id=user_id,
                    scope=facts.support_scope.value,
                )
            )
            return (
                ContentRole.EDITOR
                if facts.support_scope == SupportSessionScope.READ_WRITE
                else ContentRole.VIEWER
            )

        if facts.organization_role is None:
            return None

        from uniffy.domains.organizations.defaults import ORG_PERMISSION_DEFAULTS

        fallback = ORG_PERMISSION_DEFAULTS.get(content_type, {})
        default_mode = facts.default_access_mode or fallback.get("default_access_mode")
        default_baseline = (
            facts.default_baseline_role
            if facts.default_access_mode is not None
            else fallback.get("default_baseline_role")
        )
        return resolve_effective_content_role(
            user_id=user_id,
            owner_id=owner_id,
            is_active_member=True,
            support_role=None,
            blocked=facts.blocked,
            granted_role=facts.granted_role,
            raw_access_mode=access_mode,
            raw_baseline_role=baseline_role,
            org_default_access_mode=default_mode,
            org_default_baseline_role=default_baseline,
        )

    async def get_org_defaults(
        self,
        organization_id: UUID,
        content_type: ContentType,
    ) -> tuple[AccessMode | None, ContentRole | None]:
        """Return the org's default ``(access_mode, baseline_role)`` for a content type."""
        key = (organization_id, content_type)
        if key in self._org_defaults_cache:
            return self._org_defaults_cache[key]

        from uniffy.core.auth.permissions.defaults import resolve_content_defaults

        defaults = await resolve_content_defaults(self.session, organization_id, content_type)
        self._org_defaults_cache[key] = defaults
        return defaults

    async def is_blocked(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
    ) -> bool:
        """Whether an explicit BLOCKED grant (direct or via group) denies this user.

        For domains that layer their own membership on top of ``effective_role``
        (e.g. calendar attendees): a ``None`` role is ambiguous between "no
        access" and "explicitly blocked", and BLOCKED must beat the domain grant.
        """
        facts = await self._load_authorization_facts(
            user_id=user_id,
            organization_id=organization_id,
            content_type=content_type,
            content_id=content_id,
        )
        return bool(facts is not None and facts.blocked)

    async def is_org_admin(self, user_id: UUID, organization_id: UUID) -> bool:
        return await self._is_org_admin(user_id, organization_id)

    async def is_domain_admin(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
    ) -> bool:
        return await self._is_domain_admin_for_content(user_id, organization_id, content_type)

    async def get_user_org_role(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> OrganizationRole | None:
        return await self._get_user_org_role(user_id, organization_id)

    async def _load_authorization_facts(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
    ) -> ScalarAuthorizationFacts | None:
        key = (user_id, organization_id, content_type, content_id)
        if key not in self._authorization_facts:
            self._authorization_facts[key] = await load_scalar_authorization_facts(
                self.session,
                user_id=user_id,
                organization_id=organization_id,
                content_type=content_type,
                content_id=content_id,
            )
        return self._authorization_facts[key]

    async def _get_user_org_role(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> OrganizationRole | None:
        key = (user_id, organization_id)
        if key in self._org_role_cache:
            return self._org_role_cache[key]

        membership = await get_active_membership(self.session, user_id, organization_id)
        role = membership.role if membership is not None else None
        self._org_role_cache[key] = role
        return role

    async def _is_org_admin(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> bool:
        from uniffy.core.models.login.organization_member import OrganizationRole

        role = await self._get_user_org_role(user_id, organization_id)
        return role in (OrganizationRole.OWNER, OrganizationRole.ADMIN)

    async def _is_domain_admin_for_content(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
    ) -> bool:
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
