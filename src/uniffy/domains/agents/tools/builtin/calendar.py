"""Built-in calendar tools for agents."""

from datetime import UTC, datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from uniffy.core.types import EventStatus, EventTransparency, RecurrencePattern
from uniffy.domains.agents.tools.builtin.args import parse_uuid, parse_uuid_list
from uniffy.domains.agents.tools.definitions import ToolContext, ToolDefinition, ToolResult
from uniffy.domains.calendar.recurrence import OCCURRENCE_ID_SEPARATOR
from uniffy.domains.tags.operations import TagOperations

_RECURRENCE_VALUES = ("NONE", "DAILY", "WEEKLY", "BIWEEKLY", "MONTHLY", "YEARLY")
_ATTENDEE_ROLE_VALUES = ("REQUIRED", "OPTIONAL")
_RSVP_VALUES = ("ACCEPTED", "TENTATIVE", "DECLINED")


def _parse_datetime(value: str, user_timezone: str | None = None) -> datetime | None:
    """Parse an ISO 8601 datetime string, returning timezone-aware UTC.

    If the string ends with Z, it is treated as UTC regardless of
    user_timezone. Otherwise, naive datetimes are interpreted in
    the user's local timezone and converted to UTC.
    """
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
        # Already aware, convert to UTC
        return dt.astimezone(UTC)

    if is_utc_explicit or not user_timezone:
        # Explicit UTC suffix or no timezone available
        return dt.replace(tzinfo=UTC)

    # Interpret as user's local time, then convert to UTC
    try:
        local_tz = ZoneInfo(user_timezone)
    except KeyError, ValueError:
        # Invalid timezone name, fall back to UTC
        return dt.replace(tzinfo=UTC)

    return dt.replace(tzinfo=local_tz).astimezone(UTC)


async def _format_event_result(
    prefix: str,
    event,
    *,
    ctx: ToolContext | None = None,
) -> str:
    """Format a calendar event into a readable tool result.

    When ``ctx`` is supplied, hydrates unified-tag slugs from
    ``TagOperations`` and emits them as ``Tags: a, b, c``.
    """
    urn = f"urn:uniffy:content:CALENDAR_EVENT:{event.id}"
    start = event.start_time.strftime("%Y-%m-%d %H:%M") if event.start_time else "?"
    end = event.end_time.strftime("%Y-%m-%d %H:%M") if event.end_time else "?"

    lines = [f"{prefix}: [[[{event.title}|{urn}]]]"]

    time_parts = []
    if event.is_all_day:
        time_parts.append("All day")
    time_parts.append(f"{start} to {end}")
    if event.timezone and event.timezone != "UTC":  # noqa: PLR2004
        time_parts.append(event.timezone)
    lines.append(" | ".join(time_parts))

    fields: list[str] = []
    if event.status != EventStatus.CONFIRMED:
        fields.append(f"Status: {event.status.value.lower()}")
    if event.is_out_of_office:
        fields.append("Out of office: yes")
    if event.transparency == EventTransparency.TRANSPARENT:
        fields.append("Blocks time: no")
    if event.location:
        fields.append(f"Location: {event.location}")
    if event.meeting_url:
        fields.append(f"Meeting URL: {event.meeting_url}")
    if event.channel_id:
        fields.append(f"Meeting channel: {event.channel_id}")
    if event.is_focus_time:
        fields.append("Focus time: yes")
    if event.recurrence_pattern and event.recurrence_pattern != RecurrencePattern.NONE:
        fields.append(f"Recurrence: {event.recurrence_pattern.value}")
    if ctx is not None:
        master_id = event.id
        raw = str(master_id)
        if OCCURRENCE_ID_SEPARATOR in raw:
            master_id = UUID(raw.split(OCCURRENCE_ID_SEPARATOR)[0])
        urn = f"urn:uniffy:content:CALENDAR_EVENT:{master_id}"
        tag_ops = TagOperations(ctx.session)
        tags_by_urn = await tag_ops.get_for_urns(
            organization_id=ctx.organization_id,
            content_urns=[urn],
        )
        slugs = sorted({tag.slug for tag in tags_by_urn.get(urn, [])})
        if slugs:
            fields.append(f"Tags: {', '.join(slugs)}")
    if event.category_id:
        fields.append(f"Category: {event.category_id}")
    if event.reminders:
        labels = [f"{m}min" for m in event.reminders]
        fields.append(f"Reminders: {', '.join(labels)}")

    if fields:
        lines.append(" | ".join(fields))

    return "\n".join(lines)


# Executors


async def _hidden_event_master_ids(ctx: ToolContext, events: list) -> set[UUID]:
    """Master ids of PRIVATE events whose details the acting user may not see.

    Tools run with the human user's identity, so a private event another
    member shared with them still reads as a busy block in LLM context.
    """
    from sqlalchemy import select

    from uniffy.core.models.calendar.attendee import EventAttendee
    from uniffy.core.models.shared import EventVisibility

    candidates: set[UUID] = set()
    for ev in events:
        if ev.visibility == EventVisibility.PRIVATE and ev.organizer_id != ctx.user_id:
            raw = str(ev.id)
            master = UUID(raw.split(OCCURRENCE_ID_SEPARATOR)[0])
            candidates.add(master)
    if not candidates:
        return set()
    result = await ctx.session.execute(
        select(EventAttendee.event_id).where(
            EventAttendee.event_id.in_(candidates),
            EventAttendee.user_id == ctx.user_id,
        )
    )
    return candidates - set(result.scalars().all())


