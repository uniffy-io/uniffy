"""Per-org calendar policy backed by the generic ``org_settings`` KV store.

Stored as one JSON blob under ``namespace='calendar'``, ``key='policy'``. An absent
row means every field takes its built-in default.
"""

import os
from dataclasses import dataclass
from enum import StrEnum
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.auth.membership import get_active_membership
from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.config.settings.organization import OrgSettingsOperations
from uniffy.core.errors import PermissionDeniedError
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.types import ContentType

CALENDAR_NAMESPACE = "calendar"
POLICY_KEY = "policy"


class CalendarPolicyAudience(StrEnum):
    EVERYONE = "everyone"
    ADMINS = "admins"


class ProviderSyncAudience(StrEnum):
    """Who may connect a Google or Microsoft account."""

    OFF = "off"
    ADMINS = "admins"
    EVERYONE = "everyone"


DEFAULT_TEAM_CALENDAR_CREATORS = CalendarPolicyAudience.EVERYONE
DEFAULT_ORG_WIDE_CALENDAR_SHARERS = CalendarPolicyAudience.EVERYONE

EXTERNAL_SUBSCRIPTIONS_ENV = "CALENDAR_EXTERNAL_SUBSCRIPTIONS_ENABLED"
_EXTERNAL_SUBSCRIPTIONS_KEY = "allow_external_subscriptions"
_TRUE_WORDS = frozenset({"1", "true", "yes"})
_FALSE_WORDS = frozenset({"0", "false", "no"})


