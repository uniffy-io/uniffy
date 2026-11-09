"""Deliver one queued Uniffy change to a provider calendar, resolving conflicts by the later edit."""

import hashlib
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from urllib.parse import urlsplit
from uuid import UUID

from loguru import logger
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.json_codec import dumps_str
from uniffy.core.models.calendar.activity import EventActivity
from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.connection import (
    CalendarProvider,
    ConnectedCalendar,
    SyncFailure,
)
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.calendar.exception import RecurrenceException
from uniffy.core.models.calendar.link import CalendarEventLink
from uniffy.core.models.calendar.participant import CalendarEventParticipant
from uniffy.core.models.calendar.provider_push import (
    PushOperation,
    PushState,
)
from uniffy.core.models.login.user import User
from uniffy.core.models.shared import AttendeeRole, AttendeeStatus
from uniffy.core.search.indexer import SearchIndexer, build_content_urn
from uniffy.core.types import ContentType
from uniffy.domains.scheduling.calendar.connections.clients import ProviderClient, client_for
from uniffy.domains.scheduling.calendar.connections.credentials import (
    resolve_provider_credentials,
)
from uniffy.domains.scheduling.calendar.connections.identity import member_emails, normalize_uid
from uniffy.domains.scheduling.calendar.connections.normalize import ChangeBatch, ProviderEvent
from uniffy.domains.scheduling.calendar.connections.notices import (
    PROVIDER_LABELS,
    stage_conflict_notice,
    wake_outbox,
)
from uniffy.domains.scheduling.calendar.connections.outbox import PROVIDER_SYNC_FLAG
from uniffy.domains.scheduling.calendar.connections.payloads import (
    OutboundEvent,
    google_body,
    graph_body,
    guests_of,
)
from uniffy.domains.scheduling.calendar.connections.providers.base import (
    PreconditionFailed,
    ProviderError,
    ReauthRequired,
)
from uniffy.domains.scheduling.calendar.connections.push_state import (
    REAUTH_WAIT,
    PushClaim,
    PushTarget,
    claim_push,
    failure_of,
    finish_push,
    held_for_pause,
    push_target,
    refused_push,
    retry_push,
)
from uniffy.domains.scheduling.calendar.connections.run import publish_calendar_changed
from uniffy.domains.scheduling.calendar.connections.sync import (
    SyncTargetRow,
    fingerprint,
    stage_provider_changes,
)
from uniffy.domains.scheduling.calendar.connections.tokens import (
    ConnectionGone,
    access_token_for,
)
from uniffy.domains.scheduling.calendar.search import refresh_event_search_projection
from uniffy.infrastructure.outbound import ApiError

logger = logger.bind(component="scheduling.calendar.connections.push")

CONFLICT_ACTION = "sync_conflict"
# Links on these hosts are the provider's own meeting; the description must not repeat them.
_PROVIDER_MEETING_HOSTS = frozenset({"meet.google.com", "teams.microsoft.com", "teams.live.com"})
_RSVP_WORDS = {
    AttendeeStatus.ACCEPTED: "accepted",
    AttendeeStatus.TENTATIVE: "tentative",
    AttendeeStatus.DECLINED: "declined",
}
_COMPARED = ("title", "start_time", "end_time", "location", "description", "status")


def provider_event_key(event_id: UUID, connected_calendar_id: UUID) -> str:
    """The same Uniffy event on the same calendar always asks for the same provider id."""
    return hashlib.sha256(f"{event_id}:{connected_calendar_id}".encode()).hexdigest()[:32]