async def _execute_list_events(ctx: ToolContext, args: dict) -> ToolResult:
    """List calendar events in a date range."""
    from uniffy.domains.calendar.operations import CalendarEventOperations

    start_str = args.get("start_date", "")
    end_str = args.get("end_date", "")
    if not start_str or not end_str:
        return ToolResult(
            success=False,
            data="",
            error="start_date and end_date are required",
        )

    tz = ctx.user_timezone
    start_date = _parse_datetime(start_str, tz)
    end_date = _parse_datetime(end_str, tz)
    if start_date is None or end_date is None:
        return ToolResult(
            success=False,
            data="",
            error=("Invalid date format. Use ISO 8601 (e.g. 2026-02-22T10:00:00Z or 2026-02-22)."),
        )

    # Optional filters
    calendar_ids: list[UUID] | None = None
    category_ids: list[UUID] | None = None

    raw_cal_ids = args.get("calendar_ids")
    if raw_cal_ids:
        calendar_ids, err = parse_uuid_list(raw_cal_ids, "calendar_ids")
        if err:
            return ToolResult(success=False, data="", error=err)

    raw_cat_ids = args.get("category_ids")
    if raw_cat_ids:
        category_ids, err = parse_uuid_list(raw_cat_ids, "category_ids")
        if err:
            return ToolResult(success=False, data="", error=err)

    ops = CalendarEventOperations(ctx.session)
    events = await ops.get_events_in_range(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        start_date=start_date,
        end_date=end_date,
        calendar_ids=calendar_ids,
        category_ids=category_ids,
    )

    if not events:
        return ToolResult(success=True, data="No events found in the specified range.")

    hidden_ids = await _hidden_event_master_ids(ctx, events)

    lines = [f"Found {len(events)} events:"]
    for ev in events:
        start = ev.start_time.strftime("%Y-%m-%d %H:%M") if ev.start_time else "?"
        end = ev.end_time.strftime("%Y-%m-%d %H:%M") if ev.end_time else "?"
        urn = f"urn:uniffy:content:CALENDAR_EVENT:{ev.id}"
        master = UUID(str(ev.id).split(OCCURRENCE_ID_SEPARATOR)[0])

        if master in hidden_ids:
            lines.append(f"- Busy ({start} to {end}) [private]")
            continue

        parts = [f"- [[[{ev.title}|{urn}]]] ({start} to {end})"]
        if ev.is_all_day:
            parts.append("[all-day]")
        if ev.status != EventStatus.CONFIRMED:
            parts.append(f"[{ev.status.value.lower()}]")
        if ev.location:
            parts.append(f"@ {ev.location}")
        if ev.is_focus_time:
            parts.append("[focus]")
        if ev.is_out_of_office:
            parts.append("[out-of-office]")
        if ev.recurrence_pattern and ev.recurrence_pattern != RecurrencePattern.NONE:
            parts.append(f"[{ev.recurrence_pattern.value.lower()}]")

        lines.append(" ".join(parts))

    return ToolResult(success=True, data="\n".join(lines))


async def _execute_read_event(ctx: ToolContext, args: dict) -> ToolResult:
    """Read a single calendar event with full details including attendees."""
    from uniffy.domains.calendar.operations import CalendarEventOperations

    event_id_str = args.get("event_id", "")
    if not event_id_str:
        return ToolResult(success=False, data="", error="event_id is required")

    event_id, err = parse_uuid(event_id_str, "event_id")
    if err:
        return ToolResult(success=False, data="", error=err)

    ops = CalendarEventOperations(ctx.session)
    event, attendees = await ops.get_event_with_attendees(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        event_id=event_id,  # type: ignore[arg-type]
    )

    if await _hidden_event_master_ids(ctx, [event]):
        start = event.start_time.strftime("%Y-%m-%d %H:%M") if event.start_time else "?"
        end = event.end_time.strftime("%Y-%m-%d %H:%M") if event.end_time else "?"
        return ToolResult(
            success=True,
            data=f"Busy ({start} to {end}). This event is private; its details are hidden.",
        )

    result = await _format_event_result("Event", event, ctx=ctx)

    if event.description:
        result += f"\nDescription: {event.description}"

    if attendees:
        att_lines = []
        for attendee, user_info in attendees:
            name = user_info.get("name", "Unknown")
            status = attendee.status.value if attendee.status else "PENDING"
            role = attendee.role.value if attendee.role else "REQUIRED"
            att_lines.append(f"  - {name} ({role}, {status})")
        result += "\nAttendees:\n" + "\n".join(att_lines)

    if event.recurrence_config:
        result += f"\nRecurrence config: {event.recurrence_config}"

    return ToolResult(success=True, data=result)


