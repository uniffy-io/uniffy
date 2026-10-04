"""Calendar delegation RPC handlers, for members and for org admins."""

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from uniffy_proto.cal.v1.calendar_pb import (
    AdminRevokeCalendarDelegationRequest,
    AdminRevokeCalendarDelegationResponse,
    GrantCalendarDelegationRequest,
    GrantCalendarDelegationResponse,
    ListMyCalendarDelegationsRequest,
    ListMyCalendarDelegationsResponse,
    ListOrgCalendarDelegationsRequest,
    ListOrgCalendarDelegationsResponse,
    RevokeCalendarDelegationRequest,
    RevokeCalendarDelegationResponse,
)
from uniffy_proto.cal.v1.calendar_pb import CalendarDelegation as ProtoDelegation

from uniffy.core.auth.principal import current_user_id, resolve_organization_id
from uniffy.core.converters.proto import datetime_to_timestamp
from uniffy.domains.scheduling.calendar.calendars.converters import (
    DELEGATION_LEVEL_FROM_PROTO,
    DELEGATION_LEVEL_TO_PROTO,
)
from uniffy.domains.scheduling.calendar.delegation.operations import (
    CalendarDelegationOperations,
    DelegationView,
)
from uniffy.domains.scheduling.calendar.rpc.support import map_domain_error, parse_uuid
from uniffy.infrastructure.database import open_session


def delegation_to_proto(view: DelegationView) -> ProtoDelegation:
    delegation = view.delegation
    return ProtoDelegation(
        id=str(delegation.id),
        organization_id=str(delegation.organization_id),
        grantor_id=str(delegation.grantor_id),
        grantor_name=view.grantor_name,
        delegate_id=str(delegation.delegate_id),
        delegate_name=view.delegate_name,
        level=DELEGATION_LEVEL_TO_PROTO[delegation.level],
        created_at=datetime_to_timestamp(delegation.created_at),
        updated_at=datetime_to_timestamp(delegation.updated_at),
        inactive=view.inactive,
    )


class CalendarDelegationHandlers:
    async def list_my_calendar_delegations(
        self,
        request: ListMyCalendarDelegationsRequest,
        ctx: RequestContext,
    ) -> ListMyCalendarDelegationsResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        try:
            async with open_session() as session:
                by_me, to_me = await CalendarDelegationOperations(session).list_mine(
                    user_id, organization_id
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("list_my_calendar_delegations", exc) from exc
        return ListMyCalendarDelegationsResponse(
            granted_by_me=[delegation_to_proto(view) for view in by_me],
            granted_to_me=[delegation_to_proto(view) for view in to_me],
        )

    async def grant_calendar_delegation(
        self,
        request: GrantCalendarDelegationRequest,
        ctx: RequestContext,
    ) -> GrantCalendarDelegationResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        delegate_id = parse_uuid(request.delegate_id, "delegate_id")
        level = DELEGATION_LEVEL_FROM_PROTO.get(request.level)
        if level is None:
            raise ConnectError(Code.INVALID_ARGUMENT, "level is required")
        try:
            async with open_session() as session:
                view = await CalendarDelegationOperations(session).grant(
                    user_id, organization_id, delegate_id, level
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("grant_calendar_delegation", exc) from exc
        return GrantCalendarDelegationResponse(delegation=delegation_to_proto(view))

    async def revoke_calendar_delegation(
        self,
        request: RevokeCalendarDelegationRequest,
        ctx: RequestContext,
    ) -> RevokeCalendarDelegationResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        delegation_id = parse_uuid(request.delegation_id, "delegation_id")
        try:
            async with open_session() as session:
                await CalendarDelegationOperations(session).revoke(
                    user_id, organization_id, delegation_id
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("revoke_calendar_delegation", exc) from exc
        return RevokeCalendarDelegationResponse()

    async def list_org_calendar_delegations(
        self,
        request: ListOrgCalendarDelegationsRequest,
        ctx: RequestContext,
    ) -> ListOrgCalendarDelegationsResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        filter_user_id = (
            parse_uuid(request.user_id, "user_id") if request.has_field("user_id") else None
        )
        try:
            async with open_session() as session:
                views, next_token = await CalendarDelegationOperations(session).list_for_org(
                    user_id,
                    organization_id,
                    user_id=filter_user_id,
                    page_size=request.page_size,
                    page_token=request.page_token,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("list_org_calendar_delegations", exc) from exc
        return ListOrgCalendarDelegationsResponse(
            delegations=[delegation_to_proto(view) for view in views],
            next_page_token=next_token,
        )

    async def admin_revoke_calendar_delegation(
        self,
        request: AdminRevokeCalendarDelegationRequest,
        ctx: RequestContext,
    ) -> AdminRevokeCalendarDelegationResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        delegation_id = parse_uuid(request.delegation_id, "delegation_id")
        try:
            async with open_session() as session:
                await CalendarDelegationOperations(session).admin_revoke(
                    user_id, organization_id, delegation_id
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("admin_revoke_calendar_delegation", exc) from exc
        return AdminRevokeCalendarDelegationResponse()
