"""Mirror one round of provider changes onto a connected calendar, keeping one event per meeting."""

import hashlib
from collections.abc import Iterable
from dataclasses import dataclass, field, replace
from datetime import UTC, date, datetime
from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import delete, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.json_codec import OPTION_SORT_KEYS, dumps_bytes
from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.connection import CalendarConnection, ConnectedCalendar
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.calendar.exception import RecurrenceException
from uniffy.core.models.calendar.link import CalendarEventLink
from uniffy.core.models.calendar.participant import CalendarEventParticipant
from uniffy.core.models.calendar.provider_push import (
    CalendarProviderPush,
    PushOperation,
    PushState,
)
from uniffy.core.models.shared import AttendeeRole, AttendeeStatus
from uniffy.core.types import AccessMode, RecurrencePattern
from uniffy.domains.scheduling.calendar.connections.identity import normalize_uid
from uniffy.domains.scheduling.calendar.connections.normalize import (
    ChangeBatch,
    ItemKind,
    ProviderEvent,
)
from uniffy.domains.scheduling.calendar.connections.people import PeopleSync, own_status
from uniffy.domains.scheduling.calendar.connections.recurrence import series_rule

logger = logger.bind(component="scheduling.calendar.connections.sync")

_TITLE_LIMIT = 500
_LOCATION_LIMIT = 500
_URL_LIMIT = 2000
_UNTITLED = "(untitled)"

# Columns a provider change rewrites in place, so the event keeps its id and any open view.
_MUTABLE_COLUMNS = (
    "title",
    "description",
    "start_time",
    "end_time",
    "is_all_day",
    "timezone",
    "location",
    "meeting_url",
    "status",
    "visibility",
    "transparency",
    "is_out_of_office",
    "is_focus_time",
    "recurrence_pattern",
    "recurrence_config",
)


@dataclass(frozen=True)
class SyncTargetRow:
    """The connected calendar a round writes into, read under its lock."""

    connected_calendar_id: UUID
    organization_id: UUID
    owner_id: UUID
    calendar_id: UUID


@dataclass
class SyncOutcome:
    created: int = 0
    updated: int = 0
    deleted: int = 0
    unchanged: int = 0
    # A removal for an id never linked: on Graph that is a plain occurrence, so rescan.
    unknown_removals: int = 0
    written_ids: list[UUID] = field(default_factory=list)
    removed_ids: list[UUID] = field(default_factory=list)

    @property
    def changed(self) -> bool:
        return bool(self.created or self.updated or self.deleted)


def fingerprint(item: ProviderEvent) -> str:
    """What the item would store; the etag and update stamp move on echoes and are left out."""
    stable = replace(item, etag=None, updated_at=None, sequence=None)
    return hashlib.sha256(dumps_bytes(stable, option=OPTION_SORT_KEYS)).hexdigest()


