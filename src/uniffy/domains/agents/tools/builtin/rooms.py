"""Built-in rooms tools for agents."""

from datetime import UTC, datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from uniffy.core.errors import ValidationError
from uniffy.core.types import BookingStatus, RoomType
from uniffy.domains.agents.tools.definitions import ToolContext, ToolDefinition, ToolResult

_ROOM_TYPE_VALUES = tuple(rt.value for rt in RoomType)
_BOOKING_STATUS_VALUES = tuple(bs.value for bs in BookingStatus)


def _parse_datetime(value: str, user_timezone: str | None = None) -> datetime | None:
    """Parse an ISO 8601 datetime string, returning timezone-aware UTC."""
    is_utc_explicit = value.endswith("Z")

    for fmt in ("%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
        try:
            dt = datetime.strptime(value, fmt)  # noqa: DTZ007
            break
        except ValueError:
            continue
    else:
        return None

    if dt.tzinfo is not None:
        return dt.astimezone(UTC)
    if is_utc_explicit or not user_timezone:
        return dt.replace(tzinfo=UTC)
    try:
        local_tz = ZoneInfo(user_timezone)
    except KeyError, ValueError:
        return dt.replace(tzinfo=UTC)
    return dt.replace(tzinfo=local_tz).astimezone(UTC)


def _parse_uuid(value: str, field_name: str) -> tuple[UUID | None, str | None]:
    try:
        return UUID(value), None
    except ValueError:
        return None, f"Invalid {field_name}: {value}"


def _format_room_line(room) -> str:
    urn = f"urn:uniffy:content:ROOM:{room.id}"
    parts = [f"- [[[{room.name}|{urn}]]]"]
    parts.append(f"type={room.room_type.value}")
    parts.append(f"capacity={room.capacity}")
    if room.building:
        parts.append(f"building={room.building}")
    if room.floor:
        parts.append(f"floor={room.floor}")
    if room.location:
        parts.append(f"@ {room.location}")
    if room.amenities:
        parts.append(f"amenities=[{', '.join(room.amenities)}]")
    return " | ".join(parts)


def _format_room_detail(prefix: str, room) -> str:
    urn = f"urn:uniffy:content:ROOM:{room.id}"
    lines = [f"{prefix}: [[[{room.name}|{urn}]]]"]
    meta = [
        f"Type: {room.room_type.value}",
        f"Capacity: {room.capacity}",
        f"Status: {room.status.value}",
    ]
    if room.building:
        meta.append(f"Building: {room.building}")
    if room.floor:
        meta.append(f"Floor: {room.floor}")
    if room.location:
        meta.append(f"Location: {room.location}")
    if room.amenities:
        meta.append(f"Amenities: {', '.join(room.amenities)}")
    lines.append(" | ".join(meta))
    if room.description:
        lines.append(room.description)
    return "\n".join(lines)


def _format_booking_line(booking, room_name: str = "", booker_name: str = "") -> str:
    start = booking.start_time.strftime("%Y-%m-%d %H:%M") if booking.start_time else "?"
    end = booking.end_time.strftime("%Y-%m-%d %H:%M") if booking.end_time else "?"
    label = booking.title or room_name or "Booking"
    parts = [f"- {label} ({start} to {end})"]
    parts.append(f"status={booking.status.value}")
    if room_name:
        parts.append(f"room={room_name}")
    if booker_name:
        parts.append(f"by={booker_name}")
    parts.append(f"id={booking.id}")
    if booking.event_id:
        parts.append(f"event={booking.event_id}")
    return " | ".join(parts)


def _format_booking_detail(prefix: str, booking, room_name: str | None = None) -> str:
    start = booking.start_time.strftime("%Y-%m-%d %H:%M") if booking.start_time else "?"
    end = booking.end_time.strftime("%Y-%m-%d %H:%M") if booking.end_time else "?"
    lines = [f"{prefix}: booking id={booking.id}"]
    meta = [f"{start} to {end}", f"status={booking.status.value}"]
    if room_name:
        meta.append(f"room={room_name}")
    if booking.title:
        meta.append(f"title={booking.title}")
    if booking.event_id:
        meta.append(f"event={booking.event_id}")
    lines.append(" | ".join(meta))
    if booking.notes:
        lines.append(f"Notes: {booking.notes}")
    return "\n".join(lines)


def _parse_room_type(raw: str) -> tuple[RoomType | None, str | None]:
    value = str(raw).upper()
    if value not in _ROOM_TYPE_VALUES:
        return None, (f"Invalid room_type: {raw}. Must be one of: {', '.join(_ROOM_TYPE_VALUES)}")
    return RoomType(value), None


def _parse_booking_status(raw: str) -> tuple[BookingStatus | None, str | None]:
    value = str(raw).upper()
    if value not in _BOOKING_STATUS_VALUES:
        return None, (f"Invalid status: {raw}. Must be one of: {', '.join(_BOOKING_STATUS_VALUES)}")
    return BookingStatus(value), None


async def _execute_list_rooms(ctx: ToolContext, args: dict) -> ToolResult:
    """List rooms available to the user, with optional filters."""
    from uniffy.domains.scheduling.rooms.lifecycle import RoomOperations

    kwargs: dict = {}

    raw_type = args.get("room_type")
    if raw_type:
        room_type, err = _parse_room_type(raw_type)
        if err:
            return ToolResult(success=False, data="", error=err)
        kwargs["room_type"] = room_type

    if "min_capacity" in args:  # noqa: PLR2004
        try:
            kwargs["min_capacity"] = int(args["min_capacity"])
        except TypeError, ValueError:
            return ToolResult(success=False, data="", error="min_capacity must be an integer")

    amenities = args.get("amenities")
    if amenities:
        if not isinstance(amenities, list):
            return ToolResult(success=False, data="", error="amenities must be a list of strings")
        kwargs["amenities"] = [str(a) for a in amenities]

    if "building" in args:  # noqa: PLR2004
        kwargs["building"] = str(args["building"])
    if "floor" in args:  # noqa: PLR2004
        kwargs["floor"] = str(args["floor"])
    if "search_query" in args:  # noqa: PLR2004
        kwargs["search_query"] = str(args["search_query"])

    page = max(int(args.get("page", 1) or 1), 1)
    page_size = max(min(int(args.get("page_size", 25) or 25), 100), 1)

    ops = RoomOperations(ctx.session)
    rooms, total = await ops.list_rooms(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        page=page,
        page_size=page_size,
        **kwargs,
    )

    if not rooms:
        return ToolResult(success=True, data="No rooms found.")

    lines = [f"Found {total} rooms (showing {len(rooms)}):"]
    for room in rooms:
        lines.append(_format_room_line(room))
    return ToolResult(success=True, data="\n".join(lines))


async def _execute_get_room(ctx: ToolContext, args: dict) -> ToolResult:
    """Get a room's details and a 7-day window of upcoming bookings."""
    from uniffy.domains.scheduling.rooms.bookings import BookingOperations
    from uniffy.domains.scheduling.rooms.lifecycle import RoomOperations

    room_id_str = args.get("room_id", "")
    if not room_id_str:
        return ToolResult(success=False, data="", error="room_id is required")

    room_id, err = _parse_uuid(room_id_str, "room_id")
    if err:
        return ToolResult(success=False, data="", error=err)

    room_ops = RoomOperations(ctx.session)
    room = await room_ops.get_by_id(ctx.user_id, ctx.organization_id, room_id)  # type: ignore[arg-type]

    result = _format_room_detail("Room", room)

    booking_ops = BookingOperations(ctx.session)
    now = datetime.now(UTC)
    upcoming = await booking_ops.check_availability(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        room_id=room_id,  # type: ignore[arg-type]
        start_date=now,
        end_date=now + timedelta(days=7),
    )
    if upcoming:
        result += "\nUpcoming bookings (next 7 days):"
        for slot in upcoming:
            label = slot.get("event_title") or "Booking"
            booker = slot.get("booker_name") or ""
            line = f"- {label} ({slot['start_time']} to {slot['end_time']})"
            if booker:
                line += f" by {booker}"
            result += f"\n{line}"
    else:
        result += "\nNo bookings in the next 7 days."

    return ToolResult(success=True, data=result)


async def _execute_list_bookings(ctx: ToolContext, args: dict) -> ToolResult:
    """List upcoming bookings, optionally filtered by room and date range."""
    from uniffy.domains.scheduling.rooms.bookings import BookingOperations

    kwargs: dict = {}
    raw_room = args.get("room_id")
    if raw_room:
        room_id, err = _parse_uuid(str(raw_room), "room_id")
        if err:
            return ToolResult(success=False, data="", error=err)
        kwargs["room_id"] = room_id

    tz = ctx.user_timezone
    raw_start = args.get("start_date")
    if raw_start:
        start_date = _parse_datetime(str(raw_start), tz)
        if start_date is None:
            return ToolResult(success=False, data="", error="Invalid start_date format.")
        kwargs["start_date"] = start_date
    raw_end = args.get("end_date")
    if raw_end:
        end_date = _parse_datetime(str(raw_end), tz)
        if end_date is None:
            return ToolResult(success=False, data="", error="Invalid end_date format.")
        kwargs["end_date"] = end_date

    raw_status = args.get("status")
    if raw_status:
        status, err = _parse_booking_status(raw_status)
        if err:
            return ToolResult(success=False, data="", error=err)
        kwargs["status"] = status

    page = max(int(args.get("page", 1) or 1), 1)
    page_size = max(min(int(args.get("page_size", 25) or 25), 100), 1)

    ops = BookingOperations(ctx.session)
    rows, total = await ops.list_bookings(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        page=page,
        page_size=page_size,
        **kwargs,
    )

    if not rows:
        return ToolResult(success=True, data="No bookings found.")

    lines = [f"Found {total} bookings (showing {len(rows)}):"]
    for booking, room_name, booker_name in rows:
        lines.append(_format_booking_line(booking, room_name, booker_name))
    return ToolResult(success=True, data="\n".join(lines))


async def _execute_find_available(ctx: ToolContext, args: dict) -> ToolResult:
    """Find rooms free over a time window with optional filters."""
    from uniffy.domains.scheduling.rooms.bookings import BookingOperations

    tz = ctx.user_timezone
    start_str = args.get("start_time", "")
    end_str = args.get("end_time", "")
    if not start_str or not end_str:
        return ToolResult(success=False, data="", error="start_time and end_time are required")
    start_time = _parse_datetime(start_str, tz)
    end_time = _parse_datetime(end_str, tz)
    if start_time is None or end_time is None:
        return ToolResult(
            success=False,
            data="",
            error="Invalid datetime format. Use ISO 8601 (e.g. 2026-02-22T10:00:00).",
        )
    if end_time <= start_time:
        return ToolResult(success=False, data="", error="end_time must be after start_time")

    kwargs: dict = {}
    if "min_capacity" in args:  # noqa: PLR2004
        try:
            kwargs["min_capacity"] = int(args["min_capacity"])
        except TypeError, ValueError:
            return ToolResult(success=False, data="", error="min_capacity must be an integer")

    amenities = args.get("amenities")
    if amenities:
        if not isinstance(amenities, list):
            return ToolResult(success=False, data="", error="amenities must be a list of strings")
        kwargs["amenities"] = [str(a) for a in amenities]

    raw_type = args.get("room_type")
    if raw_type:
        room_type, err = _parse_room_type(raw_type)
        if err:
            return ToolResult(success=False, data="", error=err)
        kwargs["room_type"] = room_type

    ops = BookingOperations(ctx.session)
    rooms = await ops.find_available_rooms(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        start_time=start_time,
        end_time=end_time,
        **kwargs,
    )

    window = f"{start_time.strftime('%Y-%m-%d %H:%M')} to {end_time.strftime('%Y-%m-%d %H:%M')}"
    if not rooms:
        return ToolResult(success=True, data=f"No rooms available for {window}.")
    lines = [f"{len(rooms)} room(s) available for {window}:"]
    for room in rooms:
        lines.append(_format_room_line(room))
    return ToolResult(success=True, data="\n".join(lines))


async def _execute_book_room(ctx: ToolContext, args: dict) -> ToolResult:
    """Reserve a room for a time slot."""
    from uniffy.domains.scheduling.rooms.bookings import BookingOperations

    room_id_str = args.get("room_id", "")
    if not room_id_str:
        return ToolResult(success=False, data="", error="room_id is required")
    room_id, err = _parse_uuid(room_id_str, "room_id")
    if err:
        return ToolResult(success=False, data="", error=err)

    tz = ctx.user_timezone
    start_str = args.get("start_time", "")
    end_str = args.get("end_time", "")
    if not start_str or not end_str:
        return ToolResult(success=False, data="", error="start_time and end_time are required")
    start_time = _parse_datetime(start_str, tz)
    end_time = _parse_datetime(end_str, tz)
    if start_time is None or end_time is None:
        return ToolResult(
            success=False,
            data="",
            error="Invalid datetime format. Use ISO 8601 (e.g. 2026-02-22T10:00:00).",
        )
    if end_time <= start_time:
        return ToolResult(success=False, data="", error="end_time must be after start_time")

    kwargs: dict = {
        "title": str(args.get("title", "")),
        "notes": str(args.get("notes", "")),
    }

    raw_event = args.get("event_id")
    if raw_event:
        event_id, ev_err = _parse_uuid(str(raw_event), "event_id")
        if ev_err:
            return ToolResult(success=False, data="", error=ev_err)
        kwargs["event_id"] = event_id

    ops = BookingOperations(ctx.session)
    try:
        booking = await ops.create_booking(
            user_id=ctx.user_id,
            organization_id=ctx.organization_id,
            room_id=room_id,  # type: ignore[arg-type]
            start_time=start_time,
            end_time=end_time,
            **kwargs,
        )
    except ValidationError as e:
        return ToolResult(success=False, data="", error=str(e))

    return ToolResult(
        success=True,
        data=_format_booking_detail("Booking created", booking),
    )


async def _execute_cancel_booking(ctx: ToolContext, args: dict) -> ToolResult:
    """Cancel an existing room booking."""
    from uniffy.domains.scheduling.rooms.bookings import BookingOperations

    booking_id_str = args.get("booking_id", "")
    if not booking_id_str:
        return ToolResult(success=False, data="", error="booking_id is required")
    booking_id, err = _parse_uuid(booking_id_str, "booking_id")
    if err:
        return ToolResult(success=False, data="", error=err)

    ops = BookingOperations(ctx.session)
    booking = await ops.cancel_booking(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        booking_id=booking_id,  # type: ignore[arg-type]
    )

    return ToolResult(
        success=True,
        data=_format_booking_detail("Booking cancelled", booking),
    )


_DATETIME_DESC = (
    "ISO 8601 datetime in the user's local time "
    "(e.g. 2026-03-15T10:00:00 or 2026-03-15). "
    "Do NOT append Z - the tool converts to UTC automatically."
)
_ROOM_ID_SCHEMA = {"type": "string", "description": "UUID of the room."}
_BOOKING_ID_SCHEMA = {"type": "string", "description": "UUID of the booking."}
_AMENITIES_SCHEMA = {
    "type": "array",
    "items": {"type": "string"},
    "description": ("Amenities the room must have (e.g. ['whiteboard', 'video', 'phone'])."),
}
_ROOM_TYPE_SCHEMA = {
    "type": "string",
    "enum": list(_ROOM_TYPE_VALUES),
    "description": "Room category.",
}


list_rooms = ToolDefinition(
    name="rooms.list_rooms",
    display_name="List Rooms",
    group="Rooms",
    description=(
        "List rooms in the organization with optional capacity, amenity, "
        "building, floor, or text-search filters. Paginated."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "room_type": _ROOM_TYPE_SCHEMA,
            "min_capacity": {
                "type": "integer",
                "description": "Minimum capacity required.",
            },
            "amenities": _AMENITIES_SCHEMA,
            "building": {"type": "string", "description": "Filter by building name."},
            "floor": {"type": "string", "description": "Filter by floor label."},
            "search_query": {
                "type": "string",
                "description": (
                    "Substring search across name, description, location, building, floor."
                ),
            },
            "page": {"type": "integer", "description": "Page number (default 1)."},
            "page_size": {
                "type": "integer",
                "description": "Results per page (default 25, max 100).",
            },
        },
    },
    executor=_execute_list_rooms,
    read_only=True,
)