async def _execute_create_event(ctx: ToolContext, args: dict) -> ToolResult:
    """Create a new calendar event."""
    from uniffy.domains.calendar import queries as cal_queries
    from uniffy.domains.calendar.operations import CalendarEventOperations

    title = args.get("title", "")
    if not title:
        return ToolResult(success=False, data="", error="title is required")

    is_all_day = bool(args.get("is_all_day", False))
    tz = ctx.user_timezone

    start_str = args.get("start_time", "")
    end_str = args.get("end_time", "")

    # For all-day events, only a date is needed (no timezone conversion)
    if is_all_day:
        if not start_str:
            return ToolResult(
                success=False,
                data="",
                error="start_time (date) is required",
            )
        # Parse without timezone - all-day means the calendar date, not a point in time
        start_time = _parse_datetime(start_str, None)
        if start_time is None:
            return ToolResult(
                success=False,
                data="",
                error="Invalid date format. Use ISO 8601 (e.g. 2026-03-20).",
            )
        # Normalize to midnight UTC - the date itself is what matters
        start_time = start_time.replace(hour=0, minute=0, second=0, microsecond=0)
        if end_str:
            end_time = _parse_datetime(end_str, None)
            if end_time:
                end_time = end_time.replace(hour=0, minute=0, second=0, microsecond=0)
            else:
                end_time = start_time + timedelta(days=1)
        else:
            end_time = start_time + timedelta(days=1)
    else:
        if not start_str or not end_str:
            return ToolResult(
                success=False,
                data="",
                error="start_time and end_time are required",
            )
        start_time = _parse_datetime(start_str, tz)
        end_time = _parse_datetime(end_str, tz)
        if start_time is None or end_time is None:
            return ToolResult(
                success=False,
                data="",
                error="Invalid date format. Use ISO 8601 (e.g. 2026-02-22T10:00:00).",
            )

    # Build kwargs from optional fields
    kwargs: dict = {
        "description": args.get("description", ""),
    }

    kwargs["is_all_day"] = is_all_day
    kwargs["timezone"] = args.get("timezone") or ctx.user_timezone or "UTC"
    if "location" in args:  # noqa: PLR2004
        kwargs["location"] = args["location"]
    if "meeting_url" in args:  # noqa: PLR2004
        kwargs["meeting_url"] = args["meeting_url"]
    if "is_focus_time" in args:  # noqa: PLR2004
        kwargs["is_focus_time"] = bool(args["is_focus_time"])
    if "tag_ids" in args and isinstance(args["tag_ids"], list):  # noqa: PLR2004
        tag_ids, tag_err = parse_uuid_list(args["tag_ids"], "tag_ids")
        if tag_err:
            return ToolResult(success=False, data="", error=tag_err)
        kwargs["tag_ids"] = tag_ids
    if "reminders" in args and isinstance(args["reminders"], list):  # noqa: PLR2004
        kwargs["reminders"] = [int(m) for m in args["reminders"]]

    raw_room = args.get("room_id")
    if raw_room:
        room_id, err = parse_uuid(str(raw_room), "room_id")
        if err:
            return ToolResult(success=False, data="", error=err)
        kwargs["room_id"] = room_id

    # Category
    raw_cat = args.get("category_id")
    if raw_cat:
        cat_id, err = parse_uuid(str(raw_cat), "category_id")
        if err:
            return ToolResult(success=False, data="", error=err)
        kwargs["category_id"] = cat_id

    # Attendees
    raw_attendees = args.get("attendee_ids")
    if raw_attendees and isinstance(raw_attendees, list):
        att_ids, err = parse_uuid_list(raw_attendees, "attendee_ids")
        if err:
            return ToolResult(success=False, data="", error=err)
        kwargs["attendee_ids"] = att_ids

    # Recurrence
    raw_rec = args.get("recurrence_pattern")
    if raw_rec:
        from uniffy.core.models.shared import RecurrencePattern

        rec_upper = str(raw_rec).upper()
        if rec_upper not in _RECURRENCE_VALUES:
            return ToolResult(
                success=False,
                data="",
                error=(
                    f"Invalid recurrence_pattern: {raw_rec}. "
                    f"Must be one of: {', '.join(_RECURRENCE_VALUES)}"
                ),
            )
        kwargs["recurrence_pattern"] = RecurrencePattern(rec_upper)

    raw_rec_config = args.get("recurrence_config")
    if raw_rec_config and isinstance(raw_rec_config, dict):
        kwargs["recurrence_config"] = raw_rec_config

    # Ensure user has a default calendar
    calendar = await cal_queries.ensure_default_calendar(
        ctx.session,
        ctx.organization_id,
        ctx.user_id,
    )

    ops = CalendarEventOperations(ctx.session)
    event = await ops.create(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        title=title,
        start_time=start_time,
        end_time=end_time,
        calendar_id=calendar.id,
        **kwargs,
    )

    return ToolResult(
        success=True,
        data=await _format_event_result("Event created", event, ctx=ctx),
    )


