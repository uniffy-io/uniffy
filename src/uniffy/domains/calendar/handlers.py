"""Calendar RPC handlers - thin layer delegating to operations."""

import contextlib
from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger

from uniffy.core.converters.proto import timestamp_to_datetime
from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models.shared import RecurrencePattern, VisibilityScope
from uniffy.db import get_async_session
from uniffy.domains.auth.context import get_user_id_from_context
from uniffy.domains.calendar import queries
from uniffy.domains.calendar.converters import (
    attendee_role_from_proto,
    attendee_status_from_proto,
    calendar_to_proto,
    calendar_type_from_proto,
    category_to_proto,
    event_to_proto,
    recurrence_config_from_proto,
    recurrence_from_proto,
    template_to_proto,
    visibility_from_proto,
)
from uniffy.domains.calendar.operations import (
    CalendarEventOperations,
    CalendarOperations,
    CategoryOperations,
    EventTemplateOperations,
)
from uniffy.gen.cal.v1.calendar_pb2 import (
    AddAttendeesRequest,
    CalendarResponse,
    CategoryResponse,
    CreateCalendarRequest,
    CreateCategoryRequest,
    CreateEventRequest,
    CreateEventTemplateRequest,
    DeleteCalendarRequest,
    DeleteCalendarResponse,
    DeleteCategoryRequest,
    DeleteCategoryResponse,
    DeleteEventRequest,
    DeleteEventResponse,
    DeleteEventTemplateRequest,
    DeleteEventTemplateResponse,
    EventResponse,
    EventTemplateResponse,
    GetCalendarRequest,
    GetCategoryRequest,
    GetEventRequest,
    GetEventsInRangeRequest,
    GetEventsInRangeResponse,
    GetEventTemplateRequest,
    ListCalendarsRequest,
    ListCalendarsResponse,
    ListCategoriesRequest,
    ListCategoriesResponse,
    ListEventsRequest,
    ListEventsResponse,
    ListEventTemplatesRequest,
    ListEventTemplatesResponse,
    RemoveAttendeesRequest,
    UpdateAttendeeStatusRequest,
    UpdateAttendeeStatusResponse,
    UpdateCalendarRequest,
    UpdateCategoryRequest,
    UpdateEventRequest,
    UpdateEventTemplateRequest,
)