get_room = ToolDefinition(
    name="rooms.get_room",
    display_name="Get Room",
    group="Rooms",
    description=("Get a single room's details plus its bookings for the next 7 days."),
    parameter_schema={
        "type": "object",
        "properties": {"room_id": _ROOM_ID_SCHEMA},
        "required": ["room_id"],
    },
    executor=_execute_get_room,
    read_only=True,
)

list_bookings = ToolDefinition(
    name="rooms.list_bookings",
    display_name="List Bookings",
    group="Rooms",
    description=(
        "List room bookings, optionally filtered by room, date range, or status. "
        "Returns room name and booker for each row."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "room_id": {
                "type": "string",
                "description": "Filter to one room (UUID).",
            },
            "start_date": {
                "type": "string",
                "description": f"Bookings ending after this datetime. {_DATETIME_DESC}",
            },
            "end_date": {
                "type": "string",
                "description": f"Bookings starting before this datetime. {_DATETIME_DESC}",
            },
            "status": {
                "type": "string",
                "enum": list(_BOOKING_STATUS_VALUES),
                "description": "Booking status filter.",
            },
            "page": {"type": "integer", "description": "Page number (default 1)."},
            "page_size": {
                "type": "integer",
                "description": "Results per page (default 25, max 100).",
            },
        },
    },
    executor=_execute_list_bookings,
    read_only=True,
)