async def _execute_update_event(ctx: ToolContext, args: dict) -> ToolResult:
    """Update a calendar event."""
    from uniffy.domains.calendar.operations import CalendarEventOperations

    event_id_str = args.get("event_id", "")
    if not event_id_str:
        return ToolResult(success=False, data="", error="event_id is required")

    event_id, err = parse_uuid(event_id_str, "event_id")
    if err:
        return ToolResult(success=False, data="", error=err)

    kwargs: dict = {}

    # Simple string fields
    for field in ("title", "description", "location", "meeting_url", "timezone"):
        if field in args:
            kwargs[field] = args[field]

    # Datetime fields
    tz = ctx.user_timezone
    for field in ("start_time", "end_time"):
        if field in args:
            parsed = _parse_datetime(args[field], tz)
            if parsed is None:
                return ToolResult(
                    success=False,
                    data="",
                    error=f"Invalid {field} format.",
                )
            kwargs[field] = parsed

    # Boolean fields
    for field in ("is_all_day", "is_focus_time"):
        if field in args:
            kwargs[field] = bool(args[field])

    # Tags - replacement set of unified-tag ids (UUID strings).
    if "tag_ids" in args and isinstance(args["tag_ids"], list):  # noqa: PLR2004
        tag_ids, tag_err = parse_uuid_list(args["tag_ids"], "tag_ids")
        if tag_err:
            return ToolResult(success=False, data="", error=tag_err)
        kwargs["tag_ids"] = tag_ids

    # Reminders
    if "reminders" in args and isinstance(args["reminders"], list):  # noqa: PLR2004
        kwargs["reminders"] = [int(m) for m in args["reminders"]]

    # Category
    raw_cat = args.get("category_id")
    if raw_cat:
        cat_id, cat_err = parse_uuid(str(raw_cat), "category_id")
        if cat_err:
            return ToolResult(success=False, data="", error=cat_err)
        kwargs["category_id"] = cat_id

    # Attendees (replaces existing list)
    raw_attendees = args.get("attendee_ids")
    if raw_attendees is not None and isinstance(raw_attendees, list):
        att_ids, att_err = parse_uuid_list(raw_attendees, "attendee_ids")
        if att_err:
            return ToolResult(success=False, data="", error=att_err)
        kwargs["attendee_ids"] = att_ids

    # Recurrence config
    raw_rec_config = args.get("recurrence_config")
    if raw_rec_config and isinstance(raw_rec_config, dict):
        kwargs["recurrence_config"] = raw_rec_config

    if not kwargs:
        return ToolResult(
            success=False,
            data="",
            error="At least one field to update is required",
        )

    ops = CalendarEventOperations(ctx.session)
    event = await ops.update(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        event_id=event_id,  # type: ignore[arg-type]
        **kwargs,
    )

    return ToolResult(
        success=True,
        data=await _format_event_result("Event updated", event, ctx=ctx),
    )


async def _execute_delete_event(ctx: ToolContext, args: dict) -> ToolResult:
    """Delete a calendar event."""
    from uniffy.domains.calendar.operations import CalendarEventOperations

    event_id_str = args.get("event_id", "")
    if not event_id_str:
        return ToolResult(success=False, data="", error="event_id is required")

    event_id, err = parse_uuid(event_id_str, "event_id")
    if err:
        return ToolResult(success=False, data="", error=err)

    ops = CalendarEventOperations(ctx.session)
    await ops.delete(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        event_id=event_id,  # type: ignore[arg-type]
    )

    return ToolResult(success=True, data="Event deleted successfully.")


async def _execute_add_attendees(ctx: ToolContext, args: dict) -> ToolResult:
    """Add attendees to a calendar event."""
    from uniffy.core.models.shared import AttendeeRole
    from uniffy.domains.calendar.operations import CalendarEventOperations

    event_id_str = args.get("event_id", "")
    if not event_id_str:
        return ToolResult(success=False, data="", error="event_id is required")

    event_id, err = parse_uuid(event_id_str, "event_id")
    if err:
        return ToolResult(success=False, data="", error=err)

    raw_ids = args.get("attendee_ids", [])
    if not raw_ids or not isinstance(raw_ids, list):
        return ToolResult(
            success=False,
            data="",
            error="attendee_ids is required (list of UUIDs)",
        )

    att_ids, att_err = parse_uuid_list(raw_ids, "attendee_ids")
    if att_err:
        return ToolResult(success=False, data="", error=att_err)

    role = AttendeeRole.REQUIRED
    raw_role = args.get("role")
    if raw_role:
        role_upper = str(raw_role).upper()
        if role_upper not in _ATTENDEE_ROLE_VALUES:
            return ToolResult(
                success=False,
                data="",
                error=(
                    f"Invalid role: {raw_role}. Must be one of: {', '.join(_ATTENDEE_ROLE_VALUES)}"
                ),
            )
        role = AttendeeRole(role_upper)

    ops = CalendarEventOperations(ctx.session)
    event = await ops.add_attendees(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        event_id=event_id,  # type: ignore[arg-type]
        attendee_ids=att_ids,  # type: ignore[arg-type]
        role=role,
    )

    urn = f"urn:uniffy:content:CALENDAR_EVENT:{event.id}"
    return ToolResult(
        success=True,
        data=(
            f"Added {len(att_ids)} attendee(s) to [[[{event.title}|{urn}]]]"  # type: ignore[arg-type]
        ),
    )


