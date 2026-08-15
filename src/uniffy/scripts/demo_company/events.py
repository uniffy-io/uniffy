"""Seed calendar events, booked into the demo rooms where the content asks for it."""

from __future__ import annotations

from datetime import datetime, timedelta
from uuid import UUID

from loguru import logger
from sqlalchemy import select

from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.rooms.room import Room
from uniffy.domains.calendar import queries as calendar_queries
from uniffy.domains.calendar.operations import CalendarEventOperations
from uniffy.scripts.demo_company.context import (
    DemoContext,
    DomainResult,
    resolve_member_ids,
    tag_ids_for,
)
from uniffy.scripts.demo_company.loader import EventSpec
from uniffy.scripts.demo_company.mentions import EVENT, MentionRegistry

logger = logger.bind(component="scripts.demo_company.events")


async def seed_events(
    ctx: DemoContext,
    events: tuple[EventSpec, ...],
    tag_ids: dict[str, UUID],
    registry: MentionRegistry,
    known_rooms: frozenset[str] = frozenset(),
) -> DomainResult:
    """`known_rooms` are the rooms this content set defines, so a dry run does not
    warn about rooms the same run would have created.
    """
    result = DomainResult()
    if not events:
        return result

    ops = CalendarEventOperations(ctx.session)
    room_ids = await _room_ids(ctx)
    calendar_id: UUID | None = None
    if not ctx.dry_run:
        calendar = await calendar_queries.ensure_default_calendar(
            ctx.session, ctx.organization_id, ctx.actor_id
        )
        calendar_id = calendar.id

    for spec in events:
        start = ctx.local_datetime(spec.day_offset, spec.start)
        end = start + timedelta(minutes=spec.duration_minutes)

        existing_id = await _find_event_id(ctx, spec.title, start)
        if existing_id is not None:
            registry.register(EVENT, spec.title, existing_id)
            result.skipped += 1
            continue

        room_id = None
        if spec.room:
            room_id = room_ids.get(spec.room)
            if room_id is None and spec.room not in known_rooms:
                logger.warning(f"{spec.title!r} asks for room {spec.room!r}, which does not exist")

        if ctx.dry_run:
            logger.info(f"[dry-run] event {spec.title!r} at {start.isoformat()}")
            result.created += 1
            continue

        event = await ops.create(
            user_id=ctx.actor_id,
            organization_id=ctx.organization_id,
            title=spec.title,
            start_time=start,
            end_time=end,
            calendar_id=calendar_id,
            description=spec.description,
            is_all_day=spec.is_all_day,
            timezone=ctx.timezone,
            location=spec.location,
            attendee_ids=await resolve_member_ids(ctx.session, ctx.organization_id, spec.attendees),
            recurrence_pattern=spec.recurrence_pattern,
            recurrence_config=spec.recurrence_config,
            tag_ids=tag_ids_for(tag_ids, spec.tags),
            room_id=room_id,
        )
        registry.register(EVENT, spec.title, event.id)
        result.created += 1
        logger.info(f"Created event {spec.title!r} at {start.isoformat()}")

    return result


async def apply_event_mentions(
    ctx: DemoContext,
    events: tuple[EventSpec, ...],
    registry: MentionRegistry,
) -> int:
    """Rewrite event descriptions into mentions once every URN is registered."""
    if ctx.dry_run:
        return 0

    ops = CalendarEventOperations(ctx.session)
    updated = 0

    for spec in events:
        linked = registry.rewrite(spec.description, source=spec.title)
        if linked == spec.description:
            continue

        start = ctx.local_datetime(spec.day_offset, spec.start)
        event_id = await _find_event_id(ctx, spec.title, start)
        if event_id is None:
            continue

        await ops.update(
            user_id=ctx.actor_id,
            organization_id=ctx.organization_id,
            event_id=event_id,
            description=linked,
        )
        updated += 1
        logger.info(f"Linked mentions in event {spec.title!r}")

    return updated


async def _room_ids(ctx: DemoContext) -> dict[str, UUID]:
    rows = (
        await ctx.session.execute(
            select(Room.name, Room.id).where(
                Room.organization_id == ctx.organization_id,
                Room.is_deleted == False,  # noqa: E712
            )
        )
    ).all()
    return {row.name: row.id for row in rows}


async def _find_event_id(ctx: DemoContext, title: str, start: datetime) -> UUID | None:
    return (
        (
            await ctx.session.execute(
                select(CalendarEvent.id).where(
                    CalendarEvent.organization_id == ctx.organization_id,
                    CalendarEvent.title == title,
                    CalendarEvent.start_time == start,
                    CalendarEvent.is_deleted == False,  # noqa: E712
                )
            )
        )
        .scalars()
        .first()
    )