find_available = ToolDefinition(
    name="rooms.find_available",
    display_name="Find Available Rooms",
    group="Rooms",
    description=(
        "Find rooms that are free for the given time window. "
        "Optional minimum capacity, amenity list, and room_type filters."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "start_time": {
                "type": "string",
                "description": f"Window start. {_DATETIME_DESC}",
            },
            "end_time": {
                "type": "string",
                "description": f"Window end. {_DATETIME_DESC}",
            },
            "min_capacity": {
                "type": "integer",
                "description": "Minimum capacity required.",
            },
            "amenities": _AMENITIES_SCHEMA,
            "room_type": _ROOM_TYPE_SCHEMA,
        },
        "required": ["start_time", "end_time"],
    },
    executor=_execute_find_available,
    read_only=True,
    timeout_seconds=30,
)

book_room = ToolDefinition(
    name="rooms.book_room",
    display_name="Book Room",
    group="Rooms",
    description=(
        "Reserve a room for a time slot. Returns a structured error if the "
        "room is already booked or not available for booking."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "room_id": _ROOM_ID_SCHEMA,
            "start_time": {
                "type": "string",
                "description": f"Booking start. {_DATETIME_DESC}",
            },
            "end_time": {
                "type": "string",
                "description": f"Booking end. {_DATETIME_DESC}",
            },
            "title": {
                "type": "string",
                "description": "Short label for the booking (e.g. meeting title).",
            },
            "notes": {"type": "string", "description": "Optional notes."},
            "event_id": {
                "type": "string",
                "description": (
                    "Optional UUID of a calendar event to link this booking to. "
                    "Prefer calendar.create_event with room_id for new events."
                ),
            },
        },
        "required": ["room_id", "start_time", "end_time"],
    },
    executor=_execute_book_room,
)

cancel_booking = ToolDefinition(
    name="rooms.cancel_booking",
    display_name="Cancel Booking",
    group="Rooms",
    description=(
        "Cancel a room booking. Only the booker or an org admin can cancel; "
        "this is destructive and requires confirmation."
    ),
    parameter_schema={
        "type": "object",
        "properties": {"booking_id": _BOOKING_ID_SCHEMA},
        "required": ["booking_id"],
    },
    executor=_execute_cancel_booking,
    destructive=True,
)

ROOMS_TOOLS: list[ToolDefinition] = [
    list_rooms,
    get_room,
    list_bookings,
    find_available,
    book_room,
    cancel_booking,
]
