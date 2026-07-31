"""Calendar RPC handlers."""

import contextlib
from datetime import date as date_type
from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession
from uniffy_proto.cal.v1.calendar_pb2 import (
    AddAttendeesRequest,
    AddAttendeesResponse,
    CreateCategoryRequest,
    CreateCategoryResponse,
    CreateEventRequest,
    CreateEventResponse,
    CreateEventTemplateRequest,
    CreateEventTemplateResponse,
    DeleteCategoryRequest,
    DeleteCategoryResponse,
    DeleteEventRequest,
    DeleteEventResponse,
    DeleteEventTemplateRequest,
    DeleteEventTemplateResponse,
    GetCategoryRequest,
    GetCategoryResponse,
    GetEventRequest,
    GetEventResponse,
    GetEventsInRangeRequest,
    GetEventsInRangeResponse,
    GetEventTemplateRequest,
    GetEventTemplateResponse,
    ListCategoriesRequest,
    ListCategoriesResponse,
    ListEventsRequest,
    ListEventsResponse,
    ListEventTemplatesRequest,
    ListEventTemplatesResponse,
    RemoveAttendeesRequest,
    RemoveAttendeesResponse,
    UpdateAttendeeStatusRequest,
    UpdateAttendeeStatusResponse,
    UpdateCategoryRequest,
    UpdateCategoryResponse,
    UpdateEventRequest,
    UpdateEventResponse,
    UpdateEventTemplateRequest,
    UpdateEventTemplateResponse,
)

from uniffy.core.auth.permissions import resolve_effective_policy
from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.converters.common_proto import (
    access_mode_from_proto,
    content_role_from_proto,
)
from uniffy.core.converters.proto import timestamp_to_datetime
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.calendar.template import EventTemplate
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import ContentType, RecurrencePattern
from uniffy.db import open_session
from uniffy.domains.auth.context import get_user_id_from_context
from uniffy.domains.calendar import queries
from uniffy.domains.calendar.converters import (
    attendee_role_from_proto,
    attendee_status_from_proto,
    category_to_proto,
    event_to_proto,
    recurrence_config_from_proto,
    recurrence_edit_scope_from_proto,
    recurrence_from_proto,
    template_to_proto,
)
from uniffy.domains.calendar.operations import (
    CalendarEventOperations,
    CategoryOperations,
    EventTemplateOperations,
)
from uniffy.domains.tags import TagOperations

logger = logger.bind(component="calendar.handlers")


def _parse_uuid(value: str, field: str) -> UUID:
    """Parse a UUID string or raise ``INVALID_ARGUMENT``."""
    try:
        return UUID(value)
    except ValueError as exc:
        raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid {field}: {exc}") from exc


def _parse_tag_id_list(values) -> list[UUID]:
    """Parse a list of tag id strings, raising ``INVALID_ARGUMENT`` on any miss."""
    parsed: list[UUID] = []
    for value in values:
        try:
            parsed.append(UUID(value))
        except ValueError as exc:
            raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid tag_id: {exc}") from exc
    return parsed


def _occurrence_master_id(event_id) -> UUID:
    """Strip ``__occurrence__{date}`` from a synthetic recurring instance id."""
    raw = str(event_id)
    if "__occurrence__" in raw:
        return UUID(raw.split("__occurrence__")[0])
    return UUID(raw) if not isinstance(event_id, UUID) else event_id


async def _hydrate_event_tags(
    session: AsyncSession,
    organization_id: UUID,
    event_ids: list[UUID],
) -> dict[str, list]:
    """Bulk-fetch unified tags for a batch of events.

    Recurring instances inherit from the master URN, so callers should
    pass the master id (not the synthetic ``__occurrence__`` id) for
    each event in the batch. The dict is keyed by master URN so virtual
    occurrences resolve through the same lookup.
    """
    if not event_ids:
        return {}
    tag_ops = TagOperations(session)
    urns = [build_content_urn(ContentType.CALENDAR_EVENT, eid) for eid in event_ids]
    return await tag_ops.get_for_urns(
        organization_id=organization_id,
        content_urns=urns,
    )


async def _resolve_template_effective_policy(
    session: AsyncSession,
    organization_id: UUID,
    template: EventTemplate,
    checker: PermissionChecker | None = None,
):
    """Return the template's effective ``(access_mode, baseline_role)`` for proto emission."""
    permission_checker = checker or PermissionChecker(session)
    default_mode, default_baseline = await permission_checker.get_org_defaults(
        organization_id, ContentType.CALENDAR_EVENT,
    )
    return resolve_effective_policy(
        template.access_mode, template.baseline_role, default_mode, default_baseline,
    )