class CalendarHandlers:
    """Calendar RPC handlers."""

    # ─────────────────────────────────────────────────────────────
    # Event Operations
    # ─────────────────────────────────────────────────────────────

    async def create_event(
        self,
        request: CreateEventRequest,
        ctx: RequestContext,
    ) -> EventResponse:
        """Create a new calendar event."""
        try:
            organization_id = UUID(request.organization_id)
            calendar_id = UUID(request.calendar_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = CalendarEventOperations(session)

                # Parse optional fields
                visibility = VisibilityScope.PRIVATE
                if request.HasField("visibility"):
                    visibility = visibility_from_proto(request.visibility)

                category_id = None
                if request.HasField("category_id"):
                    try:
                        category_id = UUID(request.category_id)
                    except ValueError:
                        raise ConnectError(Code.INVALID_ARGUMENT, "Invalid category_id")

                recurrence_config = None
                recurrence_pattern = RecurrencePattern.NONE
                if request.HasField("recurrence"):
                    recurrence_config = recurrence_config_from_proto(request.recurrence)
                    recurrence_pattern = recurrence_from_proto(request.recurrence.pattern)

                attendee_ids = None
                if request.attendee_ids:
                    attendee_ids = [UUID(aid) for aid in request.attendee_ids]

                linked_resources = None
                if request.linked_resource_urns:
                    linked_resources = [
                        {"id": urn, "type": "NOTE", "name": ""}
                        for urn in request.linked_resource_urns
                    ]

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
                    tags=list(request.tags) if request.tags else None,
                    linked_resources=linked_resources,
                    visibility=visibility,
                )

                # Fetch attendees for response
                attendees = await queries.get_event_attendees(session, event.id)
                return EventResponse(event=event_to_proto(event, attendees))

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error creating event: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {str(e)}")

    async def get_event(
        self,
        request: GetEventRequest,
        ctx: RequestContext,
    ) -> EventResponse:
        """Get an event by ID."""
        try:
            event_id = UUID(request.event_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = CalendarEventOperations(session)
                event, attendees = await ops.get_event_with_attendees(
                    user_id, organization_id, event_id
                )
                return EventResponse(event=event_to_proto(event, attendees))

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Event not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error getting event: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_event(
        self,
        request: UpdateEventRequest,
        ctx: RequestContext,
    ) -> EventResponse:
        """Update an existing event."""
        try:
            event_id = UUID(request.event_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = CalendarEventOperations(session)

                # Build update kwargs
                kwargs = {}

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
                    kwargs["calendar_id"] = UUID(request.calendar_id)
                if request.HasField("category_id"):
                    cat_id = UUID(request.category_id) if request.category_id else None
                    kwargs["category_id"] = cat_id
                if request.HasField("recurrence"):
                    kwargs["recurrence_config"] = recurrence_config_from_proto(request.recurrence)
                if request.HasField("is_focus_time"):
                    kwargs["is_focus_time"] = request.is_focus_time
                if request.tags:
                    kwargs["tags"] = list(request.tags)
                if request.linked_resource_urns:
                    kwargs["linked_resources"] = [
                        {"id": urn, "type": "NOTE", "name": ""}
                        for urn in request.linked_resource_urns
                    ]
                if request.HasField("visibility"):
                    kwargs["visibility"] = visibility_from_proto(request.visibility)
                if request.attendee_ids:
                    kwargs["attendee_ids"] = [UUID(id) for id in request.attendee_ids]

                event = await ops.update(
                    user_id=user_id,
                    organization_id=organization_id,
                    event_id=event_id,
                    **kwargs,
                )

                # Fetch attendees for response
                attendees = await queries.get_event_attendees(session, event.id)
                return EventResponse(event=event_to_proto(event, attendees))

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Event not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error updating event: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def delete_event(
        self,
        request: DeleteEventRequest,
        ctx: RequestContext,
    ) -> DeleteEventResponse:
        """Delete an event (soft or permanent)."""
        try:
            event_id = UUID(request.event_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = CalendarEventOperations(session)
                await ops.delete(
                    user_id=user_id,
                    organization_id=organization_id,
                    event_id=event_id,
                    permanent=request.permanent,
                )

                message = "Event permanently deleted" if request.permanent else "Event deleted"
                return DeleteEventResponse(success=True, message=message)

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Event not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error deleting event: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_events(
        self,
        request: ListEventsRequest,
        ctx: RequestContext,
    ) -> ListEventsResponse:
        """List events with filters and pagination."""
        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = CalendarEventOperations(session)

                # Parse filters
                calendar_id = None
                if request.HasField("calendar_id"):
                    calendar_id = UUID(request.calendar_id)

                category_id = None
                if request.HasField("category_id"):
                    category_id = UUID(request.category_id)

                start_date = None
                if request.HasField("start_date"):
                    start_date = timestamp_to_datetime(request.start_date)

                end_date = None
                if request.HasField("end_date"):
                    end_date = timestamp_to_datetime(request.end_date)

                events, total = await ops.list_events(
                    user_id=user_id,
                    organization_id=organization_id,
                    calendar_id=calendar_id,
                    category_id=category_id,
                    start_date=start_date,
                    end_date=end_date,
                    include_deleted=request.include_deleted,
                    tags=list(request.tags) if request.tags else None,
                    page=max(1, request.page or 1),
                    page_size=min(100, max(1, request.page_size or 50)),
                    sort_by=request.sort_by or "start_time",
                    sort_order=request.sort_order or "asc",
                )

                page_size = request.page_size or 50
                total_pages = (total + page_size - 1) // page_size

                # Fetch attendees for each event
                proto_events = []
                for event in events:
                    attendees = await queries.get_event_attendees(session, event.id)
                    proto_events.append(event_to_proto(event, attendees))

                return ListEventsResponse(
                    events=proto_events,
                    total_count=total,
                    page=request.page or 1,
                    page_size=page_size,
                    total_pages=total_pages,
                )

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error listing events: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {str(e)}")

    async def get_events_in_range(
        self,
        request: GetEventsInRangeRequest,
        ctx: RequestContext,
    ) -> GetEventsInRangeResponse:
        """Get events in a date range (optimized for calendar views)."""
        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = CalendarEventOperations(session)

                calendar_ids = None
                if request.calendar_ids:
                    calendar_ids = [UUID(cid) for cid in request.calendar_ids]

                category_ids = None
                if request.category_ids:
                    category_ids = [UUID(cid) for cid in request.category_ids]

                events = await ops.get_events_in_range(
                    user_id=user_id,
                    organization_id=organization_id,
                    start_date=timestamp_to_datetime(request.start_date),
                    end_date=timestamp_to_datetime(request.end_date),
                    calendar_ids=calendar_ids,
                    category_ids=category_ids,
                )

                # Fetch attendees for each event
                proto_events = []
                for event in events:
                    attendees = await queries.get_event_attendees(session, event.id)
                    proto_events.append(event_to_proto(event, attendees))

                return GetEventsInRangeResponse(events=proto_events)

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error getting events in range: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {str(e)}")

    # ─────────────────────────────────────────────────────────────
    # Calendar Operations
    # ─────────────────────────────────────────────────────────────

    async def create_calendar(
        self,
        request: CreateCalendarRequest,
        ctx: RequestContext,
    ) -> CalendarResponse:
        """Create a new calendar."""
        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = CalendarOperations(session)

                calendar_type = None
                if request.HasField("type"):
                    calendar_type = calendar_type_from_proto(request.type)

                calendar = await ops.create(
                    user_id=user_id,
                    organization_id=organization_id,
                    name=request.name,
                    color=request.color if request.HasField("color") else "#3b82f6",
                    calendar_type=calendar_type,
                    is_default=request.is_default,
                )

                return CalendarResponse(calendar=calendar_to_proto(calendar))

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error creating calendar: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {str(e)}")

    async def get_calendar(
        self,
        request: GetCalendarRequest,
        ctx: RequestContext,
    ) -> CalendarResponse:
        """Get a calendar by ID."""
        try:
            calendar_id = UUID(request.calendar_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = CalendarOperations(session)
                calendar = await ops.get_by_id(calendar_id, organization_id, user_id)
                return CalendarResponse(calendar=calendar_to_proto(calendar))

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Calendar not found")
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error getting calendar: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_calendar(
        self,
        request: UpdateCalendarRequest,
        ctx: RequestContext,
    ) -> CalendarResponse:
        """Update a calendar."""
        try:
            calendar_id = UUID(request.calendar_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = CalendarOperations(session)

                calendar_type = None
                if request.HasField("type"):
                    calendar_type = calendar_type_from_proto(request.type)

                calendar = await ops.update(
                    calendar_id=calendar_id,
                    organization_id=organization_id,
                    user_id=user_id,
                    name=request.name if request.HasField("name") else None,
                    color=request.color if request.HasField("color") else None,
                    is_visible=request.is_visible if request.HasField("is_visible") else None,
                    is_default=request.is_default if request.HasField("is_default") else None,
                    calendar_type=calendar_type,
                )

                return CalendarResponse(calendar=calendar_to_proto(calendar))

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Calendar not found")
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error updating calendar: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def delete_calendar(
        self,
        request: DeleteCalendarRequest,
        ctx: RequestContext,
    ) -> DeleteCalendarResponse:
        """Delete a calendar."""
        try:
            calendar_id = UUID(request.calendar_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = CalendarOperations(session)
                await ops.delete(calendar_id, organization_id, user_id)
                return DeleteCalendarResponse(success=True, message="Calendar deleted")

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Calendar not found")
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error deleting calendar: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_calendars(
        self,
        request: ListCalendarsRequest,
        ctx: RequestContext,
    ) -> ListCalendarsResponse:
        """List user's calendars."""
        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = CalendarOperations(session)

                # Ensure user has a default calendar
                await ops.ensure_default(organization_id, user_id)

                calendars = await ops.list_calendars(
                    organization_id=organization_id,
                    user_id=user_id,
                    visible_only=request.visible_only,
                )

                return ListCalendarsResponse(calendars=[calendar_to_proto(c) for c in calendars])

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error listing calendars: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {str(e)}")

    # ─────────────────────────────────────────────────────────────
    # Category Operations
    # ─────────────────────────────────────────────────────────────

    async def create_category(
        self,
        request: CreateCategoryRequest,
        ctx: RequestContext,
    ) -> CategoryResponse:
        """Create a new category."""
        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = CategoryOperations(session)
                category = await ops.create(
                    user_id=user_id,
                    organization_id=organization_id,
                    name=request.name,
                    color=request.color,
                    icon=request.icon if request.HasField("icon") else None,
                )

                return CategoryResponse(category=category_to_proto(category))

        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error creating category: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {str(e)}")

    async def get_category(
        self,
        request: GetCategoryRequest,
        ctx: RequestContext,
    ) -> CategoryResponse:
        """Get a category by ID."""
        try:
            category_id = UUID(request.category_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = CategoryOperations(session)
                category = await ops.get_by_id(user_id, category_id, organization_id)
                return CategoryResponse(category=category_to_proto(category))

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Category not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error getting category: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_category(
        self,
        request: UpdateCategoryRequest,
        ctx: RequestContext,
    ) -> CategoryResponse:
        """Update a category."""
        try:
            category_id = UUID(request.category_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
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

                return CategoryResponse(category=category_to_proto(category))

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Category not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error updating category: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def delete_category(
        self,
        request: DeleteCategoryRequest,
        ctx: RequestContext,
    ) -> DeleteCategoryResponse:
        """Delete a category."""
        try:
            category_id = UUID(request.category_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = CategoryOperations(session)
                await ops.delete(user_id, category_id, organization_id)
                return DeleteCategoryResponse(success=True, message="Category deleted")

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Category not found")
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error deleting category: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_categories(
        self,
        request: ListCategoriesRequest,
        ctx: RequestContext,
    ) -> ListCategoriesResponse:
        """List categories for an organization."""
        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = CategoryOperations(session)

                # Ensure default categories exist
                await ops.ensure_defaults(user_id, organization_id)

                categories = await ops.list_categories(user_id, organization_id)

                return ListCategoriesResponse(categories=[category_to_proto(c) for c in categories])

        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error listing categories: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {str(e)}")

    # ─────────────────────────────────────────────────────────────
    # Attendee Operations
    # ─────────────────────────────────────────────────────────────

    async def update_attendee_status(
        self,
        request: UpdateAttendeeStatusRequest,
        ctx: RequestContext,
    ) -> UpdateAttendeeStatusResponse:
        """Update current user's attendee status for an event."""
        try:
            event_id = UUID(request.event_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = CalendarEventOperations(session)
                status = attendee_status_from_proto(request.status)
                await ops.update_attendee_status(
                    user_id=user_id,
                    organization_id=organization_id,
                    event_id=event_id,
                    status=status,
                )

                return UpdateAttendeeStatusResponse(
                    success=True,
                    message="Status updated",
                )

        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error updating attendee status: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def add_attendees(
        self,
        request: AddAttendeesRequest,
        ctx: RequestContext,
    ) -> EventResponse:
        """Add attendees to an event."""
        try:
            event_id = UUID(request.event_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = CalendarEventOperations(session)

                role = attendee_role_from_proto(request.role)
                attendee_ids = [UUID(uid) for uid in request.user_ids]

                event = await ops.add_attendees(
                    user_id=user_id,
                    organization_id=organization_id,
                    event_id=event_id,
                    attendee_ids=attendee_ids,
                    role=role,
                )

                # Fetch attendees for response
                attendees = await queries.get_event_attendees(session, event.id)
                return EventResponse(event=event_to_proto(event, attendees))

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Event not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error adding attendees: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def remove_attendees(
        self,
        request: RemoveAttendeesRequest,
        ctx: RequestContext,
    ) -> EventResponse:
        """Remove attendees from an event."""
        try:
            event_id = UUID(request.event_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = CalendarEventOperations(session)

                attendee_ids = [UUID(uid) for uid in request.user_ids]

                event = await ops.remove_attendees(
                    user_id=user_id,
                    organization_id=organization_id,
                    event_id=event_id,
                    attendee_ids=attendee_ids,
                )

                # Fetch attendees for response
                attendees = await queries.get_event_attendees(session, event.id)
                return EventResponse(event=event_to_proto(event, attendees))

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Event not found")
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error removing attendees: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    # ─────────────────────────────────────────────────────────────
    # Template Operations
    # ─────────────────────────────────────────────────────────────

    async def create_event_template(
        self,
        request: CreateEventTemplateRequest,
        ctx: RequestContext,
    ) -> EventTemplateResponse:
        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = EventTemplateOperations(session)

                category_id = None
                if request.category_id:
                    with contextlib.suppress(ValueError):
                        category_id = UUID(request.category_id)

                visibility = visibility_from_proto(request.visibility)

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
                    visibility=visibility,
                )

                return EventTemplateResponse(template=template_to_proto(template))
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except Exception as e:
            logger.error(f"Error creating template: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_event_template(
        self,
        request: GetEventTemplateRequest,
        ctx: RequestContext,
    ) -> EventTemplateResponse:
        try:
            template_id = UUID(request.template_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = EventTemplateOperations(session)
                template = await ops.get_by_id(template_id, organization_id, user_id)
                return EventTemplateResponse(template=template_to_proto(template))
        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Template not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except Exception as e:
            logger.error(f"Error getting template: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_event_template(
        self,
        request: UpdateEventTemplateRequest,
        ctx: RequestContext,
    ) -> EventTemplateResponse:
        try:
            template_id = UUID(request.template_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        update_data = {}
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
        if request.HasField("visibility"):
            update_data["visibility"] = visibility_from_proto(request.visibility)

        try:
            async for session in get_async_session():
                ops = EventTemplateOperations(session)
                template = await ops.update(
                    template_id=template_id,
                    organization_id=organization_id,
                    user_id=user_id,
                    **update_data,
                )
                return EventTemplateResponse(template=template_to_proto(template))
        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Template not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except Exception as e:
            logger.error(f"Error updating template: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def delete_event_template(
        self,
        request: DeleteEventTemplateRequest,
        ctx: RequestContext,
    ) -> DeleteEventTemplateResponse:
        try:
            template_id = UUID(request.template_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = EventTemplateOperations(session)
                await ops.delete(template_id, organization_id, user_id)
                return DeleteEventTemplateResponse(success=True, message="Template deleted")
        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Template not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except Exception as e:
            logger.error(f"Error deleting template: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_event_templates(
        self,
        request: ListEventTemplatesRequest,
        ctx: RequestContext,
    ) -> ListEventTemplatesResponse:
        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = EventTemplateOperations(session)
                templates = await ops.list(organization_id, user_id)
                return ListEventTemplatesResponse(
                    templates=[template_to_proto(t) for t in templates]
                )
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except Exception as e:
            logger.error(f"Error listing templates: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")