async def run_push(
    session: AsyncSession, push_id: UUID, generation: int, search_indexer: SearchIndexer
) -> dict[str, object]:
    claim = await claim_push(session, push_id, generation)
    if claim is None:
        return {"status": "skipped"}
    target = await push_target(session, claim)
    if target is None:
        if await held_for_pause(session, claim):
            return {"status": "paused"}
        await finish_push(session, claim, PushState.DONE, error="dropped")
        return {"status": "dropped"}
    try:
        access = await access_token_for(session, target.connection_id, claim.generation)
    except ConnectionGone:
        await finish_push(session, claim, PushState.FAILED, error="connection_changed")
        return {"status": "dropped"}
    except ReauthRequired:
        await retry_push(session, claim, SyncFailure.REAUTH_REQUIRED, wait=REAUTH_WAIT)
        return {"status": "waiting", "failure": SyncFailure.REAUTH_REQUIRED.value}
    except (ProviderError, ApiError) as exc:
        await retry_push(session, claim, failure_of(exc))
        return {"status": "retry"}

    credentials = await resolve_provider_credentials(session, claim.organization_id, target.provider)
    await session.rollback()
    if credentials is None:
        await retry_push(session, claim, SyncFailure.REAUTH_REQUIRED, wait=REAUTH_WAIT)
        return {"status": "waiting"}
    client = client_for(credentials)
    delivery = _Delivery(
        session, client, access.token, access.account_email, claim, target, search_indexer
    )
    try:
        state = await delivery.deliver()
    except ProviderError as exc:
        return await refused_push(session, claim, target, exc)
    except ApiError as exc:
        await retry_push(session, claim, SyncFailure.UNREACHABLE)
        return {"status": "retry", "reason": exc.reason}
    await finish_push(session, claim, state)
    if target.calendar_id is not None and delivery.changed_locally:
        await publish_calendar_changed(target.calendar_id, claim.organization_id)
    logger.info(
        "Calendar change pushed",
        push_id=str(claim.push_id),
        operation=claim.operation.value,
        provider=target.provider.value,
        state=state.value,
    )
    return {"status": state.value.lower()}


class ConflictWinner(StrEnum):
    """Whose version a sync conflict kept; the activity names the other as replaced."""

    UNIFFY = "uniffy"
    PROVIDER = "provider"


