"""Calendar attendee and activity RPC handlers."""

from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from uniffy_proto.cal.v1.calendar_pb2 import (
    AddAttendeesRequest,
    AddAttendeesResponse,
    ListEventActivitiesRequest,
    ListEventActivitiesResponse,
    RemoveAttendeesRequest,
    RemoveAttendeesResponse,
    UpdateAttendeeRoleRequest,
    UpdateAttendeeRoleResponse,
    UpdateAttendeeStatusRequest,
    UpdateAttendeeStatusResponse,
)
from uniffy_proto.common.v1.common_pb2 import PaginationResponse

from uniffy.core.auth.principal import current_user_id, resolve_organization_id
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import ContentType
from uniffy.domains.scheduling.calendar import queries
from uniffy.domains.scheduling.calendar.converters import (
    activity_to_proto,
    attendee_role_from_proto,
    attendee_status_from_proto,
    event_to_proto,
)
from uniffy.domains.scheduling.calendar.events.operations import CalendarEventOperations
from uniffy.domains.scheduling.calendar.rpc.support import (
    hydrate_event_tags,
    map_domain_error,
    parse_event_id,
    parse_uuid,
)
from uniffy.infrastructure.database import open_session


class AttendeeHandlers:
    async def update_attendee_status(
        self,
        request: UpdateAttendeeStatusRequest,
        ctx: RequestContext,
    ) -> UpdateAttendeeStatusResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        event_id = parse_event_id(request.event_id)

        try:
            async with open_session() as session:
                await CalendarEventOperations(
                    session,
                    self.search_indexer,
                ).update_attendee_status(
                    user_id=user_id,
                    organization_id=organization_id,
                    event_id=event_id,
                    status=attendee_status_from_proto(request.status),
                )
                return UpdateAttendeeStatusResponse(success=True, message="Status updated")
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("update_attendee_status", exc) from exc

    async def update_attendee_role(
        self,
        request: UpdateAttendeeRoleRequest,
        ctx: RequestContext,
    ) -> UpdateAttendeeRoleResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        event_id = parse_event_id(request.event_id)
        target_user_id = parse_uuid(request.user_id, "user_id")

        try:
            async with open_session() as session:
                operations = CalendarEventOperations(session, self.search_indexer)
                event = await operations.update_attendee_role(
                    user_id=user_id,
                    organization_id=organization_id,
                    event_id=event_id,
                    target_user_id=target_user_id,
                    role=attendee_role_from_proto(request.role),
                )
                attendees = await queries.get_event_attendees(session, event.id)
                tags_by_urn = await hydrate_event_tags(session, organization_id, [event.id])
                return UpdateAttendeeRoleResponse(
                    event=event_to_proto(
                        event,
                        attendees,
                        tags=tags_by_urn.get(
                            build_content_urn(ContentType.CALENDAR_EVENT, event.id), []
                        ),
                        user_role=await operations._resolve_role(user_id, organization_id, event),
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("update_attendee_role", exc) from exc

    async def add_attendees(
        self,
        request: AddAttendeesRequest,
        ctx: RequestContext,
    ) -> AddAttendeesResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        event_id = parse_event_id(request.event_id)

        try:
            async with open_session() as session:
                operations = CalendarEventOperations(session, self.search_indexer)
                event = await operations.add_attendees(
                    user_id=user_id,
                    organization_id=organization_id,
                    event_id=event_id,
                    attendee_ids=[parse_uuid(value, "user_id") for value in request.user_ids],
                    role=attendee_role_from_proto(request.role),
                )
                attendees = await queries.get_event_attendees(session, event.id)
                tags_by_urn = await hydrate_event_tags(session, organization_id, [event.id])
                return AddAttendeesResponse(
                    event=event_to_proto(
                        event,
                        attendees,
                        tags=tags_by_urn.get(
                            build_content_urn(ContentType.CALENDAR_EVENT, event.id), []
                        ),
                        user_role=await operations._resolve_role(user_id, organization_id, event),
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("add_attendees", exc) from exc

    async def remove_attendees(
        self,
        request: RemoveAttendeesRequest,
        ctx: RequestContext,
    ) -> RemoveAttendeesResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        event_id = parse_event_id(request.event_id)

        try:
            async with open_session() as session:
                operations = CalendarEventOperations(session, self.search_indexer)
                event = await operations.remove_attendees(
                    user_id=user_id,
                    organization_id=organization_id,
                    event_id=event_id,
                    attendee_ids=[parse_uuid(value, "user_id") for value in request.user_ids],
                )
                attendees = await queries.get_event_attendees(session, event.id)
                tags_by_urn = await hydrate_event_tags(session, organization_id, [event.id])
                return RemoveAttendeesResponse(
                    event=event_to_proto(
                        event,
                        attendees,
                        tags=tags_by_urn.get(
                            build_content_urn(ContentType.CALENDAR_EVENT, event.id), []
                        ),
                        user_role=await operations._resolve_role(user_id, organization_id, event),
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("remove_attendees", exc) from exc

    async def list_event_activities(
        self,
        request: ListEventActivitiesRequest,
        ctx: RequestContext,
    ) -> ListEventActivitiesResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        event_id = parse_event_id(request.event_id)

        page = 1
        page_size = 50
        if request.HasField("pagination"):
            page = request.pagination.page if request.pagination.page > 0 else 1
            if request.pagination.page_size > 0:
                page_size = min(request.pagination.page_size, 200)

        try:
            async with open_session() as session:
                activities, total = await CalendarEventOperations(
                    session,
                    self.search_indexer,
                ).list_activities(
                    user_id=user_id,
                    organization_id=organization_id,
                    event_id=event_id,
                    limit=page_size,
                    offset=(page - 1) * page_size,
                )
                return ListEventActivitiesResponse(
                    activities=[activity_to_proto(activity) for activity in activities],
                    pagination=PaginationResponse(
                        page=page,
                        page_size=page_size,
                        total_count=total,
                        total_pages=(total + page_size - 1) // page_size,
                    ),
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("list_event_activities", exc) from exc
