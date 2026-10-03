"""Per-org calendar policy backed by the generic ``org_settings`` KV store.

Stored as one JSON blob under ``namespace='calendar'``, ``key='policy'``. An absent
row means every field takes its built-in default.
"""

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
from uniffy.core.types import CalendarType, ContentType

CALENDAR_NAMESPACE = "calendar"
POLICY_KEY = "policy"

# Kinds of calendar that exist to be shared with a team; creating one is policy-gated.
TEAM_CALENDAR_TYPES = frozenset({CalendarType.TEAM, CalendarType.SHARED})


class CalendarPolicyAudience(StrEnum):
    EVERYONE = "everyone"
    ADMINS = "admins"


DEFAULT_TEAM_CALENDAR_CREATORS = CalendarPolicyAudience.EVERYONE
DEFAULT_ORG_WIDE_CALENDAR_SHARERS = CalendarPolicyAudience.EVERYONE


@dataclass(frozen=True)
class ResolvedCalendarPolicy:
    """Effective per-org calendar policy; field names mirror the proto message."""

    organization_id: UUID
    team_calendar_creators: CalendarPolicyAudience = DEFAULT_TEAM_CALENDAR_CREATORS
    org_wide_calendar_sharers: CalendarPolicyAudience = DEFAULT_ORG_WIDE_CALENDAR_SHARERS


@dataclass(frozen=True)
class CalendarPolicyView:
    """The policy plus what it allows the member reading it, for the UI's affordances."""

    policy: ResolvedCalendarPolicy
    can_create_team_calendars: bool
    can_share_calendars_org_wide: bool


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
    )


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
            "create", "team calendar - your organization limits this to calendar admins"
        )


async def require_can_open_calendar_to_org(
    session: AsyncSession, user_id: UUID, organization_id: UUID
) -> None:
    policy = await resolve_calendar_policy(session, organization_id)
    if not await _admits(session, policy.org_wide_calendar_sharers, user_id, organization_id):
        raise PermissionDeniedError(
            "share", "calendar with the organization - your organization limits this to admins"
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
    )


async def update_calendar_policy(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
    *,
    team_calendar_creators: CalendarPolicyAudience,
    org_wide_calendar_sharers: CalendarPolicyAudience,
) -> CalendarPolicyView:
    if not await PermissionChecker(session).is_org_admin(user_id, organization_id):
        raise PermissionDeniedError("update", "calendar policy")
    previous = await resolve_calendar_policy(session, organization_id)
    policy = ResolvedCalendarPolicy(
        organization_id=organization_id,
        team_calendar_creators=team_calendar_creators,
        org_wide_calendar_sharers=org_wide_calendar_sharers,
    )
    await OrgSettingsOperations(session).set(
        organization_id=organization_id,
        namespace=CALENDAR_NAMESPACE,
        key=POLICY_KEY,
        value={
            "team_calendar_creators": policy.team_calendar_creators.value,
            "org_wide_calendar_sharers": policy.org_wide_calendar_sharers.value,
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
        },
    )
    await session.commit()
    # The updater is an org admin, whom both audiences admit.
    return CalendarPolicyView(
        policy=policy, can_create_team_calendars=True, can_share_calendars_org_wide=True
    )
