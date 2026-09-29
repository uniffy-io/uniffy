"""Calendar event query RPC handlers."""

from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from protobuf.wkt import Timestamp
from uniffy_proto.cal.v1.calendar_pb import (
    GetEventRequest,
    GetEventResponse,
    GetEventsInRangeRequest,
    GetEventsInRangeResponse,
    ListEventsRequest,
    ListEventsResponse,
)

from uniffy.core.auth.principal import current_user_id, resolve_organization_id
from uniffy.core.converters.proto import timestamp_to_datetime
from uniffy.core.errors import ValidationError
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import ContentType
from uniffy.domains.permissions.access import ResourceAccessResolver, ResourceKey
from uniffy.domains.scheduling.calendar import queries
from uniffy.domains.scheduling.calendar.calendars.reader import CalendarReader
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
# The only order a cursor can express, since the cursor carries a start time.
CURSOR_SORT_FIELD = "start_time"


class EventQueryHandlers:
    async def get_event(
        self,
        request: GetEventRequest,
        ctx: RequestContext,
    ) -> GetEventResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)

        try:
            async with open_session() as session:
                operations = CalendarEventReader(session)
                event, attendees = await operations.get_event_with_attendees(
                    user_id, organization_id, request.event_id
                )
                event_id = parse_event_id(str(event.id))
                room_info = await get_event_room_info(session, event_id)
                tags_by_urn = await hydrate_event_tags(session, organization_id, [event_id])
                user_role = await operations._resolve_role(user_id, organization_id, event)
                return GetEventResponse(
                    event=event_to_proto(
                        event,
                        attendees,
                        tags=tags_by_urn.get(
                            build_content_urn(ContentType.CALENDAR_EVENT, event_id),
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
        if request.has_field("calendar_id"):
            calendar_id = parse_uuid(request.calendar_id, "calendar_id")
        category_id = None
        if request.has_field("category_id"):
            category_id = parse_uuid(request.category_id, "category_id")
        start_date = None
        if request.has_field("start_date"):
            start_date = timestamp_to_datetime(request.start_date)
        end_date = None
        if request.has_field("end_date"):
            end_date = timestamp_to_datetime(request.end_date)
        tag_ids = parse_tag_id_list(request.tag_ids) if request.tag_ids else None

        page = max(1, request.page or 1)
        page_size = min(MAX_PAGE_SIZE, max(1, request.page_size or DEFAULT_PAGE_SIZE))
        sort_by = request.sort_by or CURSOR_SORT_FIELD
        # An absent field means the caller pages by number; an empty one asks
        # for the first cursor page.
        by_cursor = request.has_field("page_token")
        page_token = request.page_token or None

        try:
            if by_cursor and sort_by != CURSOR_SORT_FIELD:
                raise ValidationError("page_token", "Cursor paging requires the start_time sort")

            async with open_session() as session:
                operations = CalendarEventReader(session)
                visibility_filter = (
                    None
                    if calendar_id
                    else await CalendarReader(session).event_visibility_filter(
                        user_id, organization_id
                    )
                )
                total = 0
                next_page_token = ""
                if by_cursor:
                    result = await operations.list_events_page(
                        user_id=user_id,
                        organization_id=organization_id,
                        calendar_id=calendar_id,
                        category_id=category_id,
                        start_date=start_date,
                        end_date=end_date,
                        include_deleted=request.include_deleted,
                        tag_ids=tag_ids,
                        page_token=page_token,
                        page_size=page_size,
                        sort_order=request.sort_order or "asc",
                        visibility_filter=visibility_filter,
                    )
                    events = result.events
                    next_page_token = result.next_page_token or ""
                else:
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
                        sort_by=sort_by,
                        sort_order=request.sort_order or "asc",
                        visibility_filter=visibility_filter,
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
                    decision = decisions[ResourceKey(ContentType.CALENDAR_EVENT, event.id)]
                    # The SQL filter already decided; the resolver is the last word.
                    if not decision.can_view:
                        continue
                    user_role = decision.role
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
                    next_page_token=next_page_token,
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
        if request.has_field("channel_id"):
            channel_id = parse_uuid(request.channel_id, "channel_id")

        try:
            async with open_session() as session:
                operations = CalendarEventReader(session)
                # A named calendar or a channel's meetings are asked for on purpose;
                # only the general grid follows what the member has hidden.
                visibility_filter = (
                    None
                    if calendar_ids or channel_id
                    else await CalendarReader(session).event_visibility_filter(
                        user_id, organization_id
                    )
                )
                events = await operations.get_events_in_range(
                    user_id=user_id,
                    organization_id=organization_id,
                    start_date=timestamp_to_datetime(
                        request.start_date if request.start_date is not None else Timestamp()
                    ),
                    end_date=timestamp_to_datetime(
                        request.end_date if request.end_date is not None else Timestamp()
                    ),
                    calendar_ids=calendar_ids,
                    category_ids=category_ids,
                    channel_id=channel_id,
                    visibility_filter=visibility_filter,
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
                    decision = decisions[ResourceKey(ContentType.CALENDAR_EVENT, real_id)]
                    if not decision.can_view:
                        continue
                    user_role = decision.role
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