async def _execute_remove_attendees(ctx: ToolContext, args: dict) -> ToolResult:
    """Remove attendees from a calendar event."""
    from uniffy.domains.calendar.operations import CalendarEventOperations

    event_id_str = args.get("event_id", "")
    if not event_id_str:
        return ToolResult(success=False, data="", error="event_id is required")

    event_id, err = parse_uuid(event_id_str, "event_id")
    if err:
        return ToolResult(success=False, data="", error=err)

    raw_ids = args.get("attendee_ids", [])
    if not raw_ids or not isinstance(raw_ids, list):
        return ToolResult(
            success=False,
            data="",
            error="attendee_ids is required (list of UUIDs)",
        )

    att_ids, att_err = parse_uuid_list(raw_ids, "attendee_ids")
    if att_err:
        return ToolResult(success=False, data="", error=att_err)

    ops = CalendarEventOperations(ctx.session)
    event = await ops.remove_attendees(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        event_id=event_id,  # type: ignore[arg-type]
        attendee_ids=att_ids,  # type: ignore[arg-type]
    )

    urn = f"urn:uniffy:content:CALENDAR_EVENT:{event.id}"
    return ToolResult(
        success=True,
        data=(
            f"Removed {len(att_ids)} attendee(s) from [[[{event.title}|{urn}]]]"  # type: ignore[arg-type]
        ),
    )


async def _execute_rsvp(ctx: ToolContext, args: dict) -> ToolResult:
    """Update the current user's attendance status for an event."""
    from uniffy.core.models.shared import AttendeeStatus
    from uniffy.domains.calendar.operations import CalendarEventOperations

    event_id_str = args.get("event_id", "")
    if not event_id_str:
        return ToolResult(success=False, data="", error="event_id is required")

    event_id, err = parse_uuid(event_id_str, "event_id")
    if err:
        return ToolResult(success=False, data="", error=err)

    raw_status = args.get("status", "")
    if not raw_status:
        return ToolResult(success=False, data="", error="status is required")

    status_upper = str(raw_status).upper()
    if status_upper not in _RSVP_VALUES:
        return ToolResult(
            success=False,
            data="",
            error=f"Invalid status: {raw_status}. Must be one of: {', '.join(_RSVP_VALUES)}",
        )

    ops = CalendarEventOperations(ctx.session)
    await ops.update_attendee_status(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        event_id=event_id,  # type: ignore[arg-type]
        status=AttendeeStatus(status_upper),
    )

    return ToolResult(
        success=True,
        data=f"RSVP updated to {status_upper} for event {event_id_str}.",
    )


async def _execute_list_categories(ctx: ToolContext, args: dict) -> ToolResult:
    """List available event categories."""
    from uniffy.domains.calendar.operations import CategoryOperations

    ops = CategoryOperations(ctx.session)
    categories = await ops.list_categories(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
    )

    if not categories:
        return ToolResult(success=True, data="No categories found.")

    lines = [f"Found {len(categories)} categories:"]
    for cat in categories:
        icon = f" {cat.icon}" if cat.icon else ""
        default = " (default)" if cat.is_default else ""
        lines.append(f"- {cat.name}{icon} [{cat.color}] id={cat.id}{default}")

    return ToolResult(success=True, data="\n".join(lines))


# Shared schema fragments

_DATETIME_DESC = (
    "ISO 8601 datetime in the user's local time "
    "(e.g. 2026-03-15T10:00:00 or 2026-03-15). "
    "Do NOT append Z - the tool converts to UTC automatically."
)
_EVENT_ID_SCHEMA = {"type": "string", "description": "UUID of the event."}

_RECURRENCE_PATTERN_SCHEMA = {
    "type": "string",
    "enum": list(_RECURRENCE_VALUES),
    "description": (
        "Recurrence pattern. Set this instead of creating multiple events. "
        "E.g. WEEKLY for a weekly meeting, DAILY for daily standup."
    ),
}

_RECURRENCE_CONFIG_SCHEMA = {
    "type": "object",
    "description": (
        "Recurrence configuration object. Keys: interval (int), "
        "days_of_week (list of MONDAY-SUNDAY), end_date (ISO 8601), "
        "max_occurrences (int)."
    ),
}

_TAG_IDS_SCHEMA = {
    "type": "array",
    "items": {"type": "string"},
    "description": (
        "Replacement set of unified-tag UUIDs to attach to the event. "
        "Use the tags service to resolve names / slugs to ids first."
    ),
}

_REMINDERS_SCHEMA = {
    "type": "array",
    "items": {"type": "integer"},
    "description": (
        "Reminder intervals in minutes before the event (e.g. [15, 60] for 15min and 1hr before)."
    ),
}

_ATTENDEE_IDS_SCHEMA = {
    "type": "array",
    "items": {"type": "string"},
    "description": "List of user UUIDs to invite as attendees.",
}


# Tool definitions

list_events = ToolDefinition(
    name="calendar.list_events",
    display_name="List Events",
    group="Calendar",
    description=(
        "List calendar events within a date range. Optionally filter by calendar or category."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "start_date": {
                "type": "string",
                "description": f"Start of date range. {_DATETIME_DESC}",
            },
            "end_date": {
                "type": "string",
                "description": f"End of date range. {_DATETIME_DESC}",
            },
            "calendar_ids": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Filter by calendar UUIDs (optional).",
            },
            "category_ids": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Filter by category UUIDs (optional).",
            },
        },
        "required": ["start_date", "end_date"],
    },
    executor=_execute_list_events,
    read_only=True,
)

read_event = ToolDefinition(
    name="calendar.read_event",
    display_name="Read Event",
    group="Calendar",
    description=(
        "Read a single calendar event with full details "
        "including attendees, recurrence, description, and category."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "event_id": _EVENT_ID_SCHEMA,
        },
        "required": ["event_id"],
    },
    executor=_execute_read_event,
    read_only=True,
)