def _map_domain_error(operation: str, exc: Exception) -> ConnectError:
    """Translate a domain exception into the matching ``ConnectError``."""
    if isinstance(exc, NotFoundError):
        return ConnectError(Code.NOT_FOUND, str(exc) or "Not found")
    if isinstance(exc, ValidationError):
        return ConnectError(Code.INVALID_ARGUMENT, str(exc))
    if isinstance(exc, PermissionDeniedError):
        return ConnectError(Code.PERMISSION_DENIED, str(exc) or "Access denied")
    logger.exception(f"Error in {operation}: {exc}")
    return ConnectError(Code.INTERNAL, "Internal server error")


class CalendarHandlers:
    """RPC handlers for ``cal.v1.CalendarService``."""

    @staticmethod
    async def _get_event_room_info(session: AsyncSession, event_id: UUID) -> dict:
        """Fetch room booking info for an event as event_to_proto kwargs."""
        from uniffy.domains.rooms.operations import BookingOperations

        booking_ops = BookingOperations(session)
        booking = await booking_ops.get_booking_for_event(event_id)
        if not booking:
            return {}

        from sqlalchemy import select

        from uniffy.core.models.rooms.room import Room

        result = await session.execute(select(Room).where(Room.id == booking.room_id))
        room = result.scalar_one_or_none()
        return {
            "room_id": str(booking.room_id),
            "room_name": room.name if room else "",
            "room_location": room.location if room else "",
            "room_capacity": room.capacity if room else 0,
            "room_amenities": list(room.amenities) if room and room.amenities else [],
        }

    # Event operations

    async def create_event(
        self,
        request: CreateEventRequest,
        ctx: RequestContext,
    ) -> CreateEventResponse:
        """Create a new calendar event."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")

        category_id = None
        if request.HasField("category_id"):
            category_id = _parse_uuid(request.category_id, "category_id")

        recurrence_config = None
        recurrence_pattern = RecurrencePattern.NONE
        if request.HasField("recurrence"):
            recurrence_config = recurrence_config_from_proto(request.recurrence)
            recurrence_pattern = recurrence_from_proto(request.recurrence.pattern)

        attendee_ids = None
        if request.attendee_ids:
            attendee_ids = [_parse_uuid(aid, "attendee_id") for aid in request.attendee_ids]

        linked_resources = None
        if request.linked_resource_urns:
            linked_resources = [
                {"id": urn, "type": "NOTE", "name": ""} for urn in request.linked_resource_urns
            ]

        room_id = None
        if request.HasField("room_id") and request.room_id:
            room_id = _parse_uuid(request.room_id, "room_id")

        channel_id = None
        if request.HasField("channel_id") and request.channel_id:
            channel_id = _parse_uuid(request.channel_id, "channel_id")

        tag_ids = _parse_tag_id_list(request.tag_ids) if request.tag_ids else None

        try:
            async with open_session() as session:
                ops = CalendarEventOperations(session)

                calendar_id = None
                if request.calendar_id:
                    with contextlib.suppress(ValueError):
                        calendar_id = UUID(request.calendar_id)

                if not calendar_id:
                    default_calendar = await queries.ensure_default_calendar(
                        session, organization_id, user_id
                    )
                    calendar_id = default_calendar.id

                event = await ops.create(
                    user_id=user_id,
                    organization_id=organization_id,
                    title=request.title,
                    start_time=timestamp_to_datetime(request.start_time),
                    end_time=timestamp_to_datetime(request.end_time),
                    calendar_id=calendar_id,
                    description=request.description if request.HasField("description") else "",
                    is_all_day=request.is_all_day,
                    timezone=request.timezone if request.HasField("timezone") else "UTC",
                    location=request.location if request.HasField("location") else "",
                    meeting_url=request.meeting_url if request.HasField("meeting_url") else None,
                    category_id=category_id,
                    attendee_ids=attendee_ids,
                    recurrence_pattern=recurrence_pattern,
                    recurrence_config=recurrence_config,
                    is_focus_time=request.is_focus_time,
                    tag_ids=tag_ids,
                    linked_resources=linked_resources,
                    reminders=list(request.reminders) if request.reminders else None,
                    room_id=room_id,
                    channel_id=channel_id,
                    channel_auto_created=request.channel_auto_created,
                )

                attendees = await queries.get_event_attendees(session, event.id)
                room_info = await self._get_event_room_info(session, event.id)
                tags_by_urn = await _hydrate_event_tags(
                    session, organization_id, [event.id]
                )
                return CreateEventResponse(
                    event=event_to_proto(
                        event,
                        attendees,
                        tags=tags_by_urn.get(
                            build_content_urn(ContentType.CALENDAR_EVENT, event.id),
                            [],
                        ),
                        **room_info,
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("create_event", exc) from exc

    async def get_event(
        self,
        request: GetEventRequest,
        ctx: RequestContext,
    ) -> GetEventResponse:
        """Get a single event (requires view access)."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        event_id = _parse_uuid(request.event_id, "event_id")

        try:
            async with open_session() as session:
                ops = CalendarEventOperations(session)
                event, attendees = await ops.get_event_with_attendees(
                    user_id, organization_id, event_id
                )
                room_info = await self._get_event_room_info(session, event_id)
                tags_by_urn = await _hydrate_event_tags(
                    session, organization_id, [event.id]
                )
                return GetEventResponse(
                    event=event_to_proto(
                        event,
                        attendees,
                        tags=tags_by_urn.get(
                            build_content_urn(ContentType.CALENDAR_EVENT, event.id),
                            [],
                        ),
                        **room_info,
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("get_event", exc) from exc

    async def update_event(
        self,
        request: UpdateEventRequest,
        ctx: RequestContext,
    ) -> UpdateEventResponse:
        """Update event metadata."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")

        try:
            event_id = UUID(request.event_id.split("__occurrence__")[0])
        except ValueError as exc:
            raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid event_id: {exc}") from exc

        kwargs: dict = {}
        if request.HasField("title"):
            kwargs["title"] = request.title
        if request.HasField("description"):
            kwargs["description"] = request.description
        if request.HasField("start_time"):
            kwargs["start_time"] = timestamp_to_datetime(request.start_time)
        if request.HasField("end_time"):
            kwargs["end_time"] = timestamp_to_datetime(request.end_time)
        if request.HasField("is_all_day"):
            kwargs["is_all_day"] = request.is_all_day
        if request.HasField("timezone"):
            kwargs["timezone"] = request.timezone
        if request.HasField("location"):
            kwargs["location"] = request.location
        if request.HasField("meeting_url"):
            kwargs["meeting_url"] = request.meeting_url
        if request.HasField("calendar_id"):
            kwargs["calendar_id"] = _parse_uuid(request.calendar_id, "calendar_id")
        if request.HasField("category_id"):
            kwargs["category_id"] = (
                _parse_uuid(request.category_id, "category_id") if request.category_id else None
            )
        if request.HasField("recurrence"):
            kwargs["recurrence_config"] = recurrence_config_from_proto(request.recurrence)
        if request.HasField("is_focus_time"):
            kwargs["is_focus_time"] = request.is_focus_time
        if request.HasField("tag_ids"):
            kwargs["tag_ids"] = _parse_tag_id_list(request.tag_ids.ids)
        if request.linked_resource_urns:
            kwargs["linked_resources"] = [
                {"id": urn, "type": "NOTE", "name": ""} for urn in request.linked_resource_urns
            ]
        if request.attendee_ids:
            kwargs["attendee_ids"] = [
                _parse_uuid(aid, "attendee_id") for aid in request.attendee_ids
            ]
        if request.reminders:
            kwargs["reminders"] = list(request.reminders)

        if request.HasField("recurrence_edit_scope"):
            kwargs["recurrence_edit_scope"] = recurrence_edit_scope_from_proto(
                request.recurrence_edit_scope
            )
        if request.HasField("occurrence_date"):
            try:
                kwargs["occurrence_date"] = date_type.fromisoformat(request.occurrence_date)
            except ValueError as exc:
                raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid occurrence_date: {exc}") from exc

        if request.HasField("room_id"):
            kwargs["room_id"] = request.room_id
        if request.HasField("channel_id"):
            kwargs["channel_id"] = request.channel_id
        if request.HasField("channel_auto_created"):
            kwargs["channel_auto_created"] = request.channel_auto_created

        try:
            async with open_session() as session:
                ops = CalendarEventOperations(session)
                event = await ops.update(
                    user_id=user_id,
                    organization_id=organization_id,
                    event_id=event_id,
                    **kwargs,
                )
                attendees = await queries.get_event_attendees(session, event.id)
                room_info = await self._get_event_room_info(session, event.id)
                tags_by_urn = await _hydrate_event_tags(
                    session, organization_id, [event.id]
                )
                return UpdateEventResponse(
                    event=event_to_proto(
                        event,
                        attendees,
                        tags=tags_by_urn.get(
                            build_content_urn(ContentType.CALENDAR_EVENT, event.id),
                            [],
                        ),
                        **room_info,
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("update_event", exc) from exc

    async def delete_event(
        self,
        request: DeleteEventRequest,
        ctx: RequestContext,
    ) -> DeleteEventResponse:
        """Delete an event (soft or permanent)."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")

        try:
            event_id = UUID(request.event_id.split("__occurrence__")[0])
        except ValueError as exc:
            raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid event_id: {exc}") from exc

        edit_scope = None
        occ_date = None
        if request.HasField("recurrence_edit_scope"):
            edit_scope = recurrence_edit_scope_from_proto(request.recurrence_edit_scope)
        if request.HasField("occurrence_date"):
            try:
                occ_date = date_type.fromisoformat(request.occurrence_date)
            except ValueError as exc:
                raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid occurrence_date: {exc}") from exc

        try:
            async with open_session() as session:
                ops = CalendarEventOperations(session)
                await ops.delete(
                    user_id=user_id,
                    organization_id=organization_id,
                    event_id=event_id,
                    permanent=request.permanent,
                    recurrence_edit_scope=edit_scope,
                    occurrence_date=occ_date,
                )
                message = "Event permanently deleted" if request.permanent else "Event deleted"
                return DeleteEventResponse(success=True, message=message)
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("delete_event", exc) from exc

    async def list_events(
        self,
        request: ListEventsRequest,
        ctx: RequestContext,
    ) -> ListEventsResponse:
        """List events with filters and pagination."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")

        calendar_id = None
        if request.HasField("calendar_id"):
            calendar_id = _parse_uuid(request.calendar_id, "calendar_id")

        category_id = None
        if request.HasField("category_id"):
            category_id = _parse_uuid(request.category_id, "category_id")

        start_date = None
        if request.HasField("start_date"):
            start_date = timestamp_to_datetime(request.start_date)

        end_date = None
        if request.HasField("end_date"):
            end_date = timestamp_to_datetime(request.end_date)

        tag_ids = _parse_tag_id_list(request.tag_ids) if request.tag_ids else None

        try:
            async with open_session() as session:
                ops = CalendarEventOperations(session)
                events, total = await ops.list_events(
                    user_id=user_id,
                    organization_id=organization_id,
                    calendar_id=calendar_id,
                    category_id=category_id,
                    start_date=start_date,
                    end_date=end_date,
                    include_deleted=request.include_deleted,
                    tag_ids=tag_ids,
                    page=max(1, request.page or 1),
                    page_size=min(100, max(1, request.page_size or 50)),
                    sort_by=request.sort_by or "start_time",
                    sort_order=request.sort_order or "asc",
                )

                page_size = request.page_size or 50
                total_pages = (total + page_size - 1) // page_size

                tags_by_urn = await _hydrate_event_tags(
                    session, organization_id, [event.id for event in events]
                )

                proto_events = []
                for event in events:
                    attendees = await queries.get_event_attendees(session, event.id)
                    room_info = await self._get_event_room_info(session, event.id)
                    proto_events.append(
                        event_to_proto(
                            event,
                            attendees,
                            tags=tags_by_urn.get(
                                build_content_urn(ContentType.CALENDAR_EVENT, event.id),
                                [],
                            ),
                            **room_info,
                        )
                    )

                return ListEventsResponse(
                    events=proto_events,
                    total_count=total,
                    page=request.page or 1,
                    page_size=page_size,
                    total_pages=total_pages,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("list_events", exc) from exc

    async def get_events_in_range(
        self,
        request: GetEventsInRangeRequest,
        ctx: RequestContext,
    ) -> GetEventsInRangeResponse:
        """Fetch events in a date range (optimized for calendar views)."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")

        calendar_ids = None
        if request.calendar_ids:
            calendar_ids = [_parse_uuid(cid, "calendar_id") for cid in request.calendar_ids]

        category_ids = None
        if request.category_ids:
            category_ids = [_parse_uuid(cid, "category_id") for cid in request.category_ids]

        try:
            async with open_session() as session:
                ops = CalendarEventOperations(session)
                events = await ops.get_events_in_range(
                    user_id=user_id,
                    organization_id=organization_id,
                    start_date=timestamp_to_datetime(request.start_date),
                    end_date=timestamp_to_datetime(request.end_date),
                    calendar_ids=calendar_ids,
                    category_ids=category_ids,
                )

                attendees_cache: dict[str, list] = {}
                room_info_cache: dict[str, dict] = {}
                master_ids: set[UUID] = set()
                for event in events:
                    master_ids.add(_occurrence_master_id(event.id))
                tags_by_urn = await _hydrate_event_tags(
                    session, organization_id, list(master_ids)
                )

                proto_events = []
                for event in events:
                    real_id = _occurrence_master_id(event.id)
                    real_id_str = str(real_id)
                    if real_id_str not in attendees_cache:
                        attendees_cache[real_id_str] = await queries.get_event_attendees(
                            session,
                            real_id,
                        )
                    if real_id_str not in room_info_cache:
                        room_info_cache[real_id_str] = await self._get_event_room_info(
                            session,
                            real_id,
                        )
                    proto_events.append(
                        event_to_proto(
                            event,
                            attendees_cache[real_id_str],
                            tags=tags_by_urn.get(
                                build_content_urn(ContentType.CALENDAR_EVENT, real_id),
                                [],
                            ),
                            **room_info_cache[real_id_str],
                        )
                    )

                return GetEventsInRangeResponse(events=proto_events)
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("get_events_in_range", exc) from exc

    # Calendar operations (deprecated)

    async def create_calendar(self, request, ctx: RequestContext):
        """Deprecated. Calendars are auto-created per user."""
        raise ConnectError(Code.UNIMPLEMENTED, "Calendar management is deprecated")

    async def get_calendar(self, request, ctx: RequestContext):
        """Deprecated. Calendars are auto-created per user."""
        raise ConnectError(Code.UNIMPLEMENTED, "Calendar management is deprecated")

    async def update_calendar(self, request, ctx: RequestContext):
        """Deprecated. Calendars are auto-created per user."""
        raise ConnectError(Code.UNIMPLEMENTED, "Calendar management is deprecated")

    async def delete_calendar(self, request, ctx: RequestContext):
        """Deprecated. Calendars are auto-created per user."""
        raise ConnectError(Code.UNIMPLEMENTED, "Calendar management is deprecated")

    async def list_calendars(self, request, ctx: RequestContext):
        """Deprecated. Calendars are auto-created per user."""
        raise ConnectError(Code.UNIMPLEMENTED, "Calendar management is deprecated")

    # Category operations

    async def create_category(
        self,
        request: CreateCategoryRequest,
        ctx: RequestContext,
    ) -> CreateCategoryResponse:
        """Create a new category."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")

        try:
            async with open_session() as session:
                ops = CategoryOperations(session)
                category = await ops.create(
                    user_id=user_id,
                    organization_id=organization_id,
                    name=request.name,
                    color=request.color,
                    icon=request.icon if request.HasField("icon") else None,
                )
                return CreateCategoryResponse(category=category_to_proto(category))
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("create_category", exc) from exc

    async def get_category(
        self,
        request: GetCategoryRequest,
        ctx: RequestContext,
    ) -> GetCategoryResponse:
        """Get a category by ID."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        category_id = _parse_uuid(request.category_id, "category_id")

        try:
            async with open_session() as session:
                ops = CategoryOperations(session)
                category = await ops.get_by_id(user_id, category_id, organization_id)
                return GetCategoryResponse(category=category_to_proto(category))
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("get_category", exc) from exc

    async def update_category(
        self,
        request: UpdateCategoryRequest,
        ctx: RequestContext,
    ) -> UpdateCategoryResponse:
        """Update a category."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        category_id = _parse_uuid(request.category_id, "category_id")

        try:
            async with open_session() as session:
                ops = CategoryOperations(session)
                category = await ops.update(
                    user_id=user_id,
                    category_id=category_id,
                    organization_id=organization_id,
                    name=request.name if request.HasField("name") else None,
                    color=request.color if request.HasField("color") else None,
                    icon=request.icon if request.HasField("icon") else None,
                    sort_order=request.sort_order if request.HasField("sort_order") else None,
                )
                return UpdateCategoryResponse(category=category_to_proto(category))
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("update_category", exc) from exc

    async def delete_category(
        self,
        request: DeleteCategoryRequest,
        ctx: RequestContext,
    ) -> DeleteCategoryResponse:
        """Delete a category."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        category_id = _parse_uuid(request.category_id, "category_id")

        try:
            async with open_session() as session:
                ops = CategoryOperations(session)
                await ops.delete(user_id, category_id, organization_id)
                return DeleteCategoryResponse(success=True, message="Category deleted")
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("delete_category", exc) from exc

    async def list_categories(
        self,
        request: ListCategoriesRequest,
        ctx: RequestContext,
    ) -> ListCategoriesResponse:
        """List categories for an organization."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")

        try:
            async with open_session() as session:
                ops = CategoryOperations(session)
                await ops.ensure_defaults(user_id, organization_id)
                categories = await ops.list_categories(user_id, organization_id)
                return ListCategoriesResponse(categories=[category_to_proto(c) for c in categories])
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("list_categories", exc) from exc

    # Attendee operations

    async def update_attendee_status(
        self,
        request: UpdateAttendeeStatusRequest,
        ctx: RequestContext,
    ) -> UpdateAttendeeStatusResponse:
        """Update current user's attendee status for an event."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        event_id = _parse_uuid(request.event_id, "event_id")

        try:
            async with open_session() as session:
                ops = CalendarEventOperations(session)
                status = attendee_status_from_proto(request.status)
                await ops.update_attendee_status(
                    user_id=user_id,
                    organization_id=organization_id,
                    event_id=event_id,
                    status=status,
                )
                return UpdateAttendeeStatusResponse(success=True, message="Status updated")
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("update_attendee_status", exc) from exc

    async def add_attendees(
        self,
        request: AddAttendeesRequest,
        ctx: RequestContext,
    ) -> AddAttendeesResponse:
        """Add attendees to an event."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        event_id = _parse_uuid(request.event_id, "event_id")

        try:
            async with open_session() as session:
                ops = CalendarEventOperations(session)
                role = attendee_role_from_proto(request.role)
                attendee_ids = [_parse_uuid(uid, "user_id") for uid in request.user_ids]

                event = await ops.add_attendees(
                    user_id=user_id,
                    organization_id=organization_id,
                    event_id=event_id,
                    attendee_ids=attendee_ids,
                    role=role,
                )
                attendees = await queries.get_event_attendees(session, event.id)
                tags_by_urn = await _hydrate_event_tags(
                    session, organization_id, [event.id]
                )
                return AddAttendeesResponse(
                    event=event_to_proto(
                        event,
                        attendees,
                        tags=tags_by_urn.get(
                            build_content_urn(ContentType.CALENDAR_EVENT, event.id),
                            [],
                        ),
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("add_attendees", exc) from exc

    async def remove_attendees(
        self,
        request: RemoveAttendeesRequest,
        ctx: RequestContext,
    ) -> RemoveAttendeesResponse:
        """Remove attendees from an event."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        event_id = _parse_uuid(request.event_id, "event_id")

        try:
            async with open_session() as session:
                ops = CalendarEventOperations(session)
                attendee_ids = [_parse_uuid(uid, "user_id") for uid in request.user_ids]

                event = await ops.remove_attendees(
                    user_id=user_id,
                    organization_id=organization_id,
                    event_id=event_id,
                    attendee_ids=attendee_ids,
                )
                attendees = await queries.get_event_attendees(session, event.id)
                tags_by_urn = await _hydrate_event_tags(
                    session, organization_id, [event.id]
                )
                return RemoveAttendeesResponse(
                    event=event_to_proto(
                        event,
                        attendees,
                        tags=tags_by_urn.get(
                            build_content_urn(ContentType.CALENDAR_EVENT, event.id),
                            [],
                        ),
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("remove_attendees", exc) from exc

    # Template operations

    async def create_event_template(
        self,
        request: CreateEventTemplateRequest,
        ctx: RequestContext,
    ) -> CreateEventTemplateResponse:
        """Create an event template."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")

        access_mode = access_mode_from_proto(request.access_mode) if request.access_mode else None
        baseline_role = (
            content_role_from_proto(request.baseline_role) if request.baseline_role else None
        )

        category_id = None
        if request.category_id:
            with contextlib.suppress(ValueError):
                category_id = UUID(request.category_id)

        try:
            async with open_session() as session:
                ops = EventTemplateOperations(session)
                template = await ops.create(
                    user_id=user_id,
                    organization_id=organization_id,
                    title=request.title,
                    description=request.description,
                    duration_minutes=request.duration_minutes,
                    location=request.location,
                    meeting_url=request.meeting_url if request.meeting_url else None,
                    category_id=category_id,
                    tags=list(request.tags),
                    access_mode=access_mode,
                    baseline_role=baseline_role,
                )
                eff_mode, eff_baseline = await _resolve_template_effective_policy(
                    session, organization_id, template,
                )
                return CreateEventTemplateResponse(
                    template=template_to_proto(
                        template,
                        effective_access_mode=eff_mode,
                        effective_baseline_role=eff_baseline,
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("create_event_template", exc) from exc

    async def get_event_template(
        self,
        request: GetEventTemplateRequest,
        ctx: RequestContext,
    ) -> GetEventTemplateResponse:
        """Get an event template by ID."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        template_id = _parse_uuid(request.template_id, "template_id")

        try:
            async with open_session() as session:
                ops = EventTemplateOperations(session)
                template = await ops.get_by_id(template_id, organization_id, user_id)
                eff_mode, eff_baseline = await _resolve_template_effective_policy(
                    session, organization_id, template,
                )
                return GetEventTemplateResponse(
                    template=template_to_proto(
                        template,
                        effective_access_mode=eff_mode,
                        effective_baseline_role=eff_baseline,
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("get_event_template", exc) from exc

    async def update_event_template(
        self,
        request: UpdateEventTemplateRequest,
        ctx: RequestContext,
    ) -> UpdateEventTemplateResponse:
        """Update an event template."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        template_id = _parse_uuid(request.template_id, "template_id")

        update_data: dict = {}
        if request.HasField("title"):
            update_data["title"] = request.title
        if request.HasField("description"):
            update_data["description"] = request.description
        if request.HasField("duration_minutes"):
            update_data["duration_minutes"] = request.duration_minutes
        if request.HasField("location"):
            update_data["location"] = request.location
        if request.HasField("meeting_url"):
            update_data["meeting_url"] = request.meeting_url
        if request.HasField("category_id"):
            try:
                update_data["category_id"] = UUID(request.category_id)
            except ValueError:
                update_data["category_id"] = None
        if request.tags:
            update_data["tags"] = list(request.tags)

        try:
            async with open_session() as session:
                ops = EventTemplateOperations(session)
                template = await ops.update(
                    template_id=template_id,
                    organization_id=organization_id,
                    user_id=user_id,
                    **update_data,
                )
                eff_mode, eff_baseline = await _resolve_template_effective_policy(
                    session, organization_id, template,
                )
                return UpdateEventTemplateResponse(
                    template=template_to_proto(
                        template,
                        effective_access_mode=eff_mode,
                        effective_baseline_role=eff_baseline,
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("update_event_template", exc) from exc

    async def delete_event_template(
        self,
        request: DeleteEventTemplateRequest,
        ctx: RequestContext,
    ) -> DeleteEventTemplateResponse:
        """Delete an event template."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        template_id = _parse_uuid(request.template_id, "template_id")

        try:
            async with open_session() as session:
                ops = EventTemplateOperations(session)
                await ops.delete(template_id, organization_id, user_id)
                return DeleteEventTemplateResponse(success=True, message="Template deleted")
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("delete_event_template", exc) from exc

    async def list_event_templates(
        self,
        request: ListEventTemplatesRequest,
        ctx: RequestContext,
    ) -> ListEventTemplatesResponse:
        """List event templates for an organization."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")

        try:
            async with open_session() as session:
                ops = EventTemplateOperations(session)
                templates = await ops.list(organization_id, user_id)
                checker = PermissionChecker(session)
                default_mode, default_baseline = await checker.get_org_defaults(
                    organization_id, ContentType.CALENDAR_EVENT,
                )
                proto_templates = []
                for template in templates:
                    eff_mode, eff_baseline = resolve_effective_policy(
                        template.access_mode,
                        template.baseline_role,
                        default_mode,
                        default_baseline,
                    )
                    proto_templates.append(
                        template_to_proto(
                            template,
                            effective_access_mode=eff_mode,
                            effective_baseline_role=eff_baseline,
                        )
                    )
                return ListEventTemplatesResponse(templates=proto_templates)
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("list_event_templates", exc) from exc