class _Delivery:
    def __init__(
        self,
        session: AsyncSession,
        client: ProviderClient,
        token: str,
        self_email: str,
        claim: PushClaim,
        target: PushTarget,
        search_indexer: SearchIndexer,
    ) -> None:
        self.session = session
        self.client = client
        self.token = token
        self.self_email = self_email
        self.claim = claim
        self.target = target
        self.search_indexer = search_indexer
        self.changed_locally = False

    async def deliver(self) -> PushState:
        operation = self.claim.operation
        if operation == PushOperation.DELETE:
            return await self._delete()
        if operation == PushOperation.RSVP:
            return await self._rsvp()
        if operation in (PushOperation.UPSERT_OCCURRENCE, PushOperation.DELETE_OCCURRENCE):
            return await self._occurrence()
        return await self._upsert()

    def _body(self, outbound: OutboundEvent, *, occurrence: bool = False) -> dict:
        if self.target.provider == CalendarProvider.GOOGLE:
            return google_body(outbound, occurrence=occurrence)
        return graph_body(outbound, occurrence=occurrence)

    async def _link(self, event_id: UUID) -> CalendarEventLink | None:
        return await self.session.scalar(
            select(CalendarEventLink).where(
                CalendarEventLink.event_id == event_id,
                CalendarEventLink.connected_calendar_id == self.claim.connected_calendar_id,
            )
        )

    async def _outbound(self, event: CalendarEvent) -> OutboundEvent:
        owner = self.target.owner_id
        attendees = (
            await self.session.execute(
                select(EventAttendee.user_id, User.email, User.full_name, EventAttendee.role)
                .join(User, User.id == EventAttendee.user_id)
                # The owner is the account itself, never a guest of their own event.
                .where(EventAttendee.event_id == event.id, EventAttendee.user_id != owner)
            )
        ).all()
        rows = [
            row
            for row in (
                await self.session.execute(
                    select(CalendarEventParticipant).where(
                        CalendarEventParticipant.event_id == event.id
                    )
                )
            ).scalars()
            if row.email.lower() != self.self_email
        ]
        # A member keeps the address the provider lists them under, which need not be
        # their Uniffy email (another account of theirs, an alias).
        listed: dict[UUID, list[str]] = {}
        for row in rows:
            if row.user_id is not None:
                listed.setdefault(row.user_id, []).append(row.email.lower())
        members = [
            (address, name, role == AttendeeRole.OPTIONAL)
            for user_id, email, name, role in attendees
            for address in listed.get(user_id) or [email.lower()]
            if address != self.self_email
        ]
        # Outside guests as the provider sent them, and the owner's other addresses.
        participants = [row for row in rows if row.user_id is None or row.user_id == owner]
        cancelled = (
            await self.session.execute(
                select(RecurrenceException.original_date).where(
                    RecurrenceException.event_id == event.id,
                    RecurrenceException.override_event_id.is_(None),
                )
            )
        ).scalars()
        host = urlsplit(event.meeting_url).hostname if event.meeting_url else None
        return OutboundEvent(
            event=event,
            guests=guests_of(members, participants),
            cancelled_dates=tuple(sorted(cancelled)),
            provider_conference=host in _PROVIDER_MEETING_HOSTS,
        )

    async def _upsert(self) -> PushState:
        event = await self.session.get(CalendarEvent, self.claim.event_id)
        if event is None or event.is_deleted:
            return PushState.DONE
        link = await self._link(event.id)
        outbound = await self._outbound(event)
        body = self._body(outbound)
        local_updated = event.updated_at or event.created_at
        # Read before the rollback, which expires every loaded row.
        linked = (link.provider_event_id, link.etag) if link is not None else None
        await self.session.rollback()
        if linked is None:
            created = await self.client.create_event(
                self.token,
                self.target.provider_calendar_id,
                body,
                idempotency_key=provider_event_key(
                    self.claim.event_id, self.claim.connected_calendar_id
                ),
                self_email=self.self_email,
            )
            await self._store_created(created)
            return PushState.DONE
        provider_event_id, etag = linked
        try:
            if self.target.provider == CalendarProvider.GOOGLE:
                current = await self.client.get_event(
                    self.token, self.target.provider_calendar_id, provider_event_id, self.self_email
                )
                if current is None:
                    return PushState.DONE
                if current.etag != etag:
                    return await self._conflict(current, body, local_updated)
            written = await self.client.update_event(
                self.token,
                self.target.provider_calendar_id,
                provider_event_id,
                body,
                etag=etag,
                self_email=self.self_email,
            )
        except PreconditionFailed:
            current = await self.client.get_event(
                self.token, self.target.provider_calendar_id, provider_event_id, self.self_email
            )
            if current is None:
                return PushState.DONE
            return await self._conflict(current, body, local_updated)
        await self._store_echo(provider_event_id, written)
        return PushState.DONE

    async def _conflict(
        self, current: ProviderEvent, body: dict, local_updated: datetime
    ) -> PushState:
        """The later edit wins; on a tie the provider does. The loser is kept in the activity."""
        provider_updated = current.updated_at
        event = await self.session.get(CalendarEvent, self.claim.event_id)
        if event is None:
            return PushState.DONE
        ours = {field: _text(getattr(event, field)) for field in _COMPARED}
        theirs = {
            "title": current.title,
            "start_time": _text(current.start_time),
            "end_time": _text(current.end_time),
            "location": current.location,
            "description": current.description,
            "status": _text(current.status),
        }
        label = PROVIDER_LABELS[self.target.provider]
        if provider_updated is not None and local_updated > provider_updated:
            await self.session.rollback()
            written = await self.client.update_event(
                self.token,
                self.target.provider_calendar_id,
                current.provider_event_id,
                body,
                etag=None,
                self_email=self.self_email,
            )
            await self._record_conflict(
                previous=theirs,
                kept=ours,
                summary=f"Replaced a newer-looking edit in {label}",
                winner=ConflictWinner.UNIFFY,
            )
            await self._store_echo(current.provider_event_id, written)
            return PushState.CONFLICT_RESOLVED

        # The provider's version is applied as if it had arrived by sync.
        self.session.info[PROVIDER_SYNC_FLAG] = True
        try:
            await self._apply_provider_version(current)
            staged = await self._record_conflict(
                previous=ours,
                kept=theirs,
                summary=f"Your change was replaced by a newer edit in {label}",
                winner=ConflictWinner.PROVIDER,
                notify_title=event.title,
            )
            await self.session.commit()
        finally:
            self.session.info.pop(PROVIDER_SYNC_FLAG, None)
        await wake_outbox(staged)
        self.changed_locally = True
        refreshed = await self.session.get(CalendarEvent, self.claim.event_id)
        if refreshed is not None:
            try:
                await refresh_event_search_projection(self.session, refreshed, self.search_indexer)
            except Exception:
                logger.opt(exception=True).warning("Conflict search refresh deferred")
        return PushState.CONFLICT_RESOLVED

    async def _apply_provider_version(self, current: ProviderEvent) -> None:
        connected = await self.session.scalar(
            select(ConnectedCalendar)
            .where(ConnectedCalendar.id == self.claim.connected_calendar_id)
            .with_for_update()
        )
        if connected is None or connected.calendar_id is None:
            return
        link = await self._link(self.claim.event_id)
        if link is not None:
            # Forces the rewrite: the stored fingerprint describes our losing version.
            link.content_fingerprint = None
        await stage_provider_changes(
            self.session,
            SyncTargetRow(
                connected_calendar_id=connected.id,
                organization_id=self.claim.organization_id,
                owner_id=self.target.owner_id,
                calendar_id=connected.calendar_id,
            ),
            ChangeBatch(items=(current,)),
            members=await member_emails(self.session, self.claim.organization_id),
            scan_id=None,
            window_start=datetime.now(UTC),
        )

    async def _record_conflict(
        self,
        *,
        previous: dict[str, str],
        kept: dict[str, str],
        summary: str,
        winner: ConflictWinner,
        notify_title: str | None = None,
    ) -> list[UUID]:
        actor = self.claim.actor_id or self.target.owner_id
        differing = [field for field in _COMPARED if previous.get(field) != kept.get(field)]
        self.session.add(
            EventActivity(
                event_id=self.claim.event_id,
                actor_id=actor,
                action=CONFLICT_ACTION,
                field_id=",".join(differing)[:100] or None,
                previous_value=dumps_str({
                    "summary": summary,
                    "winner": winner.value,
                    **{f: previous.get(f) for f in differing},
                }),
                new_value=dumps_str({f: kept.get(f) for f in differing}),
            )
        )
        if notify_title is None:
            await self.session.commit()
            return []
        return await stage_conflict_notice(
            self.session,
            organization_id=self.claim.organization_id,
            user_id=actor,
            event_id=self.claim.event_id,
            event_title=notify_title,
            provider=self.target.provider,
            source_urn=build_content_urn(ContentType.CALENDAR_EVENT, self.claim.event_id),
        )

    async def _store_created(self, created: ProviderEvent) -> None:
        event = await self.session.scalar(
            select(CalendarEvent).where(CalendarEvent.id == self.claim.event_id).with_for_update()
        )
        if event is None:
            return
        uid = normalize_uid(created.ical_uid)
        if event.ical_uid is None and uid:
            event.ical_uid = uid
        link = await self._link(event.id)
        if link is None:
            link = CalendarEventLink(
                organization_id=self.claim.organization_id,
                connected_calendar_id=self.claim.connected_calendar_id,
                event_id=event.id,
                provider_event_id=created.provider_event_id[:500],
                ical_uid=uid,
                is_owner_link=True,
                is_organizer_copy=True,
            )
            self.session.add(link)
        _echo(link, created)
        await self.session.commit()

    async def _store_echo(self, provider_event_id: str, written: ProviderEvent | None) -> None:
        if written is None:
            return
        link = await self.session.scalar(
            select(CalendarEventLink)
            .where(
                CalendarEventLink.connected_calendar_id == self.claim.connected_calendar_id,
                CalendarEventLink.provider_event_id == provider_event_id,
            )
            .with_for_update()
        )
        if link is not None:
            _echo(link, written)
        await self.session.commit()

    async def _delete(self) -> PushState:
        provider_event_id = self.claim.provider_event_id
        link = await self._link(self.claim.event_id)
        if link is not None:
            provider_event_id = link.provider_event_id
        await self.session.rollback()
        if not provider_event_id:
            return PushState.DONE
        await self.client.delete_event(
            self.token, self.target.provider_calendar_id, provider_event_id
        )
        await self.session.execute(
            delete(CalendarEventLink).where(
                CalendarEventLink.connected_calendar_id == self.claim.connected_calendar_id,
                CalendarEventLink.provider_event_id == provider_event_id,
            )
        )
        await self.session.commit()
        return PushState.DONE

    async def _rsvp(self) -> PushState:
        if self.claim.actor_id is None:
            return PushState.DONE
        status = await self.session.scalar(
            select(EventAttendee.status).where(
                EventAttendee.event_id == self.claim.event_id,
                EventAttendee.user_id == self.claim.actor_id,
            )
        )
        link = await self._link(self.claim.event_id)
        provider_event_id = link.provider_event_id if link is not None else None
        await self.session.rollback()
        word = _RSVP_WORDS.get(status) if status is not None else None
        if provider_event_id is None or word is None:
            return PushState.DONE
        written = await self.client.respond(
            self.token,
            self.target.provider_calendar_id,
            provider_event_id,
            self_email=self.self_email,
            response_status=word,
        )
        await self._store_echo(provider_event_id, written)
        return PushState.DONE

    async def _occurrence(self) -> PushState:
        day = self.claim.occurrence_date
        master_link = await self._link(self.claim.event_id)
        master = await self.session.get(CalendarEvent, self.claim.event_id)
        if master_link is None or master is None or day is None:
            await self.session.rollback()
            return PushState.DONE
        series_id = master_link.provider_event_id
        override_id = await self.session.scalar(
            select(RecurrenceException.override_event_id).where(
                RecurrenceException.event_id == master.id,
                RecurrenceException.original_date == day,
            )
        )
        override = await self.session.get(CalendarEvent, override_id) if override_id else None
        body = None
        if self.claim.operation == PushOperation.UPSERT_OCCURRENCE and override is not None:
            body = self._body(await self._outbound(override), occurrence=True)
        await self.session.rollback()
        start = datetime(day.year, day.month, day.day, tzinfo=UTC) - timedelta(days=1)
        instances = await self.client.instances(
            self.token,
            self.target.provider_calendar_id,
            series_id,
            start,
            start + timedelta(days=3),
            self.self_email,
        )
        instance = next((item for item in instances if item.original_date == day), None)
        if instance is None:
            return PushState.DONE
        if self.claim.operation == PushOperation.DELETE_OCCURRENCE or body is None:
            await self.client.delete_event(
                self.token, self.target.provider_calendar_id, instance.provider_event_id
            )
            return PushState.DONE
        written = await self.client.update_event(
            self.token,
            self.target.provider_calendar_id,
            instance.provider_event_id,
            body,
            etag=None,
            self_email=self.self_email,
        )
        if override_id is not None:
            link = await self.session.scalar(
                select(CalendarEventLink).where(
                    CalendarEventLink.connected_calendar_id == self.claim.connected_calendar_id,
                    CalendarEventLink.provider_event_id == written.provider_event_id,
                )
            )
            if link is None:
                link = CalendarEventLink(
                    organization_id=self.claim.organization_id,
                    connected_calendar_id=self.claim.connected_calendar_id,
                    event_id=override_id,
                    provider_event_id=written.provider_event_id[:500],
                    provider_series_id=series_id,
                    is_owner_link=True,
                    is_organizer_copy=True,
                )
                self.session.add(link)
            _echo(link, written)
            await self.session.commit()
        return PushState.DONE


def _echo(link: CalendarEventLink, written: ProviderEvent) -> None:
    """What the next inbound round will read back, so it recognises our own write."""
    link.etag = written.etag[:500] if written.etag else None
    link.provider_updated_at = written.updated_at
    link.provider_sequence = written.sequence
    link.content_fingerprint = fingerprint(written)


def _text(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.astimezone(UTC).isoformat()
    return str(getattr(value, "value", value))