class _Round:
    def __init__(
        self,
        session: AsyncSession,
        target: SyncTargetRow,
        members: dict[str, UUID],
        scan_id: UUID | None,
    ) -> None:
        self.session = session
        self.target = target
        self.members = members
        self.scan_id = scan_id
        self.outcome = SyncOutcome()
        self.links: dict[str, CalendarEventLink] = {}
        self.people = PeopleSync(session, target.organization_id, target.owner_id, members)

    async def load_links(self) -> None:
        rows = (
            await self.session.execute(
                select(CalendarEventLink).where(
                    CalendarEventLink.connected_calendar_id == self.target.connected_calendar_id
                )
            )
        ).scalars()
        self.links = {row.provider_event_id: row for row in rows}

    def _touch(self, link: CalendarEventLink, item: ProviderEvent, digest: str | None) -> None:
        link.etag = item.etag[:500] if item.etag else link.etag
        link.provider_updated_at = item.updated_at or link.provider_updated_at
        link.provider_sequence = (
            item.sequence if item.sequence is not None else link.provider_sequence
        )
        if digest is not None:
            link.content_fingerprint = digest
        if self.scan_id is not None:
            link.last_scan_id = self.scan_id

    async def apply(self, batch: ChangeBatch) -> None:
        order = (
            ItemKind.SINGLE,
            ItemKind.MASTER,
            ItemKind.OCCURRENCE,
            ItemKind.CANCELLED_OCCURRENCE,
        )
        for kind in order:
            for item in batch.items:
                if item.kind != kind:
                    continue
                if item.kind == ItemKind.MASTER and item.provider_event_id in batch.mirrored:
                    await self._mirror(item, batch.mirrored[item.provider_event_id])
                elif item.kind in (ItemKind.SINGLE, ItemKind.MASTER):
                    await self._upsert_series(item)
                elif item.kind == ItemKind.OCCURRENCE:
                    await self._upsert_occurrence(item)
                else:
                    await self._cancel_occurrence(item)
        for series_id in batch.complete_series:
            await self._trim_series(series_id, batch)
        for item in batch.items:
            if item.kind == ItemKind.REMOVED:
                await self._remove(item.provider_event_id)

    async def _upsert_series(self, item: ProviderEvent) -> None:
        digest = fingerprint(item)
        link = self.links.get(item.provider_event_id)
        if link is not None:
            if not link.is_owner_link:
                await self.people.respond_as_attendee(link.event_id, item)
                self._touch(link, item, digest)
                return
            if link.content_fingerprint == digest:
                # Our own push coming back, or a change to fields we do not keep.
                self.outcome.unchanged += 1
                self._touch(link, item, None)
                return
            if await self._outbound_pending(link.event_id):
                # A Uniffy edit is on its way; its push compares both and the later one wins.
                # The old etag stays, so that push sees the provider moved on.
                if self.scan_id is not None:
                    link.last_scan_id = self.scan_id
                self.outcome.unchanged += 1
                return
            await self._rewrite(link.event_id, item)
            await self._apply_exdates(link.event_id, item)
            self._touch(link, item, digest)
            self.outcome.updated += 1
            self.outcome.written_ids.append(link.event_id)
            return

        uid = normalize_uid(item.ical_uid)
        held = await self._held_elsewhere(uid) if uid else None
        if held is not None:
            await self._attach_copy(held, item, uid, digest)
            return
        event = await self._revived(uid) if uid else None
        if event is None:
            event = self._new_event(item, uid)
            self.session.add(event)
            await self.session.flush()
        else:
            await self._rewrite(event.id, item)
        link = CalendarEventLink(
            organization_id=self.target.organization_id,
            connected_calendar_id=self.target.connected_calendar_id,
            event_id=event.id,
            provider_event_id=item.provider_event_id[:500],
            ical_uid=uid,
            is_owner_link=True,
            is_organizer_copy=item.is_organizer,
        )
        self._touch(link, item, digest)
        self.session.add(link)
        self.links[item.provider_event_id] = link
        # Uniffy lists an event's organizer as its first attendee; free/busy counts on it.
        await self.people.ensure_attendee(
            event.id,
            self.target.owner_id,
            own_status(item, AttendeeStatus.ACCEPTED),
            AttendeeRole.ORGANIZER,
        )
        await self.people.sync(event.id, item)
        await self._apply_exdates(event.id, item)
        self.outcome.created += 1
        self.outcome.written_ids.append(event.id)

    async def _apply_exdates(self, master_id: UUID, item: ProviderEvent) -> None:
        """Dates the rule itself skips; moved and cancelled instances arrive as their own items."""
        if item.kind != ItemKind.MASTER:
            return
        rule = series_rule(item)
        if rule is None:
            return
        for day in rule[1]:
            if await self._exception(master_id, day) is None:
                self.session.add(
                    RecurrenceException(event_id=master_id, original_date=day, is_cancelled=True)
                )

    async def _outbound_pending(self, event_id: UUID) -> bool:
        found = await self.session.scalar(
            select(CalendarProviderPush.id)
            .where(
                CalendarProviderPush.event_id == event_id,
                CalendarProviderPush.connected_calendar_id == self.target.connected_calendar_id,
                CalendarProviderPush.operation == PushOperation.UPSERT,
                # Not one in flight: that push is already comparing, or is this very write.
                CalendarProviderPush.state == PushState.PENDING,
            )
            .limit(1)
        )
        return found is not None

    async def _revived(self, uid: str) -> CalendarEvent | None:
        """An event deleted here that the provider brought back: a calendar holds a UID once."""
        event = await self.session.scalar(
            select(CalendarEvent)
            .where(
                CalendarEvent.calendar_id == self.target.calendar_id,
                CalendarEvent.ical_uid == uid,
                CalendarEvent.is_deleted.is_(True),
            )
            .with_for_update()
        )
        if event is not None:
            event.is_deleted = False
            event.deleted_at = None
        return event

    async def _held_elsewhere(self, uid: str) -> CalendarEvent | None:
        """The same meeting already mirrored from another member's account in this organization.

        A UID alone proves nothing: anyone can import an event under a copied UID. The held
        copy must already list this member, so only a real guest joins it.
        """
        owner = self.target.owner_id
        listed = or_(
            select(CalendarEventParticipant.id)
            .where(
                CalendarEventParticipant.event_id == CalendarEvent.id,
                CalendarEventParticipant.user_id == owner,
            )
            .exists(),
            select(EventAttendee.id)
            .where(EventAttendee.event_id == CalendarEvent.id, EventAttendee.user_id == owner)
            .exists(),
        )
        return await self.session.scalar(
            select(CalendarEvent)
            .join(CalendarEventLink, CalendarEventLink.event_id == CalendarEvent.id)
            .where(
                CalendarEvent.organization_id == self.target.organization_id,
                CalendarEvent.ical_uid == uid,
                CalendarEvent.recurrence_id.is_(None),
                CalendarEvent.is_deleted.is_(False),
                CalendarEventLink.is_owner_link.is_(True),
                listed,
            )
            .limit(1)
            .with_for_update(of=CalendarEvent)
        )

    async def _listed_as_organizer(self, event_id: UUID) -> bool:
        """The held copy names this member as the meeting's organizer."""
        found = await self.session.scalar(
            select(CalendarEventParticipant.id)
            .where(
                CalendarEventParticipant.event_id == event_id,
                CalendarEventParticipant.user_id == self.target.owner_id,
                CalendarEventParticipant.is_organizer.is_(True),
            )
            .limit(1)
        )
        return found is not None

    async def _attach_copy(
        self, event: CalendarEvent, item: ProviderEvent, uid: str | None, digest: str
    ) -> None:
        owner_link = await self.session.scalar(
            select(CalendarEventLink)
            .where(
                CalendarEventLink.event_id == event.id,
                CalendarEventLink.is_owner_link.is_(True),
            )
            .with_for_update()
        )
        promote = (
            item.is_organizer
            and owner_link is not None
            and not owner_link.is_organizer_copy
            and await self._listed_as_organizer(event.id)
        )
        link = CalendarEventLink(
            organization_id=self.target.organization_id,
            connected_calendar_id=self.target.connected_calendar_id,
            event_id=event.id,
            provider_event_id=item.provider_event_id[:500],
            ical_uid=uid,
            is_owner_link=promote,
            is_organizer_copy=item.is_organizer,
        )
        self._touch(link, item, digest)
        self.session.add(link)
        self.links[item.provider_event_id] = link
        if promote and owner_link is not None:
            await self._promote(event, owner_link, item)
            self.outcome.updated += 1
        else:
            # The provider proves this member holds the meeting.
            await self.people.respond_as_attendee(event.id, item)
        self.outcome.written_ids.append(event.id)

    async def _promote(
        self, event: CalendarEvent, previous: CalendarEventLink, item: ProviderEvent
    ) -> None:
        """The organizer's own copy takes the event over from an attendee's copy."""
        previous.is_owner_link = False
        former_owner = event.organizer_id
        event.calendar_id = self.target.calendar_id
        event.organizer_id = self.target.owner_id
        await self.session.execute(
            update(CalendarEvent)
            .where(CalendarEvent.recurrence_id == event.id)
            .values(calendar_id=self.target.calendar_id, organizer_id=self.target.owner_id)
        )
        await self.people.ensure_attendee(
            event.id, former_owner, AttendeeStatus.ACCEPTED, AttendeeRole.REQUIRED
        )
        await self.people.ensure_attendee(
            event.id, self.target.owner_id, AttendeeStatus.ACCEPTED, AttendeeRole.ORGANIZER
        )
        # Writes queued against the old owner's copy would now overwrite the organizer's.
        await self.session.execute(
            delete(CalendarProviderPush).where(
                CalendarProviderPush.event_id == event.id,
                CalendarProviderPush.connected_calendar_id == previous.connected_calendar_id,
                CalendarProviderPush.state == PushState.PENDING,
            )
        )
        await self._rewrite(event.id, item)

    def _columns(self, item: ProviderEvent) -> dict[str, Any]:
        start = item.start_time or datetime.now(UTC)
        end = item.end_time or start
        pattern = RecurrencePattern.NONE
        config = None
        if item.kind == ItemKind.MASTER:
            rule = series_rule(item)
            if rule is not None:
                pattern = rule[0].pattern
                config = rule[0].config
        meeting = (
            item.meeting_url if item.meeting_url and len(item.meeting_url) <= _URL_LIMIT else None
        )
        return {
            "title": (item.title or _UNTITLED)[:_TITLE_LIMIT],
            "description": item.description,
            "start_time": start,
            "end_time": max(end, start),
            "is_all_day": item.is_all_day,
            "timezone": item.timezone or "UTC",
            "location": item.location[:_LOCATION_LIMIT],
            "meeting_url": meeting,
            "status": item.status,
            "visibility": item.visibility,
            "transparency": item.transparency,
            "is_out_of_office": item.is_out_of_office,
            "is_focus_time": item.is_focus_time,
            "recurrence_pattern": pattern,
            "recurrence_config": config,
        }

    def _new_event(
        self,
        item: ProviderEvent,
        uid: str | None,
        *,
        recurrence_id: UUID | None = None,
        organizer_id: UUID | None = None,
        calendar_id: UUID | None = None,
    ) -> CalendarEvent:
        return CalendarEvent(
            organization_id=self.target.organization_id,
            organizer_id=organizer_id or self.target.owner_id,
            calendar_id=calendar_id or self.target.calendar_id,
            access_mode=AccessMode.OWNER_ONLY,
            recurrence_id=recurrence_id,
            ical_uid=uid if recurrence_id is None else None,
            **self._columns(item),
        )

    async def _rewrite(self, event_id: UUID, item: ProviderEvent) -> None:
        columns = self._columns(item)
        if item.kind == ItemKind.OCCURRENCE:
            columns.pop("recurrence_pattern")
            columns.pop("recurrence_config")
        await self.session.execute(
            update(CalendarEvent)
            .where(CalendarEvent.id == event_id)
            .values(
                **{key: columns[key] for key in _MUTABLE_COLUMNS if key in columns},
                ical_sequence=CalendarEvent.ical_sequence + 1,
                updated_at=datetime.now(UTC),
            )
        )
        await self.people.sync(event_id, item)

    async def _master_link(self, series_id: str | None) -> CalendarEventLink | None:
        if not series_id:
            return None
        link = self.links.get(series_id)
        return link if link is not None and link.occurrence_key is None else None

    async def _upsert_occurrence(self, item: ProviderEvent) -> None:
        master_link = await self._master_link(item.series_id)
        if master_link is None or item.original_date is None:
            return
        digest = fingerprint(item)
        link = self.links.get(item.provider_event_id)
        if not master_link.is_owner_link:
            if link is None:
                await self.people.respond_as_attendee(master_link.event_id, item)
            return
        if link is not None:
            if link.content_fingerprint == digest:
                self.outcome.unchanged += 1
                self._touch(link, item, None)
                return
            await self._rewrite(link.event_id, item)
            self._touch(link, item, digest)
            self.outcome.updated += 1
            self.outcome.written_ids.append(link.event_id)
            return
        master = await self.session.get(CalendarEvent, master_link.event_id)
        if master is None:
            return
        await self._drop_exception(master.id, item.original_date)
        override = self._new_event(
            item,
            None,
            recurrence_id=master.id,
            organizer_id=master.organizer_id,
            calendar_id=master.calendar_id,
        )
        self.session.add(override)
        await self.session.flush()
        self.session.add(
            RecurrenceException(
                event_id=master.id,
                original_date=item.original_date,
                is_cancelled=True,
                override_event_id=override.id,
            )
        )
        link = CalendarEventLink(
            organization_id=self.target.organization_id,
            connected_calendar_id=self.target.connected_calendar_id,
            event_id=override.id,
            provider_event_id=item.provider_event_id[:500],
            provider_series_id=item.series_id,
            is_owner_link=True,
            is_organizer_copy=item.is_organizer,
        )
        self._touch(link, item, digest)
        self.session.add(link)
        self.links[item.provider_event_id] = link
        await self.people.sync(override.id, item)
        self.outcome.updated += 1
        self.outcome.written_ids.append(override.id)

    async def _cancel_occurrence(self, item: ProviderEvent) -> None:
        master_link = await self._master_link(item.series_id)
        if master_link is None or not master_link.is_owner_link or item.original_date is None:
            return
        existing = await self._exception(master_link.event_id, item.original_date)
        if existing is not None and existing.override_event_id is None:
            self.outcome.unchanged += 1
            return
        await self._drop_exception(master_link.event_id, item.original_date)
        self.session.add(
            RecurrenceException(
                event_id=master_link.event_id, original_date=item.original_date, is_cancelled=True
            )
        )
        self.outcome.updated += 1
        self.outcome.written_ids.append(master_link.event_id)

    async def _exception(self, master_id: UUID, day: date) -> RecurrenceException | None:
        return await self.session.scalar(
            select(RecurrenceException).where(
                RecurrenceException.event_id == master_id,
                RecurrenceException.original_date == day,
            )
        )

    async def _drop_exception(self, master_id: UUID, day: date) -> None:
        existing = await self._exception(master_id, day)
        if existing is None:
            return
        override_id = existing.override_event_id
        await self.session.delete(existing)
        await self.session.flush()
        if override_id is not None:
            await self._delete_events([override_id])

    async def _trim_series(self, series_id: str, batch: ChangeBatch) -> None:
        """Exceptions stored for a series but absent from its complete snapshot are stale."""
        master_link = await self._master_link(series_id)
        if master_link is None or not master_link.is_owner_link:
            return
        kept = {
            item.original_date
            for item in batch.items
            if item.series_id == series_id and item.original_date is not None
        }
        stale = (
            await self.session.execute(
                select(RecurrenceException.original_date).where(
                    RecurrenceException.event_id == master_link.event_id
                )
            )
        ).scalars()
        for day in [day for day in stale if day not in kept]:
            await self._drop_exception(master_link.event_id, day)
            self.outcome.updated += 1

    async def _mirror(self, master: ProviderEvent, instances: Iterable[ProviderEvent]) -> None:
        """A rule Uniffy cannot express: each instance becomes its own read-only event."""
        seen: set[str] = set()
        uid = normalize_uid(master.ical_uid)
        for instance in instances:
            if instance.start_time is None:
                continue
            seen.add(instance.provider_event_id)
            digest = fingerprint(instance)
            link = self.links.get(instance.provider_event_id)
            if link is not None:
                if link.content_fingerprint != digest and link.is_owner_link:
                    await self._rewrite(link.event_id, replace(instance, kind=ItemKind.SINGLE))
                    self.outcome.updated += 1
                    self.outcome.written_ids.append(link.event_id)
                self._touch(link, instance, digest)
                continue
            event = self._new_event(replace(instance, kind=ItemKind.SINGLE), None)
            event.is_mirrored_occurrence = True
            self.session.add(event)
            await self.session.flush()
            day = instance.original_date or instance.start_time.date()
            link = CalendarEventLink(
                organization_id=self.target.organization_id,
                connected_calendar_id=self.target.connected_calendar_id,
                event_id=event.id,
                provider_event_id=instance.provider_event_id[:500],
                provider_series_id=master.provider_event_id[:500],
                occurrence_key=day.isoformat(),
                ical_uid=uid,
                is_owner_link=True,
                is_organizer_copy=master.is_organizer,
            )
            self._touch(link, instance, digest)
            self.session.add(link)
            self.links[instance.provider_event_id] = link
            await self.people.ensure_attendee(
                event.id,
                self.target.owner_id,
                own_status(instance, AttendeeStatus.ACCEPTED),
                AttendeeRole.ORGANIZER,
            )
            await self.people.sync(event.id, instance)
            self.outcome.created += 1
            self.outcome.written_ids.append(event.id)
        stale = [
            link
            for link in self.links.values()
            if link.provider_series_id == master.provider_event_id
            and link.occurrence_key is not None
            and link.provider_event_id not in seen
        ]
        for link in stale:
            await self._remove(link.provider_event_id)

    async def _remove(self, provider_event_id: str) -> None:
        link = self.links.pop(provider_event_id, None)
        if link is None:
            self.outcome.unknown_removals += 1
            return
        if not link.is_owner_link:
            await self.people.ensure_attendee(
                link.event_id, self.target.owner_id, AttendeeStatus.DECLINED
            )
            await self.session.delete(link)
            self.outcome.written_ids.append(link.event_id)
            return
        event_id = link.event_id
        await self.session.delete(link)
        await self.session.flush()
        if link.provider_series_id and link.occurrence_key is None:
            # A moved occurrence went away: the series falls back to its rule for that date.
            await self.session.execute(
                delete(RecurrenceException).where(RecurrenceException.override_event_id == event_id)
            )
            await self._delete_events([event_id])
            self.outcome.updated += 1
            return
        # Another member's copy takes over, so the meeting stays for everyone still in it.
        heir = await self.session.scalar(
            select(CalendarEventLink)
            .where(CalendarEventLink.event_id == event_id)
            .order_by(CalendarEventLink.is_organizer_copy.desc(), CalendarEventLink.created_at)
            .limit(1)
            .with_for_update()
        )
        if heir is not None:
            heir.is_owner_link = True
            await self._hand_over(event_id, heir)
            self.outcome.updated += 1
            self.outcome.written_ids.append(event_id)
            return
        await self._delete_events([event_id], with_occurrences=True)
        self.outcome.deleted += 1

    async def _hand_over(self, event_id: UUID, heir: CalendarEventLink) -> None:
        """The meeting moves to the calendar of the member whose copy now carries it."""
        home = (
            await self.session.execute(
                select(ConnectedCalendar.calendar_id, CalendarConnection.owner_id)
                .join(CalendarConnection, CalendarConnection.id == ConnectedCalendar.connection_id)
                .where(ConnectedCalendar.id == heir.connected_calendar_id)
            )
        ).first()
        if home is None or home.calendar_id is None:
            return
        await self.session.execute(
            update(CalendarEvent)
            .where(or_(CalendarEvent.id == event_id, CalendarEvent.recurrence_id == event_id))
            .values(calendar_id=home.calendar_id, organizer_id=home.owner_id)
        )
        # The departing owner removed it from their own calendar: they no longer attend.
        await self.people.ensure_attendee(
            event_id, self.target.owner_id, AttendeeStatus.DECLINED, AttendeeRole.REQUIRED
        )
        await self.people.ensure_attendee(
            event_id, home.owner_id, AttendeeStatus.ACCEPTED, AttendeeRole.ORGANIZER
        )

    async def _delete_events(self, event_ids: list[UUID], *, with_occurrences: bool = False) -> None:
        """Soft-deleted like any removal, so the trash can still bring an event back."""
        now = datetime.now(UTC)
        ids = list(event_ids)
        if with_occurrences:
            ids += list(
                (
                    await self.session.execute(
                        select(CalendarEvent.id).where(CalendarEvent.recurrence_id.in_(event_ids))
                    )
                ).scalars()
            )
        await self.session.execute(
            update(CalendarEvent)
            .where(CalendarEvent.id.in_(ids), CalendarEvent.is_deleted.is_(False))
            .values(is_deleted=True, deleted_at=now, updated_at=now)
        )
        await self.session.execute(
            delete(CalendarEventLink).where(CalendarEventLink.event_id.in_(ids))
        )
        self.outcome.removed_ids.extend(ids)

    async def sweep(self, window_start: datetime) -> None:
        """After a full snapshot: every owner link it did not mention is gone from the provider."""
        stale = [link for link in list(self.links.values()) if link.last_scan_id != self.scan_id]
        if not stale:
            return
        # The snapshot only reaches back to the window; older events are not evidence of removal.
        in_window = set(
            (
                await self.session.execute(
                    select(CalendarEvent.id).where(
                        CalendarEvent.id.in_([link.event_id for link in stale]),
                        (CalendarEvent.end_time >= window_start)
                        | (CalendarEvent.recurrence_pattern != RecurrencePattern.NONE),
                    )
                )
            ).scalars()
        )
        for link in stale:
            if link.event_id in in_window:
                await self._remove(link.provider_event_id)


async def stage_provider_changes(
    session: AsyncSession,
    target: SyncTargetRow,
    batch: ChangeBatch,
    *,
    members: dict[str, UUID],
    scan_id: UUID | None,
    window_start: datetime,
) -> SyncOutcome:
    """Write one round; the caller holds the connected calendar's lock and commits."""
    sync_round = _Round(session, target, members, scan_id if batch.full_scan else None)
    await sync_round.load_links()
    await sync_round.apply(batch)
    if batch.full_scan:
        await sync_round.sweep(window_start)
    await session.flush()
    return sync_round.outcome