def _env_flag(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    value = raw.strip().lower()
    if value in _TRUE_WORDS:
        return True
    if value in _FALSE_WORDS:
        return False
    raise ValueError(f"{name} must be true or false, got {raw!r}")


# Parsed once so a typo fails the process at startup, not at the first subscription.
DEFAULT_ALLOW_EXTERNAL_SUBSCRIPTIONS = _env_flag(EXTERNAL_SUBSCRIPTIONS_ENV, default=True)

PROVIDER_SYNC_ENV = "CALENDAR_PROVIDER_SYNC_ENABLED"
PROVIDER_WRITES_ENV = "CALENDAR_PROVIDER_WRITES_ENABLED"
_PROVIDER_SYNC_AUDIENCE_KEY = "provider_sync_audience"
_PROVIDER_WRITES_KEY = "allow_provider_writes"
DEFAULT_PROVIDER_SYNC_AUDIENCE = ProviderSyncAudience.EVERYONE


@dataclass(frozen=True)
class ProviderDeployment:
    """The deployment's switches, above every organization's policy."""

    sync_enabled: bool
    writes_enabled: bool


def provider_deployment() -> ProviderDeployment:
    """Read per call so tests and a restarted worker see the current environment."""
    sync = _env_flag(PROVIDER_SYNC_ENV, default=False)
    return ProviderDeployment(
        sync_enabled=sync,
        writes_enabled=sync and _env_flag(PROVIDER_WRITES_ENV, default=False),
    )


# Validated at import so a typo fails the process at startup.
provider_deployment()


@dataclass(frozen=True)
class ResolvedCalendarPolicy:
    """Creation policy covers additional calendars; wire names retain compatibility."""

    organization_id: UUID
    team_calendar_creators: CalendarPolicyAudience = DEFAULT_TEAM_CALENDAR_CREATORS
    org_wide_calendar_sharers: CalendarPolicyAudience = DEFAULT_ORG_WIDE_CALENDAR_SHARERS
    allow_external_subscriptions: bool = DEFAULT_ALLOW_EXTERNAL_SUBSCRIPTIONS
    provider_sync_audience: ProviderSyncAudience = DEFAULT_PROVIDER_SYNC_AUDIENCE
    allow_provider_writes: bool = True

    def provider_writes_enabled(self) -> bool:
        """Edits flow back to providers only when both the deployment and the org allow it."""
        return (
            provider_deployment().writes_enabled
            and self.allow_provider_writes
            and self.provider_sync_audience != ProviderSyncAudience.OFF
        )


@dataclass(frozen=True)
class CalendarPolicyView:
    """The policy plus what it allows the member reading it, for the UI's affordances."""

    policy: ResolvedCalendarPolicy
    can_create_team_calendars: bool
    can_share_calendars_org_wide: bool
    can_subscribe_external_calendars: bool
    can_connect_providers: bool = False


def _audience(blob: dict, key: str, default: CalendarPolicyAudience) -> CalendarPolicyAudience:
    try:
        return CalendarPolicyAudience(blob.get(key, default))
    except ValueError:
        return default


async def resolve_calendar_policy(
    session: AsyncSession, organization_id: UUID
) -> ResolvedCalendarPolicy:
    """The org's effective calendar policy; a missing or malformed row resolves to defaults."""
    rows = await OrgSettingsOperations(session).get_namespace(organization_id, CALENDAR_NAMESPACE)
    row = rows.get(POLICY_KEY)
    if row is None or not isinstance(row.value, dict):
        return ResolvedCalendarPolicy(organization_id=organization_id)
    return ResolvedCalendarPolicy(
        organization_id=organization_id,
        team_calendar_creators=_audience(
            row.value, "team_calendar_creators", DEFAULT_TEAM_CALENDAR_CREATORS
        ),
        org_wide_calendar_sharers=_audience(
            row.value, "org_wide_calendar_sharers", DEFAULT_ORG_WIDE_CALENDAR_SHARERS
        ),
        allow_external_subscriptions=_flag(
            row.value, _EXTERNAL_SUBSCRIPTIONS_KEY, DEFAULT_ALLOW_EXTERNAL_SUBSCRIPTIONS
        ),
        provider_sync_audience=_sync_audience(row.value),
        allow_provider_writes=_flag(row.value, _PROVIDER_WRITES_KEY, True),
    )


def _sync_audience(blob: dict) -> ProviderSyncAudience:
    try:
        return ProviderSyncAudience(
            blob.get(_PROVIDER_SYNC_AUDIENCE_KEY, DEFAULT_PROVIDER_SYNC_AUDIENCE)
        )
    except ValueError:
        return DEFAULT_PROVIDER_SYNC_AUDIENCE


def _flag(blob: dict, key: str, default: bool) -> bool:
    value = blob.get(key, default)
    return value if isinstance(value, bool) else default


async def is_calendar_admin(session: AsyncSession, user_id: UUID, organization_id: UUID) -> bool:
    """Org admins and CALENDAR domain admins; a domain-level power, never content access."""
    checker = PermissionChecker(session)
    if await checker.is_org_admin(user_id, organization_id):
        return True
    return await checker.is_domain_admin(user_id, organization_id, ContentType.CALENDAR)


async def _admits(
    session: AsyncSession,
    audience: CalendarPolicyAudience,
    user_id: UUID,
    organization_id: UUID,
) -> bool:
    if audience == CalendarPolicyAudience.EVERYONE:
        return True
    return await is_calendar_admin(session, user_id, organization_id)


async def require_can_create_team_calendar(
    session: AsyncSession, user_id: UUID, organization_id: UUID
) -> None:
    policy = await resolve_calendar_policy(session, organization_id)
    if not await _admits(session, policy.team_calendar_creators, user_id, organization_id):
        raise PermissionDeniedError(
            "create", "calendar - your organization limits this to calendar admins"
        )


async def require_can_open_calendar_to_org(
    session: AsyncSession, user_id: UUID, organization_id: UUID
) -> None:
    policy = await resolve_calendar_policy(session, organization_id)
    if not await _admits(session, policy.org_wide_calendar_sharers, user_id, organization_id):
        raise PermissionDeniedError(
            "share", "calendar with the organization - your organization limits this to admins"
        )


async def require_can_subscribe(session: AsyncSession, organization_id: UUID) -> None:
    policy = await resolve_calendar_policy(session, organization_id)
    if not policy.allow_external_subscriptions:
        raise PermissionDeniedError(
            "subscribe", "external calendar - your organization has turned this off"
        )


async def may_connect_providers(
    session: AsyncSession,
    policy: ResolvedCalendarPolicy,
    user_id: UUID,
) -> bool:
    """Whether the deployment and the org's audience admit this member to provider sync."""
    if not provider_deployment().sync_enabled:
        return False
    return await policy_admits_sync(session, policy, user_id)


async def policy_admits_sync(
    session: AsyncSession, policy: ResolvedCalendarPolicy, user_id: UUID
) -> bool:
    if policy.provider_sync_audience == ProviderSyncAudience.OFF:
        return False
    if policy.provider_sync_audience == ProviderSyncAudience.EVERYONE:
        return True
    return await is_calendar_admin(session, user_id, policy.organization_id)


async def require_can_connect(session: AsyncSession, user_id: UUID, organization_id: UUID) -> None:
    policy = await resolve_calendar_policy(session, organization_id)
    if not await may_connect_providers(session, policy, user_id):
        raise PermissionDeniedError(
            "connect", "calendar account - your organization has not turned this on"
        )


async def get_calendar_policy_view(
    session: AsyncSession, user_id: UUID, organization_id: UUID
) -> CalendarPolicyView:
    if await get_active_membership(session, user_id, organization_id) is None:
        raise PermissionDeniedError("view", "calendar policy")
    policy = await resolve_calendar_policy(session, organization_id)
    return CalendarPolicyView(
        policy=policy,
        can_create_team_calendars=await _admits(
            session, policy.team_calendar_creators, user_id, organization_id
        ),
        can_share_calendars_org_wide=await _admits(
            session, policy.org_wide_calendar_sharers, user_id, organization_id
        ),
        can_subscribe_external_calendars=policy.allow_external_subscriptions,
        can_connect_providers=await may_connect_providers(session, policy, user_id),
    )


async def update_calendar_policy(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
    *,
    team_calendar_creators: CalendarPolicyAudience,
    org_wide_calendar_sharers: CalendarPolicyAudience,
    allow_external_subscriptions: bool | None = None,
    provider_sync_audience: ProviderSyncAudience | None = None,
    allow_provider_writes: bool | None = None,
) -> CalendarPolicyView:
    if not await PermissionChecker(session).is_org_admin(user_id, organization_id):
        raise PermissionDeniedError("update", "calendar policy")
    previous = await resolve_calendar_policy(session, organization_id)
    policy = ResolvedCalendarPolicy(
        organization_id=organization_id,
        team_calendar_creators=team_calendar_creators,
        org_wide_calendar_sharers=org_wide_calendar_sharers,
        allow_external_subscriptions=(
            previous.allow_external_subscriptions
            if allow_external_subscriptions is None
            else allow_external_subscriptions
        ),
        provider_sync_audience=(
            previous.provider_sync_audience
            if provider_sync_audience is None
            else provider_sync_audience
        ),
        allow_provider_writes=(
            previous.allow_provider_writes
            if allow_provider_writes is None
            else allow_provider_writes
        ),
    )
    await OrgSettingsOperations(session).set(
        organization_id=organization_id,
        namespace=CALENDAR_NAMESPACE,
        key=POLICY_KEY,
        value={
            "team_calendar_creators": policy.team_calendar_creators.value,
            "org_wide_calendar_sharers": policy.org_wide_calendar_sharers.value,
            _EXTERNAL_SUBSCRIPTIONS_KEY: policy.allow_external_subscriptions,
            _PROVIDER_SYNC_AUDIENCE_KEY: policy.provider_sync_audience.value,
            _PROVIDER_WRITES_KEY: policy.allow_provider_writes,
        },
        updated_by_user_id=user_id,
    )
    await write_audit_event(
        session,
        organization_id=organization_id,
        actor_user_id=user_id,
        action=Action.CALENDAR_POLICY_UPDATED,
        resource_type=AuditResourceType.CALENDAR,
        resource_id=organization_id,
        details={
            "team_calendar_creators": policy.team_calendar_creators.value,
            "org_wide_calendar_sharers": policy.org_wide_calendar_sharers.value,
            "previous_team_calendar_creators": previous.team_calendar_creators.value,
            "previous_org_wide_calendar_sharers": previous.org_wide_calendar_sharers.value,
            _EXTERNAL_SUBSCRIPTIONS_KEY: policy.allow_external_subscriptions,
            f"previous_{_EXTERNAL_SUBSCRIPTIONS_KEY}": previous.allow_external_subscriptions,
            _PROVIDER_SYNC_AUDIENCE_KEY: policy.provider_sync_audience.value,
            f"previous_{_PROVIDER_SYNC_AUDIENCE_KEY}": previous.provider_sync_audience.value,
            _PROVIDER_WRITES_KEY: policy.allow_provider_writes,
            f"previous_{_PROVIDER_WRITES_KEY}": previous.allow_provider_writes,
        },
    )
    await session.commit()
    # The updater is an org admin, whom both audiences admit.
    return CalendarPolicyView(
        policy=policy,
        can_create_team_calendars=True,
        can_share_calendars_org_wide=True,
        can_subscribe_external_calendars=policy.allow_external_subscriptions,
        can_connect_providers=(
            provider_deployment().sync_enabled
            and policy.provider_sync_audience != ProviderSyncAudience.OFF
        ),
    )
