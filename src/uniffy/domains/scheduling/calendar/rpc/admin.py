"""Org-admin shared-calendar oversight RPC handlers."""

from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from uniffy_proto.cal.v1.calendar_pb import (
    ListOrgSharedCalendarsRequest,
    ListOrgSharedCalendarsResponse,
    RestrictCalendarToMembersRequest,
    RestrictCalendarToMembersResponse,
)
from uniffy_proto.cal.v1.calendar_pb import SharedCalendarSummary as ProtoSharedCalendarSummary

from uniffy.core.auth.principal import current_user_id, resolve_organization_id
from uniffy.core.converters.common_proto import access_mode_to_proto, content_role_to_proto
from uniffy.core.converters.proto import datetime_to_timestamp
from uniffy.core.search import SearchIndexer
from uniffy.domains.scheduling.calendar.calendars.converters import CALENDAR_TYPE_TO_PROTO
from uniffy.domains.scheduling.calendar.calendars.inventory import (
    SharedCalendarInventory,
    SharedCalendarSummary,
)
from uniffy.domains.scheduling.calendar.rpc.support import map_domain_error, parse_uuid
from uniffy.infrastructure.database import open_session


def summary_to_proto(summary: SharedCalendarSummary) -> ProtoSharedCalendarSummary:
    message = ProtoSharedCalendarSummary(
        calendar_id=str(summary.calendar_id),
        name=summary.name,
        owner_id=str(summary.owner_id),
        owner_name=summary.owner_name,
        calendar_type=CALENDAR_TYPE_TO_PROTO[summary.calendar_type],
        access_mode=access_mode_to_proto(summary.access_mode),
        user_grant_count=summary.user_grant_count,
        group_grant_count=summary.group_grant_count,
        created_at=datetime_to_timestamp(summary.created_at),
    )
    if summary.baseline_role is not None:
        message.baseline_role = content_role_to_proto(summary.baseline_role)
    return message


class CalendarOversightHandlers:
    search_indexer: SearchIndexer

    async def list_org_shared_calendars(
        self,
        request: ListOrgSharedCalendarsRequest,
        ctx: RequestContext,
    ) -> ListOrgSharedCalendarsResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        try:
            async with open_session() as session:
                summaries, next_token = await SharedCalendarInventory(session).list_shared(
                    user_id,
                    organization_id,
                    page_size=request.page_size,
                    page_token=request.page_token,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("list_org_shared_calendars", exc) from exc
        return ListOrgSharedCalendarsResponse(
            calendars=[summary_to_proto(summary) for summary in summaries],
            next_page_token=next_token,
        )

    async def restrict_calendar_to_members(
        self,
        request: RestrictCalendarToMembersRequest,
        ctx: RequestContext,
    ) -> RestrictCalendarToMembersResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        calendar_id = parse_uuid(request.calendar_id, "calendar_id")
        try:
            async with open_session() as session:
                summary = await SharedCalendarInventory(session).restrict_to_members(
                    user_id, organization_id, calendar_id, self.search_indexer
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("restrict_calendar_to_members", exc) from exc
        return RestrictCalendarToMembersResponse(calendar=summary_to_proto(summary))
