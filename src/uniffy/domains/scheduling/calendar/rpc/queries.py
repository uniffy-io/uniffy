"""Calendar event query RPC handlers."""

from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from uniffy_proto.cal.v1.calendar_pb2 import (
    GetEventRequest,
    GetEventResponse,
    GetEventsInRangeRequest,
    GetEventsInRangeResponse,
    ListEventsRequest,
    ListEventsResponse,
)

from uniffy.core.auth.principal import current_user_id, resolve_organization_id
from uniffy.core.converters.proto import timestamp_to_datetime
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import ContentType
from uniffy.domains.permissions.access import ResourceAccessResolver, ResourceKey
from uniffy.domains.scheduling.calendar import queries
from uniffy.domains.scheduling.calendar.converters import event_to_proto
from uniffy.domains.scheduling.calendar.events.reader import CalendarEventReader
from uniffy.domains.scheduling.calendar.events.state import event_details_hidden
from uniffy.domains.scheduling.calendar.rpc.support import (
    hydrate_event_tags,
    map_domain_error,
    parse_event_id,
    parse_tag_id_list,
    parse_uuid,
)
from uniffy.domains.scheduling.rooms.projection import (
    get_event_room_info,
    get_room_info_for_events,
)
from uniffy.infrastructure.database import open_session

DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 100


class EventQueryHandlers:
    async def get_event(
        self,
        request: GetEventRequest,
        ctx: RequestContext,
    ) -> GetEventResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        event_id = parse_event_id(request.event_id)

        try:
            async with open_session() as session:
                operations = CalendarEventReader(session)
                event, attendees = await operations.get_event_with_attendees(
                    user_id, organization_id, event_id
                )
                room_info = await get_event_room_info(session, event_id)
                tags_by_urn = await hydrate_event_tags(session, organization_id, [event.id])
                user_role = await operations._resolve_role(user_id, organization_id, event)
                return GetEventResponse(
                    event=event_to_proto(
                        event,
                        attendees,
                        tags=tags_by_urn.get(
                            build_content_urn(ContentType.CALENDAR_EVENT, event.id),
                            [],
                        ),
                        user_role=user_role,
                        details_hidden=event_details_hidden(
                            event,
                            user_id,
                            user_role,
                            any(attendee.user_id == user_id for attendee, _ in attendees),
                        ),
                        **room_info,
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("get_event", exc) from exc

    async def list_events(
        self,
        request: ListEventsRequest,
        ctx: RequestContext,
    ) -> ListEventsResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)

        calendar_id = None
        if request.HasField("calendar_id"):
            calendar_id = parse_uuid(request.calendar_id, "calendar_id")
        category_id = None
        if request.HasField("category_id"):
            category_id = parse_uuid(request.category_id, "category_id")
        start_date = None
        if request.HasField("start_date"):
            start_date = timestamp_to_datetime(request.start_date)
        end_date = None
        if request.HasField("end_date"):
            end_date = timestamp_to_datetime(request.end_date)
        tag_ids = parse_tag_id_list(request.tag_ids) if request.tag_ids else None

        page = max(1, request.page or 1)
        page_size = min(MAX_PAGE_SIZE, max(1, request.page_size or DEFAULT_PAGE_SIZE))

        try:
            async with open_session() as session:
                operations = CalendarEventReader(session)
                events, total = await operations.list_events(
                    user_id=user_id,
                    organization_id=organization_id,
                    calendar_id=calendar_id,
                    category_id=category_id,
                    start_date=start_date,
                    end_date=end_date,
                    include_deleted=request.include_deleted,
                    tag_ids=tag_ids,
                    page=page,
                    page_size=page_size,
                    sort_by=request.sort_by or "start_time",
                    sort_order=request.sort_order or "asc",
                )

                total_pages = (total + page_size - 1) // page_size
                event_ids = [event.id for event in events]
                tags_by_urn = await hydrate_event_tags(session, organization_id, event_ids)
                decisions = await ResourceAccessResolver(session).resolve_page(
                    actor_id=user_id,
                    organization_id=organization_id,
                    keys=[
                        ResourceKey(ContentType.CALENDAR_EVENT, event_id) for event_id in event_ids
                    ],
                )
                attendees_by_event = await queries.get_attendees_for_events(session, event_ids)
                room_info_by_event = await get_room_info_for_events(session, event_ids)

                proto_events = []
                for event in events:
                    attendees = attendees_by_event.get(event.id, [])
                    room_info = room_info_by_event.get(event.id, {})
                    user_role = decisions[ResourceKey(ContentType.CALENDAR_EVENT, event.id)].role
                    proto_events.append(
                        event_to_proto(
                            event,
                            attendees,
                            tags=tags_by_urn.get(
                                build_content_urn(ContentType.CALENDAR_EVENT, event.id),
                                [],
                            ),
                            user_role=user_role,
                            details_hidden=event_details_hidden(
                                event,
                                user_id,
                                user_role,
                                any(attendee.user_id == user_id for attendee, _ in attendees),
                            ),
                            **room_info,
                        )
                    )

                return ListEventsResponse(
                    events=proto_events,
                    total_count=total,
                    page=page,
                    page_size=page_size,
                    total_pages=total_pages,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("list_events", exc) from exc

    async def get_events_in_range(
        self,
        request: GetEventsInRangeRequest,
        ctx: RequestContext,
    ) -> GetEventsInRangeResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)

        calendar_ids = None
        if request.calendar_ids:
            calendar_ids = [parse_uuid(value, "calendar_id") for value in request.calendar_ids]
        category_ids = None
        if request.category_ids:
            category_ids = [parse_uuid(value, "category_id") for value in request.category_ids]
        channel_id = None
        if request.HasField("channel_id"):
            channel_id = parse_uuid(request.channel_id, "channel_id")

        try:
            async with open_session() as session:
                operations = CalendarEventReader(session)
                events = await operations.get_events_in_range(
                    user_id=user_id,
                    organization_id=organization_id,
                    start_date=timestamp_to_datetime(request.start_date),
                    end_date=timestamp_to_datetime(request.end_date),
                    calendar_ids=calendar_ids,
                    category_ids=category_ids,
                    channel_id=channel_id,
                )

                master_ids = list({parse_event_id(str(event.id)) for event in events})
                tags_by_urn = await hydrate_event_tags(session, organization_id, master_ids)
                decisions = await ResourceAccessResolver(session).resolve_page(
                    actor_id=user_id,
                    organization_id=organization_id,
                    keys=[
                        ResourceKey(ContentType.CALENDAR_EVENT, event_id) for event_id in master_ids
                    ],
                )
                attendees_by_event = await queries.get_attendees_for_events(session, master_ids)
                room_info_by_event = await get_room_info_for_events(session, master_ids)

                proto_events = []
                for event in events:
                    real_id = parse_event_id(str(event.id))
                    user_role = decisions[ResourceKey(ContentType.CALENDAR_EVENT, real_id)].role
                    attendees = attendees_by_event.get(real_id, [])
                    proto_events.append(
                        event_to_proto(
                            event,
                            attendees,
                            tags=tags_by_urn.get(
                                build_content_urn(ContentType.CALENDAR_EVENT, real_id),
                                [],
                            ),
                            user_role=user_role,
                            details_hidden=event_details_hidden(
                                event,
                                user_id,
                                user_role,
                                any(attendee.user_id == user_id for attendee, _ in attendees),
                            ),
                            **room_info_by_event.get(real_id, {}),
                        )
                    )

                return GetEventsInRangeResponse(events=proto_events)
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("get_events_in_range", exc) from exc
