"""Clearing the way for events that change calendar."""

from uuid import UUID

from sqlalchemy import Select, and_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from uniffy.core.errors import ValidationError
from uniffy.core.models.calendar.event import CalendarEvent


async def stage_ical_uid_release(
    session: AsyncSession,
    organization_id: UUID,
    moving_ids: Select,
    target_calendar_id: UUID,
) -> None:
    """Free imported identities that would collide on the target calendar.

    An imported UID is unique per calendar, deleted rows included, so a moved
    event whose UID the target already holds would break the move. A deleted row
    on either side gives its UID up; two live copies of one import cannot share a
    calendar, and the member has to remove one first.
    """
    source = aliased(CalendarEvent)
    target = aliased(CalendarEvent)
    collisions = (
        await session.execute(
            select(source.id, source.is_deleted, target.id, target.is_deleted)
            .select_from(source)
            .join(
                target,
                and_(
                    target.organization_id == organization_id,
                    target.calendar_id == target_calendar_id,
                    target.ical_uid == source.ical_uid,
                    target.id != source.id,
                ),
            )
            .where(
                source.organization_id == organization_id,
                source.ical_uid.is_not(None),
                source.id.in_(moving_ids),
            )
        )
    ).all()
    if not collisions:
        return

    released: set[UUID] = set()
    live_clashes = 0
    for source_id, source_deleted, target_id, target_deleted in collisions:
        if source_deleted:
            released.add(source_id)
        elif target_deleted:
            released.add(target_id)
        else:
            live_clashes += 1
    if live_clashes:
        raise ValidationError(
            "target_calendar_id",
            f"{live_clashes} imported {'event is' if live_clashes == 1 else 'events are'} "
            "already on the target calendar. Delete the duplicates first.",
        )
    await session.execute(
        update(CalendarEvent)
        .where(CalendarEvent.organization_id == organization_id, CalendarEvent.id.in_(released))
        .values(ical_uid=None)
    )