create_event = ToolDefinition(
    name="calendar.create_event",
    display_name="Create Event",
    group="Calendar",
    description=(
        "Create a single calendar event. For recurring events (daily, weekly, etc.), "
        "set recurrence_pattern on this ONE event - do NOT create multiple events. "
        "Supports title, times, location, attendees, recurrence, categories, "
        "and reminders. Events are invite-only: attendees and the organizer "
        "see them, nobody else."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "description": "Event title.",
            },
            "start_time": {
                "type": "string",
                "description": f"Event start time (or date for all-day events). {_DATETIME_DESC}",
            },
            "end_time": {
                "type": "string",
                "description": (
                    f"Event end time. {_DATETIME_DESC} "
                    "Optional for all-day events (defaults to end of day)."
                ),
            },
            "description": {
                "type": "string",
                "description": "Event description in markdown format.",
            },
            "is_all_day": {
                "type": "boolean",
                "description": "Whether this is an all-day event.",
            },
            "timezone": {
                "type": "string",
                "description": ("Timezone identifier (e.g. America/New_York). Defaults to UTC."),
            },
            "location": {
                "type": "string",
                "description": "Physical or virtual location.",
            },
            "meeting_url": {
                "type": "string",
                "description": "Meeting URL (Zoom, Google Meet, etc.).",
            },
            "category_id": {
                "type": "string",
                "description": (
                    "Category UUID for color coding. "
                    "Use calendar.list_categories to see available categories."
                ),
            },
            "attendee_ids": _ATTENDEE_IDS_SCHEMA,
            "recurrence_pattern": _RECURRENCE_PATTERN_SCHEMA,
            "recurrence_config": _RECURRENCE_CONFIG_SCHEMA,
            "is_focus_time": {
                "type": "boolean",
                "description": "Mark as focus/deep work time.",
            },
            "tag_ids": _TAG_IDS_SCHEMA,
            "room_id": {
                "type": "string",
                "description": (
                    "Optional room UUID to book alongside the event. Use "
                    "rooms.find_available to pick one; an already-booked room "
                    "returns an error and nothing is created."
                ),
            },
            "reminders": _REMINDERS_SCHEMA,
        },
        "required": ["title", "start_time"],
    },
    executor=_execute_create_event,
)

update_event = ToolDefinition(
    name="calendar.update_event",
    display_name="Edit Event",
    group="Calendar",
    description=(
        "Update a calendar event. Any field can be changed: title, times, "
        "location, attendees, recurrence, category, reminders."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "event_id": _EVENT_ID_SCHEMA,
            "title": {"type": "string", "description": "New event title."},
            "description": {
                "type": "string",
                "description": "New description in markdown.",
            },
            "start_time": {
                "type": "string",
                "description": f"New start time. {_DATETIME_DESC}",
            },
            "end_time": {
                "type": "string",
                "description": f"New end time. {_DATETIME_DESC}",
            },
            "is_all_day": {
                "type": "boolean",
                "description": "Whether this is an all-day event.",
            },
            "timezone": {
                "type": "string",
                "description": "Timezone identifier.",
            },
            "location": {
                "type": "string",
                "description": "New location.",
            },
            "meeting_url": {
                "type": "string",
                "description": "New meeting URL.",
            },
            "category_id": {
                "type": "string",
                "description": "New category UUID.",
            },
            "attendee_ids": {
                "type": "array",
                "items": {"type": "string"},
                "description": ("New full list of attendee UUIDs. Replaces existing attendees."),
            },
            "recurrence_config": _RECURRENCE_CONFIG_SCHEMA,
            "is_focus_time": {
                "type": "boolean",
                "description": "Mark as focus/deep work time.",
            },
            "tag_ids": _TAG_IDS_SCHEMA,
            "reminders": _REMINDERS_SCHEMA,
        },
        "required": ["event_id"],
    },
    executor=_execute_update_event,
)

delete_event = ToolDefinition(
    name="calendar.delete_event",
    display_name="Delete Event",
    group="Calendar",
    description="Delete a calendar event. This is destructive and cannot be undone.",
    parameter_schema={
        "type": "object",
        "properties": {
            "event_id": _EVENT_ID_SCHEMA,
        },
        "required": ["event_id"],
    },
    executor=_execute_delete_event,
    destructive=True,
)

add_attendees = ToolDefinition(
    name="calendar.add_attendees",
    display_name="Add Attendees",
    group="Calendar",
    description=(
        "Add attendees to a calendar event. New attendees receive an invitation notification."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "event_id": _EVENT_ID_SCHEMA,
            "attendee_ids": {
                "type": "array",
                "items": {"type": "string"},
                "description": "List of user UUIDs to add as attendees.",
            },
            "role": {
                "type": "string",
                "enum": list(_ATTENDEE_ROLE_VALUES),
                "description": (
                    "Role for the new attendees: REQUIRED or OPTIONAL. Defaults to REQUIRED."
                ),
            },
        },
        "required": ["event_id", "attendee_ids"],
    },
    executor=_execute_add_attendees,
)

