"""Single source of truth for content access decisions."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.cache import (
    get_or_load_effective_role,
    get_or_load_org_admin,
)
from uniffy.core.auth.permissions.defaults import resolve_effective_policy
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
    ContentType.PROVIDER_KEY: DomainType.AGENTS,
    ContentType.PROMPT: DomainType.AGENTS,
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
        self._support_ctx_seen: set[tuple[UUID, UUID]] = set()
        self._is_system_admin_cache: dict[UUID, bool] = {}

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
        """Resolve the user's effective role; ``None`` means no access.

        Delegating types (TASK, COMMENT, ATTACHMENT) must resolve to their
        parent before calling. ``baseline_role`` must be non-null iff
        ``access_mode == OPEN_TO_ORG``.
        """

        # The support-session ContextVar must be populated BEFORE consulting the
        # cached role - otherwise OrgCipher.decrypt and the audit-tag merger
        # observe "no session" on every cache hit and the privacy contract
        # degrades to "default-deny fires once per role TTL window".
        await self._ensure_support_session_context(user_id, organization_id)

        async def _compute() -> ContentRole | None:
            # Platform operators (cloud sysadmins) who are NOT members of the
            # tenant org MUST route through SupportSession - they have no
            # tenant identity and the org/domain/owner branches below would
            # otherwise grant nothing anyway, but treating them explicitly
            # makes the boundary obvious. A self-hosted operator who is also
            # the org owner has a real OrganizationMember row and follows the
            # tenant-member path: their access flows from membership, not
            # from is_system_admin.
            if await self._is_system_admin(user_id):
                if not await self._is_user_in_organization(
                    user_id, organization_id
                ):
                    return await self._support_session_role(
                        user_id, organization_id
                    )
                # Sysadmins with a tenant membership keep going; their access
                # flows from the membership, not from is_system_admin.

            if await self._is_org_admin(user_id, organization_id):
                return ContentRole.OWNER

            if await self._is_domain_admin_for_content(
                user_id, organization_id, content_type
            ):
                return ContentRole.ADMIN

            if owner_id == user_id:
                return ContentRole.OWNER

            effective_mode, effective_baseline = await self._resolve_effective(
                organization_id, content_type, access_mode, baseline_role,
            )

            member_role = await self._get_member_role(
                organization_id, content_type, content_id, user_id
            )
            if member_role == ContentRole.BLOCKED:
                return None
            if member_role is not None:
                return member_role

            if effective_mode == AccessMode.OWNER_ONLY:
                return None
            if effective_mode == AccessMode.EXPLICIT_MEMBERS:
                return None
            if effective_mode == AccessMode.OPEN_TO_ORG:
                if effective_baseline is None:
                    return None
                if not await self._is_user_in_organization(
                    user_id, organization_id
                ):
                    return None
                return effective_baseline

            return None

        return await get_or_load_effective_role(
            organization_id, user_id, content_type, content_id, _compute
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

    async def _resolve_effective(
        self,
        organization_id: UUID,
        content_type: ContentType,
        raw_access_mode: AccessMode | None,
        raw_baseline_role: ContentRole | None,
    ) -> tuple[AccessMode, ContentRole | None]:
        if raw_access_mode is not None and (
            raw_access_mode != AccessMode.OPEN_TO_ORG or raw_baseline_role is not None
        ):
            return resolve_effective_policy(
                raw_access_mode, raw_baseline_role, None, None,
            )
        default_mode, default_baseline = await self.get_org_defaults(
            organization_id, content_type,
        )
        return resolve_effective_policy(
            raw_access_mode, raw_baseline_role, default_mode, default_baseline,
        )

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

    async def _get_member_role(
        self,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
        user_id: UUID,
    ) -> ContentRole | None:
        """Highest applicable role from direct + group-derived membership.

        BLOCKED from any source wins over every other role; otherwise the
        highest ordinal across direct + group rows wins.
        """
        from uniffy.core.models.login.group_member import GroupMember
        from uniffy.core.models.permissions.content_member import ContentMember

        now = datetime.now(UTC)

        # At most one row due to the unique constraint on (org, ct, cid, USER, uid).
        direct_result = await self.session.execute(
            select(ContentMember.role).where(
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

        user_groups_subq = select(GroupMember.group_id).where(
            GroupMember.user_id == user_id,
            GroupMember.is_active == True,  # noqa: E712
        )

        group_result = await self.session.execute(
            select(ContentMember.role).where(
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
        from uniffy.core.models.login.organization_member import OrganizationMember

        key = (user_id, organization_id)
        if key in self._org_role_cache:
            return self._org_role_cache[key]

        result = await self.session.execute(
            select(OrganizationMember.role).where(
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
        async def _load() -> bool:
            from uniffy.core.models.login.organization_member import (
                OrganizationRole,
            )

            role = await self._get_user_org_role(user_id, organization_id)
            return role in (OrganizationRole.OWNER, OrganizationRole.ADMIN)

        return await get_or_load_org_admin(organization_id, user_id, _load)

    async def _is_user_in_organization(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> bool:
        return await self._get_user_org_role(user_id, organization_id) is not None

    async def _is_system_admin(self, user_id: UUID) -> bool:
        cached = self._is_system_admin_cache.get(user_id)
        if cached is not None:
            return cached
        from uniffy.core.models.login.user import User

        is_admin = bool(
            (
                await self.session.execute(
                    select(User.is_system_admin).where(User.id == user_id)
                )
            ).scalar_one_or_none()
        )
        self._is_system_admin_cache[user_id] = is_admin
        return is_admin

    async def _ensure_support_session_context(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> None:
        """Populate the support-session ContextVar; idempotent per checker instance.

        Lives outside the cached role compute so the ContextVar is set on every
        request regardless of whether the role itself is served from Valkey.
        """
        from uniffy.domains.platform.support_session.context import (
            ActiveSupportSession,
            active_support_session_var,
            get_active_support_session,
        )
        from uniffy.domains.platform.support_session.operations import (
            SupportSessionOperations,
        )

        key = (user_id, organization_id)
        if key in self._support_ctx_seen:
            return
        self._support_ctx_seen.add(key)

        if get_active_support_session() is not None:
            return
        if not await self._is_system_admin(user_id):
            return

        ops = SupportSessionOperations(self.session)
        session = await ops.active_session_for(
            user_id=user_id, organization_id=organization_id
        )
        if session is None:
            return

        active_support_session_var.set(
            ActiveSupportSession(
                session_id=session.id,
                organization_id=session.organization_id,
                support_user_id=session.support_user_id,
                scope=session.scope.value,
            )
        )

    async def _support_session_role(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> ContentRole | None:
        """Role granted by an active support session, if any.

        Only meaningful for ``is_system_admin=true`` users. Operators with an
        active session sit between the org/domain admin bypass and the owner_id
        check so existing explicit grants are ignored during the session - the
        session is the single audit-attributable access path.
        """
        from uniffy.core.models.platform.support_session import (
            SupportSessionScope,
        )
        from uniffy.domains.platform.support_session.operations import (
            SupportSessionOperations,
        )

        if not await self._is_system_admin(user_id):
            return None

        ops = SupportSessionOperations(self.session)
        session = await ops.active_session_for(
            user_id=user_id, organization_id=organization_id
        )
        if session is None:
            return None

        if session.scope == SupportSessionScope.READ_WRITE:
            return ContentRole.EDITOR
        return ContentRole.VIEWER

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
