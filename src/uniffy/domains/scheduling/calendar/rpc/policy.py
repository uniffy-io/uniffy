"""Org calendar policy RPC handlers."""

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from uniffy_proto.cal.v1.calendar_pb import (
    CalendarPolicy,
    CalendarPolicyAudience,
    GetCalendarPolicyRequest,
    GetCalendarPolicyResponse,
    UpdateCalendarPolicyRequest,
    UpdateCalendarPolicyResponse,
)

from uniffy.core.auth.principal import current_user_id, resolve_organization_id
from uniffy.domains.scheduling.calendar import policy as calendar_policy
from uniffy.domains.scheduling.calendar.policy import ResolvedCalendarPolicy
from uniffy.domains.scheduling.calendar.rpc.support import map_domain_error
from uniffy.infrastructure.database import open_session

_AUDIENCE_TO_PROTO = {
    calendar_policy.CalendarPolicyAudience.EVERYONE: CalendarPolicyAudience.EVERYONE,
    calendar_policy.CalendarPolicyAudience.ADMINS: CalendarPolicyAudience.ADMINS,
}
_AUDIENCE_FROM_PROTO = {proto: value for value, proto in _AUDIENCE_TO_PROTO.items()}


def _audience_from_proto(
    value: CalendarPolicyAudience, field: str
) -> calendar_policy.CalendarPolicyAudience:
    audience = _AUDIENCE_FROM_PROTO.get(value)
    if audience is None:
        raise ConnectError(Code.INVALID_ARGUMENT, f"{field} is required")
    return audience


def _policy_to_proto(policy: ResolvedCalendarPolicy) -> CalendarPolicy:
    return CalendarPolicy(
        organization_id=str(policy.organization_id),
        team_calendar_creators=_AUDIENCE_TO_PROTO[policy.team_calendar_creators],
        org_wide_calendar_sharers=_AUDIENCE_TO_PROTO[policy.org_wide_calendar_sharers],
    )


class CalendarPolicyHandlers:
    async def get_calendar_policy(
        self,
        request: GetCalendarPolicyRequest,
        ctx: RequestContext,
    ) -> GetCalendarPolicyResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        try:
            async with open_session() as session:
                view = await calendar_policy.get_calendar_policy_view(
                    session, user_id, organization_id
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("get_calendar_policy", exc) from exc
        return GetCalendarPolicyResponse(
            policy=_policy_to_proto(view.policy),
            can_create_team_calendars=view.can_create_team_calendars,
            can_share_calendars_org_wide=view.can_share_calendars_org_wide,
        )

    async def update_calendar_policy(
        self,
        request: UpdateCalendarPolicyRequest,
        ctx: RequestContext,
    ) -> UpdateCalendarPolicyResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        team_calendar_creators = _audience_from_proto(
            request.team_calendar_creators, "team_calendar_creators"
        )
        org_wide_calendar_sharers = _audience_from_proto(
            request.org_wide_calendar_sharers, "org_wide_calendar_sharers"
        )
        try:
            async with open_session() as session:
                view = await calendar_policy.update_calendar_policy(
                    session,
                    user_id,
                    organization_id,
                    team_calendar_creators=team_calendar_creators,
                    org_wide_calendar_sharers=org_wide_calendar_sharers,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("update_calendar_policy", exc) from exc
        return UpdateCalendarPolicyResponse(
            policy=_policy_to_proto(view.policy),
            can_create_team_calendars=view.can_create_team_calendars,
            can_share_calendars_org_wide=view.can_share_calendars_org_wide,
        )