remove_attendees = ToolDefinition(
    name="calendar.remove_attendees",
    display_name="Remove Attendees",
    group="Calendar",
    description="Remove attendees from a calendar event.",
    parameter_schema={
        "type": "object",
        "properties": {
            "event_id": _EVENT_ID_SCHEMA,
            "attendee_ids": {
                "type": "array",
                "items": {"type": "string"},
                "description": "List of user UUIDs to remove.",
            },
        },
        "required": ["event_id", "attendee_ids"],
    },
    executor=_execute_remove_attendees,
)

rsvp = ToolDefinition(
    name="calendar.rsvp",
    display_name="RSVP",
    group="Calendar",
    description=(
        "Update the current user's attendance status for an event "
        "(accept, tentatively accept, or decline)."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "event_id": _EVENT_ID_SCHEMA,
            "status": {
                "type": "string",
                "enum": list(_RSVP_VALUES),
                "description": "Attendance status: ACCEPTED, TENTATIVE, or DECLINED.",
            },
        },
        "required": ["event_id", "status"],
    },
    executor=_execute_rsvp,
)

list_categories = ToolDefinition(
    name="calendar.list_categories",
    display_name="List Categories",
    group="Calendar",
    description=(
        "List available event categories for the organization. "
        "Categories provide color coding and filtering for events."
    ),
    parameter_schema={
        "type": "object",
        "properties": {},
    },
    executor=_execute_list_categories,
    read_only=True,
)


async def _member_display_names(ctx: ToolContext, user_ids: list[UUID]) -> dict[UUID, str]:
    from sqlalchemy import select

    from uniffy.core.models.login.user import User

    result = await ctx.session.execute(select(User).where(User.id.in_(user_ids)))
    return {u.id: u.full_name or u.email for u in result.scalars().all()}


def _fmt_local(dt: datetime, tz: ZoneInfo) -> str:
    local = dt.astimezone(tz)
    return local.strftime("%a %Y-%m-%dT%H:%M")


async def _execute_get_free_busy(ctx: ToolContext, args: dict) -> ToolResult:
    from uniffy.domains.calendar.scheduling import get_busy_intervals

    raw_users = args.get("user_ids")
    if not raw_users or not isinstance(raw_users, list):
        return ToolResult(success=False, data="", error="user_ids is required")
    user_ids, err = parse_uuid_list(raw_users, "user_ids")
    if err:
        return ToolResult(success=False, data="", error=err)

    tz_name = ctx.user_timezone or "UTC"
    start = _parse_datetime(args.get("start_time", ""), tz_name)
    if start is None:
        return ToolResult(success=False, data="", error="start_time is required (ISO 8601)")
    end = None
    if args.get("end_time"):
        end = _parse_datetime(args["end_time"], tz_name)
        if end is None:
            return ToolResult(success=False, data="", error="Invalid end_time format")
    if end is None:
        end = start + timedelta(days=7)

    busy = await get_busy_intervals(ctx.session, ctx.organization_id, user_ids, start, end)
    names = await _member_display_names(ctx, user_ids)
    try:
        tz = ZoneInfo(tz_name)
    except KeyError, ValueError:
        tz = ZoneInfo("UTC")

    lines = [f"Busy times {_fmt_local(start, tz)} to {_fmt_local(end, tz)} ({tz.key}):"]
    for uid in user_ids:
        lines.append(f"\n{names.get(uid, str(uid))}:")
        intervals = busy.get(uid, [])
        if not intervals:
            lines.append("  free for the whole range")
        for interval in intervals:
            suffix = " (out of office)" if interval.out_of_office else ""
            lines.append(
                f"  {_fmt_local(interval.start, tz)} to {_fmt_local(interval.end, tz)}{suffix}"
            )
    return ToolResult(success=True, data="\n".join(lines))


async def _execute_find_time(ctx: ToolContext, args: dict) -> ToolResult:
    from uniffy.domains.calendar.scheduling import get_busy_intervals, suggest_meeting_times
    from uniffy.domains.settings.operations import get_users_scheduling_context

    raw_attendees = args.get("attendee_ids")
    if not raw_attendees or not isinstance(raw_attendees, list):
        return ToolResult(success=False, data="", error="attendee_ids is required")
    attendee_ids, err = parse_uuid_list(raw_attendees, "attendee_ids")
    if err:
        return ToolResult(success=False, data="", error=err)
    participant_ids = list(dict.fromkeys([ctx.user_id, *attendee_ids]))

    duration_minutes = int(args.get("duration_minutes") or 30)
    if not 5 <= duration_minutes <= 480:
        return ToolResult(success=False, data="", error="duration_minutes must be between 5 and 480")

    tz_name = ctx.user_timezone or "UTC"
    now = datetime.now(UTC)
    window_start = now
    if args.get("window_start"):
        parsed = _parse_datetime(args["window_start"], tz_name)
        if parsed is None:
            return ToolResult(success=False, data="", error="Invalid window_start format")
        window_start = max(parsed, now)
    if args.get("window_end"):
        window_end = _parse_datetime(args["window_end"], tz_name)
        if window_end is None:
            return ToolResult(success=False, data="", error="Invalid window_end format")
    else:
        window_end = window_start + timedelta(days=7)
    if window_end <= window_start:
        return ToolResult(success=False, data="", error="window_end must be after window_start")

    hour_override = None
    if args.get("earliest_hour") is not None or args.get("latest_hour") is not None:
        hour_override = (int(args.get("earliest_hour") or 9), int(args.get("latest_hour") or 18))
    include_weekends = bool(args.get("include_weekends", False))
    max_results = min(10, max(1, int(args.get("max_results") or 5)))

    busy_by_user = await get_busy_intervals(
        ctx.session, ctx.organization_id, participant_ids, window_start, window_end
    )
    schedule_by_user = await get_users_scheduling_context(ctx.session, participant_ids)

    try:
        tz = ZoneInfo(tz_name)
    except KeyError, ValueError:
        tz = ZoneInfo("UTC")

    suggestions = suggest_meeting_times(
        busy_by_user,
        schedule_by_user,
        required_ids=participant_ids,
        optional_ids=[],
        room_busy=[],
        window_start=window_start,
        window_end=window_end,
        duration=timedelta(minutes=duration_minutes),
        max_results=max_results,
        hour_override=hour_override,
        extra_workdays=include_weekends,
    )

    names = await _member_display_names(ctx, participant_ids)
    who = ", ".join(names.get(uid, str(uid)) for uid in participant_ids)

    if not suggestions:
        hours_note = (
            f"within {hour_override[0]:02d}:00-{hour_override[1]:02d}:00 {tz.key}"
            if hour_override
            else "within each attendee's working hours"
        )
        return ToolResult(
            success=True,
            data=(
                f"No open {duration_minutes}-minute slot for {who} between "
                f"{_fmt_local(window_start, tz)} and {_fmt_local(window_end, tz)} "
                f"{hours_note}. "
                "Try a wider window, different hours, or include_weekends=true."
            ),
        )

    lines = [
        f"Open {duration_minutes}-minute slots for {who} (times in {tz.key}; "
        "pass start/end exactly as shown to calendar.create_event):"
    ]
    for i, suggestion in enumerate(suggestions, start=1):
        local_s = suggestion.start.astimezone(tz)
        local_e = suggestion.end.astimezone(tz)
        lines.append(
            f"{i}. {local_s.strftime('%a')} {local_s.strftime('%Y-%m-%dT%H:%M:%S')} "
            f"to {local_e.strftime('%Y-%m-%dT%H:%M:%S')}"
        )
    return ToolResult(success=True, data="\n".join(lines))


_USER_IDS_SCHEMA = {
    "type": "array",
    "items": {"type": "string"},
    "description": (
        "User UUIDs of organization members. Resolve names to ids with the "
        "search or user tools first."
    ),
}

get_free_busy = ToolDefinition(
    name="calendar.get_free_busy",
    display_name="Get Free/Busy",
    group="Calendar",
    description=(
        "Busy time blocks for organization members over a date range. "
        "Returns only intervals - never event titles or details. Use before "
        "proposing meeting times; for direct slot suggestions prefer "
        "calendar.find_time."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "user_ids": _USER_IDS_SCHEMA,
            "start_time": {
                "type": "string",
                "description": f"Range start. {_DATETIME_DESC}",
            },
            "end_time": {
                "type": "string",
                "description": f"Range end. Defaults to 7 days after start. {_DATETIME_DESC}",
            },
        },
        "required": ["user_ids", "start_time"],
    },
    executor=_execute_get_free_busy,
    read_only=True,
)

find_time = ToolDefinition(
    name="calendar.find_time",
    display_name="Find Meeting Time",
    group="Calendar",
    description=(
        "Suggest open meeting slots that work for the current user plus the "
        "given attendees, based on everyone's calendars. Each attendee's saved "
        "working hours, workdays, and timezone apply automatically; only pass "
        "earliest_hour/latest_hour to override them. Follow up with "
        "calendar.create_event using a suggested slot."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "attendee_ids": {
                "type": "array",
                "items": {"type": "string"},
                "description": (
                    "User UUIDs of the other participants. The current user is "
                    "always included automatically."
                ),
            },
            "duration_minutes": {
                "type": "integer",
                "description": "Meeting length in minutes (5-480). Default 30.",
            },
            "window_start": {
                "type": "string",
                "description": (
                    f"Earliest acceptable time. Defaults to now; past values are "
                    f"clamped to now. {_DATETIME_DESC}"
                ),
            },
            "window_end": {
                "type": "string",
                "description": (
                    f"Latest acceptable time. Defaults to window_start + 7 days. {_DATETIME_DESC}"
                ),
            },
            "earliest_hour": {
                "type": "integer",
                "description": (
                    "Override: earliest slot start hour (0-23) applied to everyone in "
                    "their own timezone. Omit to use each attendee's saved working hours."
                ),
            },
            "latest_hour": {
                "type": "integer",
                "description": (
                    "Override: latest slot end hour (1-24) applied to everyone in "
                    "their own timezone. Omit to use each attendee's saved working hours."
                ),
            },
            "include_weekends": {
                "type": "boolean",
                "description": (
                    "Consider every day of the week, not just saved workdays. Default false."
                ),
            },
            "max_results": {
                "type": "integer",
                "description": "Maximum suggestions to return (1-10). Default 5.",
            },
        },
        "required": ["attendee_ids"],
    },
    executor=_execute_find_time,
    read_only=True,
)

CALENDAR_TOOLS: list[ToolDefinition] = [
    list_events,
    read_event,
    create_event,
    update_event,
    delete_event,
    add_attendees,
    remove_attendees,
    rsvp,
    list_categories,
    get_free_busy,
    find_time,
]
