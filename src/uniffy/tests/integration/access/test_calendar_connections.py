"""Google and Microsoft calendar sync against in-memory providers, asserted on PostgreSQL rows."""

import asyncio
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock, MagicMock, patch
from urllib.parse import parse_qs, urlsplit

import pytest
from sqlalchemy import select, update

from uniffy.core.audit.actions import Action
from uniffy.core.crypto.org_cipher import OrgCipher
from uniffy.core.errors import (
    MembershipRequiredError,
    PermissionDeniedError,
    UnavailableError,
    ValidationError,
)
from uniffy.core.events.bus import event_from_json
from uniffy.core.jobs import JobEnqueueOutcome, JobEnqueueResult, QueueName
from uniffy.core.jobs import run_job_and_wait as actual_run_job_and_wait
from uniffy.core.jobs.codec import deserialize_job_payload, serialize_job_payload
from uniffy.core.json_codec import dumps_str, loads
from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.calendar.activity import EventActivity
from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.connection import (
    CalendarConnection,
    CalendarConnectionAttempt,
    CalendarProvider,
    ConnectedCalendar,
    ConnectedCalendarState,
    ConnectionStatus,
    SyncDirection,
)
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.calendar.link import CalendarEventLink
from uniffy.core.models.calendar.participant import CalendarEventParticipant
from uniffy.core.models.calendar.provider_push import (
    CalendarProviderPush,
    PushOperation,
    PushState,
)
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.login.user import User
from uniffy.core.models.notifications.outbox import NotificationOutbox
from uniffy.core.models.shared import AttendeeStatus
from uniffy.core.search import SearchIndexer
from uniffy.core.types import (
    AccessMode,
    CalendarType,
    ContentRole,
    ContentType,
    NotificationType,
    generate_id,
)
from uniffy.domains.scheduling.calendar import queries
from uniffy.domains.scheduling.calendar import search as calendar_search
from uniffy.domains.scheduling.calendar.calendars import search as calendars_search
from uniffy.domains.scheduling.calendar.connections import cleanup as cleanup_module
from uniffy.domains.scheduling.calendar.connections import ingress
from uniffy.domains.scheduling.calendar.connections import oauth as oauth_module
from uniffy.domains.scheduling.calendar.connections import operations as connection_ops
from uniffy.domains.scheduling.calendar.connections import outbox as outbox_module
from uniffy.domains.scheduling.calendar.connections import run as run_module
from uniffy.domains.scheduling.calendar.connections.channels import secret_digest
from uniffy.domains.scheduling.calendar.connections.cleanup import CleanupStatus
from uniffy.domains.scheduling.calendar.connections.details import provider_details
from uniffy.domains.scheduling.calendar.connections.discovery import run_discovery
from uniffy.domains.scheduling.calendar.connections.normalize import (
    ChangeBatch,
    ItemKind,
    ProviderEvent,
)
from uniffy.domains.scheduling.calendar.connections.oauth import (
    complete_connection,
    start_connection,
)
from uniffy.domains.scheduling.calendar.connections.providers import base as provider_base
from uniffy.domains.scheduling.calendar.connections.providers.google import GoogleCalendarClient
from uniffy.domains.scheduling.calendar.connections.push import run_push
from uniffy.domains.scheduling.calendar.connections.push_state import claim_push
from uniffy.domains.scheduling.calendar.connections.run import SyncStatus, run_sync
from uniffy.domains.scheduling.calendar.connections.sync import SyncTargetRow, stage_provider_changes
from uniffy.domains.scheduling.calendar.connections.tokens import access_token_for
from uniffy.domains.scheduling.calendar.events.operations import CalendarEventOperations
from uniffy.domains.scheduling.calendar.ical.assemble import build_exports
from uniffy.domains.scheduling.calendar.jobs import lifecycle as lifecycle_jobs
from uniffy.domains.scheduling.calendar.jobs.contracts import (
    CLEANUP_CALENDAR_CONNECTION,
    COMPLETE_CALENDAR_CONNECTION,
)
from uniffy.domains.scheduling.calendar.mail.compose import build_message_document, load_bundle
from uniffy.domains.scheduling.calendar.mail.outbox import CalendarMailKind, EventMailRequest
from uniffy.infrastructure.database import open_session
from uniffy.infrastructure.valkey.queue import get_queue
from uniffy.tests.fakes.calendar_providers import FakeProviders
from uniffy.tests.integration.access.recording_search import RecordingSearchEngine, recording_indexer
from uniffy.vendor.arq.worker import Worker
from uniffy.workers.registry import EGRESS_JOBS

pytestmark = pytest.mark.asyncio(loop_scope="session")

START = (datetime.now(UTC) + timedelta(days=3)).replace(hour=7, minute=0, second=0, microsecond=0)
OUTSIDE_GUEST = "partner@example.com"


def _iso(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _google_event(event_id: str, title: str, start: datetime = START, **extra) -> dict:
    return {
        "id": event_id,
        "summary": title,
        "start": {"dateTime": _iso(start), "timeZone": "Europe/Sofia"},
        "end": {"dateTime": _iso(start + timedelta(hours=1)), "timeZone": "Europe/Sofia"},
        **extra,
    }


def _graph_event(event_id: str, title: str, start: datetime = START, **extra) -> dict:
    stamp = "%Y-%m-%dT%H:%M:%S.0000000"
    return {
        "id": event_id,
        "subject": title,
        "start": {"dateTime": start.strftime(stamp), "timeZone": "UTC"},
        "end": {"dateTime": (start + timedelta(hours=1)).strftime(stamp), "timeZone": "UTC"},
        "originalStartTimeZone": "UTC",
        "body": {"contentType": "text", "content": ""},
        "location": {"displayName": ""},
        "showAs": "busy",
        "sensitivity": "normal",
        **extra,
    }


@pytest.fixture
def providers(monkeypatch):
    fakes = FakeProviders()
    monkeypatch.setattr(provider_base, "TRANSPORT_FACTORY", fakes.transport)
    for name, value in {
        "GOOGLE_CALENDAR_CLIENT_ID": "google-client",
        "GOOGLE_CALENDAR_CLIENT_SECRET": "google-secret",
        "MICROSOFT_CALENDAR_CLIENT_ID": "microsoft-client",
        "MICROSOFT_CALENDAR_CLIENT_SECRET": "microsoft-secret",
        "MICROSOFT_CALENDAR_TENANT": "common",
        "CALENDAR_PROVIDER_SYNC_ENABLED": "true",
        "CALENDAR_PROVIDER_WRITES_ENABLED": "true",
        "CALENDAR_PUSH_BASE_URL": "",
        "UNIFFY_BASE_URL": "http://localhost:5173",
    }.items():
        monkeypatch.setenv(name, value)
    return fakes


@pytest.fixture(autouse=True)
def _quiet_effects():
    """Queues and realtime fan-out are not under test; rows and provider calls are."""
    with (
        patch.object(run_module, "publish_content_changed", AsyncMock()),
        patch.object(outbox_module, "enqueue_job_reconnecting", AsyncMock()),
        patch.object(connection_ops, "check_rate_limit", AsyncMock()),
        patch.object(calendar_search, "publish_mention_state", AsyncMock()),
        patch.object(calendars_search, "publish_mention_state", AsyncMock()),
        patch(
            "uniffy.domains.scheduling.calendar.connections.notices.enqueue_job_reconnecting",
            AsyncMock(),
        ),
    ):
        yield


@pytest.fixture(autouse=True)
def lifecycle_queue(monkeypatch):
    async def complete(ref, *args, **kwargs):
        assert ref == COMPLETE_CALENDAR_CONNECTION
        return await lifecycle_jobs.complete_calendar_connection({}, *args)

    async def cleanup(ref, *args, **kwargs):
        assert ref == CLEANUP_CALENDAR_CONNECTION
        await lifecycle_jobs.cleanup_calendar_connection({}, *args)
        return JobEnqueueResult(job=None, outcome=JobEnqueueOutcome.ENQUEUED)

    monkeypatch.setattr(oauth_module, "run_job_and_wait", complete)
    monkeypatch.setattr(cleanup_module, "enqueue_job_reconnecting", cleanup)
    monkeypatch.setattr(lifecycle_jobs, "enqueue_job_reconnecting", AsyncMock())


def _indexer() -> AsyncMock:
    return AsyncMock(spec=SearchIndexer)


async def _email(session, user_id) -> str:
    return (await session.scalar(select(User.email).where(User.id == user_id))).lower()


async def _connect(session, access, fakes, provider, user_id=None, code="code-1"):
    user_id = user_id or access.member_id
    url = await start_connection(
        session,
        user_id,
        access.org_id,
        provider,
        reconnect_connection_id=None,
        return_path="/calendar?view=week",
    )
    query = parse_qs(urlsplit(url).query)
    fake = fakes.google if provider == CalendarProvider.GOOGLE else fakes.graph
    fake.tokens.codes[code] = "granted"
    completed = await complete_connection(
        session,
        user_id,
        access.org_id,
        code=code,
        state=query["state"][0],
        error="",
        error_description="",
    )
    connection = await session.get(CalendarConnection, completed.connection_id)
    await run_discovery(session, connection.id, connection.generation)
    return _snapshot(await _fresh(session, CalendarConnection, completed.connection_id)), query


def _snapshot(row) -> NS:
    """Column values as plain data, so later commits cannot expire what the test holds."""
    return NS(**{column.key: getattr(row, column.key) for column in row.__table__.columns})


async def _fresh(session, model, row_id):
    return await session.scalar(
        select(model).where(model.id == row_id).execution_options(populate_existing=True)
    )


async def _primary(session, connection) -> NS:
    row = await session.scalar(
        select(ConnectedCalendar)
        .where(ConnectedCalendar.connection_id == connection.id, ConnectedCalendar.is_primary)
        .execution_options(populate_existing=True)
    )
    return _snapshot(row)


async def _sync(session, connection, indexer=None):
    connected = await _primary(session, connection)
    return await run_sync(session, connected.id, connection.generation, indexer or _indexer())


async def _linked_events(session, connected_id) -> dict[str, CalendarEvent]:
    rows = await session.execute(
        select(CalendarEventLink.provider_event_id, CalendarEvent)
        .join(CalendarEvent, CalendarEvent.id == CalendarEventLink.event_id)
        .where(CalendarEventLink.connected_calendar_id == connected_id)
        .execution_options(populate_existing=True)
    )
    return {provider_id: _snapshot(event) for provider_id, event in rows.all()}


async def _pending_pushes(session, event_id) -> list[NS]:
    rows = (
        await session.execute(
            select(CalendarProviderPush)
            .where(CalendarProviderPush.event_id == event_id)
            .execution_options(populate_existing=True)
        )
    ).scalars()
    return [_snapshot(row) for row in rows]


class TestConnect:
    async def test_the_sign_in_seals_tokens_and_discovers_the_primary_calendar(
        self, session, access, providers
    ):
        providers.google.calendars["holidays#holiday@group.v.calendar.google.com"] = {
            "id": "holidays#holiday@group.v.calendar.google.com",
            "summary": "Holidays",
            "accessRole": "reader",
        }
        connection, query = await _connect(session, access, providers, CalendarProvider.GOOGLE)

        assert query["access_type"] == ["offline"]
        assert query["code_challenge_method"] == ["S256"]
        assert connection.status == ConnectionStatus.ACTIVE
        assert connection.account_email == providers.google.email
        assert connection.refresh_token_encrypted
        issued = next(iter(providers.google.tokens.refresh_tokens))
        assert issued not in connection.refresh_token_encrypted
        attempt = await session.scalar(
            select(CalendarConnectionAttempt).where(
                CalendarConnectionAttempt.user_id == access.member_id
            )
        )
        assert attempt.consumed_at is not None
        assert query["state"][0] not in attempt.state_digest

        rows = list(
            (
                await session.execute(
                    select(ConnectedCalendar).where(ConnectedCalendar.connection_id == connection.id)
                )
            ).scalars()
        )
        primary = next(row for row in rows if row.is_primary)
        holidays = next(row for row in rows if not row.is_primary)
        assert primary.sync_enabled and primary.direction == SyncDirection.TWO_WAY
        assert primary.counts_as_busy
        assert not holidays.sync_enabled and holidays.is_system
        assert holidays.direction == SyncDirection.INBOUND
        calendar = await session.get(Calendar, primary.calendar_id)
        assert calendar.calendar_type == CalendarType.CONNECTED
        assert calendar.owner_id == access.member_id
        audit = await session.scalar(
            select(AuditEvent).where(
                AuditEvent.action == Action.CALENDAR_CONNECTION_CREATED,
                AuditEvent.resource_id == connection.id,
            )
        )
        assert audit is not None

    async def test_a_callback_replayed_with_the_same_state_is_refused(
        self, session, access, providers
    ):
        _connection, query = await _connect(session, access, providers, CalendarProvider.GOOGLE)
        with pytest.raises(ValidationError):
            await complete_connection(
                session,
                access.member_id,
                access.org_id,
                code="code-1",
                state=query["state"][0],
                error="",
                error_description="",
            )

    async def test_another_member_cannot_finish_my_sign_in(self, session, access, providers):
        url = await start_connection(
            session,
            access.member_id,
            access.org_id,
            CalendarProvider.GOOGLE,
            reconnect_connection_id=None,
            return_path="/calendar",
        )
        state = parse_qs(urlsplit(url).query)["state"][0]
        providers.google.tokens.codes["code-1"] = "granted"
        with pytest.raises(ValidationError):
            await complete_connection(
                session,
                access.peer_id,
                access.org_id,
                code="code-1",
                state=state,
                error="",
                error_description="",
            )
        assert providers.google.calls.count("POST", "/token") == 0

    async def test_an_admin_approval_refusal_explains_itself(self, session, access, providers):
        url = await start_connection(
            session,
            access.member_id,
            access.org_id,
            CalendarProvider.MICROSOFT,
            reconnect_connection_id=None,
            return_path="//evil.example.com",
        )
        state = parse_qs(urlsplit(url).query)["state"][0]
        with pytest.raises(ValidationError, match="administrator must approve"):
            await complete_connection(
                session,
                access.member_id,
                access.org_id,
                code="",
                state=state,
                error="access_denied",
                error_description="AADSTS65001: consent required",
            )
        attempt = await session.scalar(
            select(CalendarConnectionAttempt).where(
                CalendarConnectionAttempt.user_id == access.member_id
            )
        )
        assert attempt.return_path == "/calendar"

    async def test_sync_switched_off_for_the_deployment_refuses_to_start(
        self, session, access, providers, monkeypatch
    ):
        monkeypatch.setenv("CALENDAR_PROVIDER_SYNC_ENABLED", "false")
        with pytest.raises(Exception, match="not turned this on"):
            await start_connection(
                session,
                access.member_id,
                access.org_id,
                CalendarProvider.GOOGLE,
                reconnect_connection_id=None,
                return_path="/calendar",
            )


class TestInboundGoogle:
    async def test_a_first_sync_mirrors_events_guests_and_members(self, session, access, providers):
        peer_email = await _email(session, access.peer_id)
        owner_email = providers.google.email
        providers.google.put_event(
            owner_email,
            _google_event(
                "evt-standup",
                "Weekly standup",
                recurrence=["RRULE:FREQ=WEEKLY;BYDAY=" + START.strftime("%a")[:2].upper()],
            ),
        )
        providers.google.put_event(
            owner_email,
            _google_event(
                "evt-review",
                "Design review",
                START + timedelta(hours=3),
                attendees=[
                    {
                        "email": owner_email,
                        "self": True,
                        "responseStatus": "accepted",
                        "organizer": True,
                    },
                    {"email": peer_email, "responseStatus": "tentative"},
                    {
                        "email": OUTSIDE_GUEST,
                        "displayName": "Partner",
                        "responseStatus": "needsAction",
                    },
                ],
                hangoutLink="https://meet.google.com/abc-defg-hij",
                visibility="private",
            ),
        )
        connection, _ = await _connect(session, access, providers, CalendarProvider.GOOGLE)
        indexer = _indexer()

        report = await _sync(session, connection, indexer)

        assert report.status == SyncStatus.SYNCED and report.created == 2
        connected = await _primary(session, connection)
        assert connected.cursor == str(providers.google.position)
        assert connected.last_success_at is not None
        assert connected.event_count == 2
        synced = await _fresh(session, CalendarConnection, connection.id)
        assert synced.last_synced_at == connected.last_success_at
        events = await _linked_events(session, connected.id)
        standup, review = events["evt-standup"], events["evt-review"]
        assert standup.recurrence_pattern.value == "WEEKLY"
        assert review.meeting_url == "https://meet.google.com/abc-defg-hij"
        assert review.visibility.value == "PRIVATE"
        assert review.organizer_id == access.member_id
        assert review.calendar_id == connected.calendar_id
        participants = {
            row.email: row
            for row in (
                await session.execute(
                    select(CalendarEventParticipant).where(
                        CalendarEventParticipant.event_id == review.id
                    )
                )
            ).scalars()
        }
        assert participants[OUTSIDE_GUEST].user_id is None
        assert participants[peer_email].user_id == access.peer_id
        attendees = {
            row.user_id: row
            for row in (
                await session.execute(
                    select(EventAttendee).where(EventAttendee.event_id == review.id)
                )
            ).scalars()
        }
        assert attendees[access.peer_id].status == AttendeeStatus.TENTATIVE
        assert attendees[access.member_id].role.value == "ORGANIZER"
        assert indexer.batch_index.await_count >= 1

    async def test_changes_and_cancellations_arrive_incrementally(self, session, access, providers):
        owner_email = providers.google.email
        providers.google.put_event(owner_email, _google_event("evt-a", "Planning"))
        providers.google.put_event(owner_email, _google_event("evt-b", "Retro"))
        connection, _ = await _connect(session, access, providers, CalendarProvider.GOOGLE)
        await _sync(session, connection)
        connected = await _primary(session, connection)
        before = await _linked_events(session, connected.id)

        providers.google.put_event(
            owner_email, _google_event("evt-a", "Planning (moved)", START + timedelta(hours=2))
        )
        providers.google.cancel_event(owner_email, "evt-b")
        report = await _sync(session, connection)

        assert (report.updated, report.deleted) == (1, 1)
        retitled = await _fresh(session, CalendarEvent, before["evt-a"].id)
        assert retitled.title == "Planning (moved)"
        assert retitled.start_time == START + timedelta(hours=2)
        removed = await _fresh(session, CalendarEvent, before["evt-b"].id)
        assert removed.is_deleted
        assert "evt-b" not in await _linked_events(session, connected.id)
        list_calls = [p for m, _h, p in providers.google.calls.log if p.endswith("/events")]
        assert len(list_calls) == 2

    async def test_an_event_moved_past_the_window_follows_the_move(self, session, access, providers):
        owner_email = providers.google.email
        providers.google.put_event(owner_email, _google_event("evt-a", "Planning"))
        connection, _ = await _connect(session, access, providers, CalendarProvider.GOOGLE)
        await _sync(session, connection)
        connected = await _primary(session, connection)
        far = connected.window_end + timedelta(days=30)

        providers.google.put_event(owner_email, _google_event("evt-a", "Planning", far))
        report = await _sync(session, connection)

        assert report.updated == 1
        moved = (await _linked_events(session, connected.id))["evt-a"]
        assert (await _fresh(session, CalendarEvent, moved.id)).start_time == far

    async def test_an_event_restored_on_the_provider_comes_back_to_life(
        self, session, access, providers
    ):
        owner_email = providers.google.email
        providers.google.put_event(
            owner_email, _google_event("evt-undo", "Undo me", iCalUID="undo-1@google.com")
        )
        connection, _ = await _connect(session, access, providers, CalendarProvider.GOOGLE)
        await _sync(session, connection)
        connected = await _primary(session, connection)
        first = (await _linked_events(session, connected.id))["evt-undo"]
        providers.google.cancel_event(owner_email, "evt-undo")
        await _sync(session, connection)
        assert (await _fresh(session, CalendarEvent, first.id)).is_deleted

        providers.google.put_event(
            owner_email, _google_event("evt-undo", "Undo me", iCalUID="undo-1@google.com")
        )
        report = await _sync(session, connection)

        assert report.status == SyncStatus.SYNCED
        restored = (await _linked_events(session, connected.id))["evt-undo"]
        assert restored.id == first.id
        assert not (await _fresh(session, CalendarEvent, first.id)).is_deleted

    async def test_a_forgotten_cursor_rereads_everything_and_sweeps_what_vanished(
        self, session, access, providers
    ):
        owner_email = providers.google.email
        providers.google.put_event(owner_email, _google_event("evt-keep", "Keep"))
        providers.google.put_event(owner_email, _google_event("evt-gone", "Gone"))
        connection, _ = await _connect(session, access, providers, CalendarProvider.GOOGLE)
        await _sync(session, connection)
        connected = await _primary(session, connection)
        gone_id = (await _linked_events(session, connected.id))["evt-gone"].id

        providers.google.expired_tokens.add(connected.cursor)
        del providers.google.events[owner_email]["evt-gone"]
        report = await _sync(session, connection)

        assert report.deleted == 1
        assert (await _fresh(session, CalendarEvent, gone_id)).is_deleted
        assert set(await _linked_events(session, connected.id)) == {"evt-keep"}

    async def test_a_rule_uniffy_cannot_express_is_mirrored_read_only(
        self, session, access, providers
    ):
        owner_email = providers.google.email
        providers.google.put_event(
            owner_email,
            _google_event(
                "evt-odd",
                "Odd rota",
                recurrence=["RRULE:FREQ=MONTHLY;BYDAY=1MO,3FR", "RDATE:20261224T070000Z"],
            ),
        )
        providers.google.instances[(owner_email, "evt-odd")] = [
            _google_event(
                f"evt-odd_{day}",
                "Odd rota",
                START + timedelta(days=day),
                recurringEventId="evt-odd",
                originalStartTime={"dateTime": _iso(START + timedelta(days=day))},
            )
            for day in (0, 14)
        ]
        connection, _ = await _connect(session, access, providers, CalendarProvider.GOOGLE)
        await _sync(session, connection)

        connected = await _primary(session, connection)
        events = await _linked_events(session, connected.id)
        assert set(events) == {"evt-odd_0", "evt-odd_14"}
        assert all(event.is_mirrored_occurrence for event in events.values())
        ops = CalendarEventOperations(session, _indexer(), None)
        mirrored = await _fresh(session, CalendarEvent, events["evt-odd_0"].id)
        role = await ops._resolve_role(access.member_id, access.org_id, mirrored)
        assert role == ContentRole.VIEWER

    async def test_a_job_from_before_a_reconnect_is_dropped(self, session, access, providers):
        connection, _ = await _connect(session, access, providers, CalendarProvider.GOOGLE)
        connected = await _primary(session, connection)
        report = await run_sync(session, connected.id, connection.generation - 1, _indexer())
        assert report.status == SyncStatus.SKIPPED
        assert providers.google.calls.count("GET", "/events") == 0

    async def test_a_revoked_grant_asks_for_a_new_sign_in_once(self, session, access, providers):
        connection, _ = await _connect(session, access, providers, CalendarProvider.GOOGLE)
        providers.google.tokens.refresh_tokens.clear()
        await session.execute(
            update(CalendarConnection)
            .where(CalendarConnection.id == connection.id)
            .values(access_token_expires_at=datetime.now(UTC) - timedelta(minutes=1))
        )
        await session.commit()

        await _sync(session, connection)
        await _sync(session, connection)

        refreshed = await _fresh(session, CalendarConnection, connection.id)
        assert refreshed.status == ConnectionStatus.REAUTH_REQUIRED
        assert refreshed.access_token_encrypted is None
        notices = [
            event_from_json(row.payload)
            for row in (
                await session.execute(
                    select(NotificationOutbox).where(
                        NotificationOutbox.organization_id == access.org_id
                    )
                )
            ).scalars()
        ]
        reconnects = [
            notice
            for notice in notices
            if notice.notification_type is NotificationType.CALENDAR_CONNECTION_NEEDS_RECONNECT
        ]
        assert len(reconnects) == 1
        assert reconnects[0].target_user_ids == [access.member_id]
        assert "refresh-" not in (reconnects[0].body or "")


class TestOneMeetingTwoMembers:
    async def test_the_same_meeting_from_two_accounts_is_one_event(self, session, access, providers):
        uid = "shared-meeting-42@google.com"
        member_email = providers.google.email
        providers.google.put_event(
            member_email,
            _google_event(
                "evt-meet",
                "Quarterly sync",
                iCalUID=uid,
                attendees=[{"email": providers.graph.email, "responseStatus": "needsAction"}],
            ),
        )
        providers.graph.put_event(
            _graph_event(
                "AAMk-meet",
                "Quarterly sync",
                iCalUId=uid,
                isOrganizer=False,
                organizer={"emailAddress": {"address": member_email, "name": "Member"}},
                attendees=[
                    {
                        "emailAddress": {"address": providers.graph.email},
                        "type": "required",
                        "status": {"response": "accepted"},
                    },
                ],
            )
        )
        member, _ = await _connect(session, access, providers, CalendarProvider.GOOGLE)
        peer, _ = await _connect(
            session,
            access,
            providers,
            CalendarProvider.MICROSOFT,
            user_id=access.peer_id,
            code="code-2",
        )
        await _sync(session, member)
        await _sync(session, peer)

        events = [
            _snapshot(row)
            for row in (
                await session.execute(
                    select(CalendarEvent).where(
                        CalendarEvent.organization_id == access.org_id,
                        CalendarEvent.ical_uid == uid,
                    )
                )
            ).scalars()
        ]
        assert len(events) == 1
        links = list(
            (
                await session.execute(
                    select(CalendarEventLink).where(CalendarEventLink.event_id == events[0].id)
                )
            ).scalars()
        )
        assert sorted(link.is_owner_link for link in links) == [False, True]
        peer_row = await session.scalar(
            select(EventAttendee).where(
                EventAttendee.event_id == events[0].id, EventAttendee.user_id == access.peer_id
            )
        )
        assert peer_row.status == AttendeeStatus.ACCEPTED

        providers.graph.remove_event("AAMk-meet")
        await _sync(session, peer)
        survivor = await _fresh(session, CalendarEvent, events[0].id)
        assert not survivor.is_deleted
        peer_row = await session.scalar(
            select(EventAttendee)
            .where(EventAttendee.event_id == events[0].id, EventAttendee.user_id == access.peer_id)
            .execution_options(populate_existing=True)
        )
        assert peer_row.status == AttendeeStatus.DECLINED

    async def test_a_guest_copy_from_graph_first_still_meets_the_google_original(
        self, session, access, providers
    ):
        uid = "shared-meeting-43@google.com"
        # Graph wraps a Google organizer's UID in an Exchange id.
        wrapped = (
            "040000008200E00074C5B7101A82E008"
            + "00" * 20
            + "32000000"
            + b"vCal-Uid\x01\x00\x00\x00".hex().upper()
            + uid.encode().hex().upper()
            + "00"
        )
        member_email = providers.google.email
        providers.google.put_event(
            member_email,
            _google_event(
                "evt-meet",
                "Design review",
                iCalUID=uid,
                attendees=[{"email": providers.graph.email, "responseStatus": "needsAction"}],
            ),
        )
        providers.graph.put_event(
            _graph_event(
                "AAMk-meet",
                "Design review",
                iCalUId=wrapped,
                isOrganizer=False,
                organizer={"emailAddress": {"address": member_email, "name": "Member"}},
                attendees=[
                    {
                        "emailAddress": {"address": providers.graph.email},
                        "type": "required",
                        "status": {"response": "accepted"},
                    },
                ],
            )
        )
        member, _ = await _connect(session, access, providers, CalendarProvider.GOOGLE)
        peer, _ = await _connect(
            session,
            access,
            providers,
            CalendarProvider.MICROSOFT,
            user_id=access.peer_id,
            code="code-2",
        )
        await _sync(session, peer)
        await _sync(session, member)

        events = list(
            (
                await session.execute(
                    select(CalendarEvent).where(
                        CalendarEvent.organization_id == access.org_id,
                        CalendarEvent.title == "Design review",
                    )
                )
            ).scalars()
        )
        assert len(events) == 1
        (event,) = events
        assert event.ical_uid == uid
        assert event.organizer_id == access.member_id

    async def test_when_the_owner_drops_the_meeting_the_remaining_copy_takes_it_home(
        self, session, access, providers
    ):
        uid = "handover-5@google.com"
        member_email = providers.google.email
        providers.google.put_event(
            member_email,
            _google_event(
                "evt-hand",
                "Handover",
                iCalUID=uid,
                attendees=[{"email": providers.graph.email, "responseStatus": "accepted"}],
            ),
        )
        providers.graph.put_event(
            _graph_event(
                "AAMk-hand",
                "Handover",
                iCalUId=uid,
                isOrganizer=False,
                organizer={"emailAddress": {"address": member_email}},
            )
        )
        member, _ = await _connect(session, access, providers, CalendarProvider.GOOGLE)
        peer, _ = await _connect(
            session,
            access,
            providers,
            CalendarProvider.MICROSOFT,
            user_id=access.peer_id,
            code="code-2",
        )
        await _sync(session, member)
        await _sync(session, peer)
        peer_calendar = await _primary(session, peer)
        event_id = (await _linked_events(session, peer_calendar.id))["AAMk-hand"].id

        providers.google.cancel_event(member_email, "evt-hand")
        await _sync(session, member)

        moved = await _fresh(session, CalendarEvent, event_id)
        assert not moved.is_deleted
        assert moved.calendar_id == peer_calendar.calendar_id
        assert moved.organizer_id == access.peer_id
        departed = await session.scalar(
            select(EventAttendee)
            .where(EventAttendee.event_id == event_id, EventAttendee.user_id == access.member_id)
            .execution_options(populate_existing=True)
        )
        assert departed.status == AttendeeStatus.DECLINED

    async def test_a_copied_uid_does_not_join_a_meeting_that_never_listed_the_member(
        self, session, access, providers
    ):
        uid = "private-review-9@google.com"
        providers.google.put_event(
            providers.google.email,
            _google_event("evt-private", "Private review", iCalUID=uid),
        )
        providers.graph.put_event(
            _graph_event(
                "AAMk-copy",
                "Private review",
                iCalUId=uid,
                isOrganizer=True,
                organizer={"emailAddress": {"address": providers.graph.email}},
            )
        )
        member, _ = await _connect(session, access, providers, CalendarProvider.GOOGLE)
        peer, _ = await _connect(
            session,
            access,
            providers,
            CalendarProvider.MICROSOFT,
            user_id=access.peer_id,
            code="code-2",
        )
        await _sync(session, member)
        await _sync(session, peer)

        events = {
            row.organizer_id: _snapshot(row)
            for row in (
                await session.execute(
                    select(CalendarEvent).where(
                        CalendarEvent.organization_id == access.org_id,
                        CalendarEvent.ical_uid == uid,
                    )
                )
            ).scalars()
        }
        assert set(events) == {access.member_id, access.peer_id}
        stolen = await session.scalar(
            select(EventAttendee).where(
                EventAttendee.event_id == events[access.member_id].id,
                EventAttendee.user_id == access.peer_id,
            )
        )
        assert stolen is None


async def _create_on(session, access, calendar_id, buffer, title="Uniffy planning"):
    return await CalendarEventOperations(session, _indexer(), buffer).create(
        access.member_id,
        access.org_id,
        title=title,
        start_time=START + timedelta(days=1),
        end_time=START + timedelta(days=1, hours=1),
        calendar_id=calendar_id,
        timezone="Europe/Sofia",
        location="Room 4",
        meeting_url="https://uniffy.example/call/xyz",
    )


class TestOutbound:
    async def test_a_new_event_reaches_google_once_even_when_the_answer_is_lost(
        self, session, access, providers, buffer
    ):
        connection, _ = await _connect(session, access, providers, CalendarProvider.GOOGLE)
        await _sync(session, connection)
        connected = await _primary(session, connection)
        event = _snapshot(await _create_on(session, access, connected.calendar_id, buffer))
        (push,) = await _pending_pushes(session, event.id)
        assert push.operation == PushOperation.UPSERT and push.state == PushState.PENDING

        providers.google.drop_next_insert = True
        first = await run_push(session, push.id, push.generation, _indexer())
        assert first["status"] == "retry"
        await session.execute(
            update(CalendarProviderPush)
            .where(CalendarProviderPush.id == push.id)
            .values(next_attempt_at=datetime.now(UTC))
        )
        await session.commit()
        second = await run_push(session, push.id, push.generation, _indexer())

        assert second["status"] == "done"
        stored = providers.google.events[providers.google.email]
        assert len(stored) == 1
        (provider_event,) = stored.values()
        assert provider_event["summary"] == "Uniffy planning"
        # The owner is the account itself, never a guest of their own event.
        owner_email = await session.scalar(select(User.email).where(User.id == access.member_id))
        assert owner_email not in {guest["email"] for guest in provider_event.get("attendees", [])}
        assert provider_event["description"].endswith("Join: https://uniffy.example/call/xyz")
        link = await session.scalar(
            select(CalendarEventLink).where(CalendarEventLink.event_id == event.id)
        )
        assert link.provider_event_id == provider_event["id"]
        assert (await _fresh(session, CalendarEvent, event.id)).ical_uid == provider_event["iCalUID"]

        report = await _sync(session, connection)
        assert report.status == SyncStatus.UNCHANGED
        assert (await _fresh(session, CalendarEvent, event.id)).description == ""

    async def test_an_inbound_change_never_queues_a_push_back(self, session, access, providers):
        providers.google.put_event(providers.google.email, _google_event("evt-in", "Inbound"))
        connection, _ = await _connect(session, access, providers, CalendarProvider.GOOGLE)
        await _sync(session, connection)
        connected = await _primary(session, connection)
        event = (await _linked_events(session, connected.id))["evt-in"]
        assert await _pending_pushes(session, event.id) == []

    async def test_a_newer_provider_edit_wins_and_the_loser_is_kept(
        self, session, access, providers, buffer
    ):
        owner_email = providers.google.email
        providers.google.put_event(owner_email, _google_event("evt-c", "Original"))
        connection, _ = await _connect(session, access, providers, CalendarProvider.GOOGLE)
        await _sync(session, connection)
        connected = await _primary(session, connection)
        event = (await _linked_events(session, connected.id))["evt-c"]

        await CalendarEventOperations(session, _indexer(), buffer).update(
            access.member_id,
            access.org_id,
            event.id,
            call_lifecycle=MagicMock(),
            title="Uniffy title",
        )
        providers.google.put_event(
            owner_email,
            {
                **providers.google._public(providers.google.events[owner_email]["evt-c"]),
                "summary": "Google title",
            },
        )
        (push,) = await _pending_pushes(session, event.id)
        result = await run_push(session, push.id, push.generation, _indexer())

        assert result["status"] == "conflict_resolved"
        assert (await _fresh(session, CalendarEvent, event.id)).title == "Google title"
        assert providers.google.events[owner_email]["evt-c"]["summary"] == "Google title"
        activity = await session.scalar(
            select(EventActivity).where(
                EventActivity.event_id == event.id, EventActivity.action == "sync_conflict"
            )
        )
        assert "Uniffy title" in activity.previous_value
        notices = [
            event_from_json(row.payload)
            for row in (
                await session.execute(
                    select(NotificationOutbox).where(
                        NotificationOutbox.organization_id == access.org_id
                    )
                )
            ).scalars()
        ]
        assert any(
            notice.notification_type is NotificationType.CALENDAR_SYNC_CONFLICT
            and notice.target_user_ids == [access.member_id]
            for notice in notices
        )

    async def test_a_newer_uniffy_edit_wins_on_graph_after_a_precondition_failure(
        self, session, access, providers, buffer
    ):
        providers.graph.put_event(_graph_event("AAMk-c", "Original"))
        connection, _ = await _connect(session, access, providers, CalendarProvider.MICROSOFT)
        await _sync(session, connection)
        connected = await _primary(session, connection)
        event = (await _linked_events(session, connected.id))["AAMk-c"]

        stale = providers.graph._public(providers.graph.events["AAMk-c"])
        providers.graph.put_event({**stale, "subject": "Outlook title"})
        # The provider stamp sits in the past, so the Uniffy edit after it is the later one.
        providers.graph.events["AAMk-c"]["lastModifiedDateTime"] = _iso(
            datetime.now(UTC) - timedelta(minutes=5)
        )
        await CalendarEventOperations(session, _indexer(), buffer).update(
            access.member_id,
            access.org_id,
            event.id,
            call_lifecycle=MagicMock(),
            title="Uniffy title",
        )
        (push,) = await _pending_pushes(session, event.id)
        result = await run_push(session, push.id, push.generation, _indexer())

        assert result["status"] == "conflict_resolved"
        assert providers.graph.events["AAMk-c"]["subject"] == "Uniffy title"
        assert providers.graph.calls.count("PATCH", "/me/calendars/cal-primary/events/AAMk-c") == 2
        activity = await session.scalar(
            select(EventActivity).where(
                EventActivity.event_id == event.id, EventActivity.action == "sync_conflict"
            )
        )
        assert "Outlook title" in activity.previous_value

    async def test_an_edit_keeps_guests_under_the_addresses_the_provider_knows(
        self, session, access, providers, buffer
    ):
        other_account = providers.graph.email
        providers.google.put_event(
            providers.google.email,
            _google_event(
                "evt-guests",
                "Planning",
                attendees=[
                    {"email": other_account, "responseStatus": "accepted"},
                    {"email": "guest@example.com", "responseStatus": "tentative"},
                ],
            ),
        )
        google, _ = await _connect(session, access, providers, CalendarProvider.GOOGLE)
        await _connect(session, access, providers, CalendarProvider.MICROSOFT, code="code-2")
        await _sync(session, google)
        connected = await _primary(session, google)
        event = (await _linked_events(session, connected.id))["evt-guests"]

        await CalendarEventOperations(session, _indexer(), buffer).update(
            access.member_id,
            access.org_id,
            event.id,
            call_lifecycle=MagicMock(),
            title="Planning (moved)",
        )
        (push,) = await _pending_pushes(session, event.id)
        await run_push(session, push.id, push.generation, _indexer())

        stored = providers.google.events[providers.google.email]["evt-guests"]
        guests = {guest["email"]: guest["responseStatus"] for guest in stored["attendees"]}
        owner_email = await session.scalar(select(User.email).where(User.id == access.member_id))
        # The owner's other account stays invited; their Uniffy address is never added.
        assert guests == {other_account: "accepted", "guest@example.com": "tentative"}
        assert owner_email not in guests

    async def test_a_delete_in_uniffy_deletes_on_the_provider(
        self, session, access, providers, buffer
    ):
        providers.graph.put_event(_graph_event("AAMk-d", "To delete"))
        connection, _ = await _connect(session, access, providers, CalendarProvider.MICROSOFT)
        await _sync(session, connection)
        connected = await _primary(session, connection)
        event = (await _linked_events(session, connected.id))["AAMk-d"]

        await CalendarEventOperations(session, _indexer(), buffer).delete(
            access.member_id, access.org_id, event.id
        )
        (push,) = await _pending_pushes(session, event.id)
        assert push.operation == PushOperation.DELETE
        await run_push(session, push.id, push.generation, _indexer())

        assert providers.graph.events["AAMk-d"]["_removed"]
        assert await _linked_events(session, connected.id) == {}

    async def test_an_answer_goes_to_the_responders_own_copy(self, session, access, providers):
        uid = "invite-7@example.com"
        providers.graph.put_event(
            _graph_event(
                "AAMk-inv",
                "Invite",
                iCalUId=uid,
                isOrganizer=False,
                organizer={"emailAddress": {"address": OUTSIDE_GUEST}},
                attendees=[
                    {
                        "emailAddress": {"address": providers.graph.email},
                        "type": "required",
                        "status": {"response": "none"},
                    }
                ],
            )
        )
        connection, _ = await _connect(session, access, providers, CalendarProvider.MICROSOFT)
        await _sync(session, connection)
        connected = await _primary(session, connection)
        event = (await _linked_events(session, connected.id))["AAMk-inv"]
        ops = CalendarEventOperations(session, _indexer(), None)
        invite = await _fresh(session, CalendarEvent, event.id)
        assert await ops._resolve_role(access.member_id, access.org_id, invite) == ContentRole.VIEWER

        await ops.update_attendee_status(
            access.member_id, access.org_id, event.id, AttendeeStatus.ACCEPTED
        )
        (push,) = await _pending_pushes(session, event.id)
        assert push.operation == PushOperation.RSVP
        await run_push(session, push.id, push.generation, _indexer())

        assert (
            providers.graph.calls.count("POST", "/me/calendars/cal-primary/events/AAMk-inv/accept")
            == 1
        )

    async def test_with_writes_off_the_calendar_is_read_only_and_nothing_queues(
        self, session, access, providers, buffer, monkeypatch
    ):
        connection, _ = await _connect(session, access, providers, CalendarProvider.GOOGLE)
        connected = await _primary(session, connection)
        monkeypatch.setenv("CALENDAR_PROVIDER_WRITES_ENABLED", "false")
        with pytest.raises(ValidationError):
            await _create_on(session, access, connected.calendar_id, buffer)

    async def test_an_edit_made_while_paused_waits_and_goes_out_on_resume(
        self, session, access, providers, buffer
    ):
        connection, _ = await _connect(session, access, providers, CalendarProvider.GOOGLE)
        await _sync(session, connection)
        connected = await _primary(session, connection)
        await connection_ops.set_paused(
            session, access.member_id, access.org_id, connection.id, paused=True
        )
        event = _snapshot(await _create_on(session, access, connected.calendar_id, buffer))
        (push,) = await _pending_pushes(session, event.id)

        held = await run_push(session, push.id, push.generation, _indexer())

        assert held["status"] == "paused"
        waiting = await _fresh(session, CalendarProviderPush, push.id)
        assert (waiting.state, waiting.attempts) == (PushState.PENDING, 0)
        assert not providers.google.events.get(providers.google.email)

        await connection_ops.set_paused(
            session, access.member_id, access.org_id, connection.id, paused=False
        )
        sent = await run_push(session, push.id, push.generation, _indexer())

        assert sent["status"] == "done"
        assert len(providers.google.events[providers.google.email]) == 1


class TestDisconnect:
    async def test_disconnect_keeps_events_and_a_reconnect_duplicates_nothing(
        self, session, access, providers
    ):
        providers.google.put_event(providers.google.email, _google_event("evt-k", "Kept"))
        connection, _ = await _connect(session, access, providers, CalendarProvider.GOOGLE)
        await _sync(session, connection)
        connected = await _primary(session, connection)
        kept = (await _linked_events(session, connected.id))["evt-k"]

        await connection_ops.disconnect(session, access.member_id, access.org_id, connection.id)

        gone = await _fresh(session, CalendarConnection, connection.id)
        assert gone.status == ConnectionStatus.DISCONNECTED
        assert gone.refresh_token_encrypted is None and gone.access_token_encrypted is None
        assert providers.google.tokens.revoked
        calendar = await _fresh(session, Calendar, connected.calendar_id)
        assert calendar.calendar_type == CalendarType.PERSONAL
        assert not (await _fresh(session, CalendarEvent, kept.id)).is_deleted
        detached = await _fresh(session, ConnectedCalendar, connected.id)
        assert detached.state == ConnectedCalendarState.DETACHED

        reconnected, _ = await _connect(
            session, access, providers, CalendarProvider.GOOGLE, code="code-again"
        )
        assert reconnected.id == connection.id
        assert reconnected.generation > connection.generation
        assert (await _fresh(session, Calendar, connected.calendar_id)).calendar_type == (
            CalendarType.CONNECTED
        )
        await _sync(session, reconnected)
        events = list(
            (
                await session.execute(
                    select(CalendarEvent).where(
                        CalendarEvent.calendar_id == connected.calendar_id,
                        CalendarEvent.is_deleted.is_(False),
                    )
                )
            ).scalars()
        )
        assert [event.id for event in events] == [kept.id]

    async def test_a_calendar_shared_while_detached_is_not_synced_into_again(
        self, session, access, providers
    ):
        providers.google.put_event(providers.google.email, _google_event("evt-s", "Synced"))
        connection, _ = await _connect(session, access, providers, CalendarProvider.GOOGLE)
        await _sync(session, connection)
        connected = await _primary(session, connection)
        await connection_ops.disconnect(session, access.member_id, access.org_id, connection.id)
        await session.execute(
            update(Calendar)
            .where(Calendar.id == connected.calendar_id)
            .values(access_mode=AccessMode.OPEN_TO_ORG, baseline_role=ContentRole.VIEWER)
        )
        await session.commit()

        reconnected, _ = await _connect(
            session, access, providers, CalendarProvider.GOOGLE, code="code-again"
        )
        old = await _fresh(session, Calendar, connected.calendar_id)
        assert old.calendar_type == CalendarType.PERSONAL
        moved = await _fresh(session, ConnectedCalendar, connected.id)
        assert moved.calendar_id != connected.calendar_id
        await _sync(session, reconnected)
        mirrored = await _linked_events(session, connected.id)
        assert (await _fresh(session, CalendarEvent, mirrored["evt-s"].id)).calendar_id == (
            moved.calendar_id
        )


class TestTokensAndGraphDelta:
    async def test_two_jobs_refreshing_at_once_spend_the_refresh_token_once(
        self, session, access, providers
    ):
        connection, _ = await _connect(session, access, providers, CalendarProvider.MICROSOFT)
        await session.execute(
            update(CalendarConnection)
            .where(CalendarConnection.id == connection.id)
            .values(access_token_expires_at=datetime.now(UTC) - timedelta(minutes=1))
        )
        await session.commit()
        before = providers.graph.tokens.refresh_calls

        async def one() -> str:
            async with open_session() as own:
                return (await access_token_for(own, connection.id, connection.generation)).token

        first, second = await asyncio.gather(one(), one())

        assert first == second
        assert providers.graph.tokens.refresh_calls - before == 1
        rotated = await _fresh(session, CalendarConnection, connection.id)
        assert rotated.status == ConnectionStatus.ACTIVE

    async def test_graph_delta_carries_changes_and_a_lost_link_rereads(
        self, session, access, providers
    ):
        providers.graph.put_event(_graph_event("AAMk-1", "One"))
        connection, _ = await _connect(session, access, providers, CalendarProvider.MICROSOFT)
        await _sync(session, connection)
        connected = await _primary(session, connection)
        assert "$deltatoken" in connected.cursor

        providers.graph.put_event(_graph_event("AAMk-2", "Two"))
        report = await _sync(session, connection)
        assert report.created == 1
        assert set(await _linked_events(session, connected.id)) == {"AAMk-1", "AAMk-2"}

        providers.graph.expired_links.add(str(providers.graph.position))
        refreshed = await _primary(session, connection)
        providers.graph.remove_event("AAMk-1")
        providers.graph.events.pop("AAMk-1")
        providers.graph.expired_links.add(refreshed.cursor.split("=")[-1])
        report = await _sync(session, connection)
        assert report.deleted == 1
        assert set(await _linked_events(session, connected.id)) == {"AAMk-2"}


class TestPushIngress:
    async def test_a_google_notification_with_the_right_secret_moves_the_sync_up(
        self, session, access, providers
    ):
        connection, _ = await _connect(session, access, providers, CalendarProvider.GOOGLE)
        connected = await _primary(session, connection)
        later = datetime.now(UTC) + timedelta(hours=1)
        await session.execute(
            update(ConnectedCalendar)
            .where(ConnectedCalendar.id == connected.id)
            .values(
                push_channel_id="chan-1",
                push_secret_digest=secret_digest("channel-secret"),
                next_sync_at=later,
            )
        )
        await session.commit()

        with patch.object(ingress, "enqueue_job_reconnecting", AsyncMock()) as enqueue:
            refused = await ingress._wake("chan-1", "wrong", CalendarProvider.GOOGLE, rescan=False)
            accepted = await ingress._wake(
                "chan-1", "channel-secret", CalendarProvider.GOOGLE, rescan=False
            )

        assert (refused, accepted) == (False, True)
        assert enqueue.await_count == 1
        woken = await _primary(session, connection)
        assert woken.next_sync_at < later


class TestSyncGuards:
    @pytest.mark.parametrize("removal", [False, True])
    async def test_attendee_copy_cannot_restore_a_revoked_invitation(
        self, session, access, providers, removal
    ):
        uid = "revoked-invite@example.com"
        organizer = _google_event(
            "owner-copy",
            "Private meeting",
            iCalUID=uid,
            attendees=[{"email": providers.graph.email, "responseStatus": "accepted"}],
        )
        guest = _graph_event(
            "guest-copy",
            "Private meeting",
            iCalUId=uid,
            isOrganizer=False,
            organizer={"emailAddress": {"address": providers.google.email}},
            attendees=[
                {
                    "emailAddress": {"address": providers.graph.email},
                    "type": "required",
                    "status": {"response": "accepted"},
                }
            ],
        )
        providers.google.put_event(providers.google.email, organizer)
        providers.graph.put_event(guest)
        owner, _ = await _connect(session, access, providers, CalendarProvider.GOOGLE)
        peer, _ = await _connect(
            session,
            access,
            providers,
            CalendarProvider.MICROSOFT,
            user_id=access.peer_id,
            code="peer-connect",
        )
        await _sync(session, owner)
        await _sync(session, peer)
        connected = await _primary(session, owner)
        event_id = (await _linked_events(session, connected.id))["owner-copy"].id
        organizer["attendees"] = []
        providers.google.put_event(providers.google.email, organizer)
        await _sync(session, owner)
        if removal:
            providers.graph.remove_event("guest-copy")
        else:
            guest["responseStatus"] = {"response": "tentativelyAccepted"}
            providers.graph.put_event(guest)
        await _sync(session, peer)
        assert (
            await session.scalar(
                select(EventAttendee.id).where(
                    EventAttendee.event_id == event_id,
                    EventAttendee.user_id == access.peer_id,
                )
            )
            is None
        )
        event = await _fresh(session, CalendarEvent, event_id)
        assert (
            await CalendarEventOperations(session, _indexer(), None)._resolve_role(
                access.peer_id, access.org_id, event
            )
            is None
        )

    async def test_deactivated_owner_cannot_change_calendar_settings(
        self, session, access, providers
    ):

        connection, _ = await _connect(session, access, providers, CalendarProvider.GOOGLE)
        await _sync(session, connection)
        connected = await _primary(session, connection)
        await session.execute(
            update(OrganizationMember)
            .where(
                OrganizationMember.organization_id == access.org_id,
                OrganizationMember.user_id == access.member_id,
            )
            .values(is_active=False)
        )
        await session.commit()
        with pytest.raises(PermissionDeniedError):
            await connection_ops.update_connected_calendar(
                session,
                access.member_id,
                access.org_id,
                connected.id,
                sync_enabled=False,
                direction=None,
                counts_as_busy=not connected.counts_as_busy,
            )
        await session.rollback()
        saved = await _primary(session, connection)
        assert saved.sync_enabled == connected.sync_enabled
        assert saved.counts_as_busy == connected.counts_as_busy

    async def test_empty_sync_rebuilds_search_after_an_outage(self, session, access, providers):

        peer_email = await _email(session, access.peer_id)
        providers.google.put_event(
            providers.google.email,
            _google_event(
                "search-recovery",
                "Recover searchable meeting",
                attendees=[{"email": peer_email, "responseStatus": "accepted"}],
            ),
        )
        connection, _ = await _connect(session, access, providers, CalendarProvider.GOOGLE)
        engine = RecordingSearchEngine()
        engine.available = False
        indexer = recording_indexer(engine)
        await _sync(session, connection, indexer)
        connected = await _primary(session, connection)
        event_id = (await _linked_events(session, connected.id))["search-recovery"].id
        assert connected.search_stale
        assert engine.indexed(ContentType.CALENDAR_EVENT, event_id) is None
        engine.available = True
        report = await _sync(session, connection, indexer)
        assert report.status == SyncStatus.UNCHANGED
        document = engine.indexed(ContentType.CALENDAR_EVENT, event_id)
        assert document is not None
        assert str(access.peer_id) in document["attendee_user_ids"]
        assert not (await _primary(session, connection)).search_stale

    async def test_push_claims_serialize_across_operations(self, session, access, providers):

        connection, _ = await _connect(session, access, providers, CalendarProvider.GOOGLE)
        connected = await _primary(session, connection)
        event_id = generate_id()
        pushes = [
            CalendarProviderPush(
                organization_id=access.org_id,
                event_id=event_id,
                connected_calendar_id=connected.id,
                actor_id=access.member_id,
                generation=connection.generation,
                operation=operation,
            )
            for operation in (PushOperation.UPSERT, PushOperation.DELETE)
        ]
        session.add_all(pushes)
        await session.commit()
        first_id, second_id = [row.id for row in pushes]
        first_claimed = asyncio.Event()
        release_first = asyncio.Event()
        second_started = asyncio.Event()
        async with open_session() as first, open_session() as second:
            commit = first.commit

            async def hold_claim():
                first_claimed.set()
                await release_first.wait()
                await commit()

            async def second_claim():
                second_started.set()
                return await claim_push(second, second_id, connection.generation)

            with patch.object(first, "commit", hold_claim):
                task = asyncio.create_task(claim_push(first, first_id, connection.generation))
                await asyncio.wait_for(first_claimed.wait(), timeout=5)
                other = asyncio.create_task(second_claim())
                await second_started.wait()
                # The second transaction reaches PostgreSQL while the first holds the claim.
                done, _ = await asyncio.wait({other}, timeout=0.2)
                release_first.set()
                claims = await asyncio.wait_for(asyncio.gather(task, other), timeout=5)
        assert not done
        assert claims[0] is not None
        assert claims[1] is None
        rows = await _pending_pushes(session, event_id)
        assert sorted(row.state for row in rows) == sorted([PushState.IN_FLIGHT, PushState.PENDING])

    @pytest.mark.parametrize("provider", [CalendarProvider.GOOGLE, CalendarProvider.MICROSOFT])
    async def test_hidden_guest_list_is_filtered_for_every_viewer(
        self, session, access, providers, provider
    ):

        peer_email = await _email(session, access.peer_id)
        admin_email = await _email(session, access.admin_id)
        if provider == CalendarProvider.GOOGLE:
            providers.google.put_event(
                providers.google.email,
                _google_event(
                    "private-roster",
                    "Private roster",
                    guestsCanSeeOtherGuests=False,
                    attendees=[
                        {"email": email, "responseStatus": "accepted"}
                        for email in (
                            peer_email,
                            admin_email,
                            OUTSIDE_GUEST,
                        )
                    ],
                ),
            )
        else:
            providers.graph.put_event(
                _graph_event(
                    "private-roster",
                    "Private roster",
                    hideAttendees=True,
                    attendees=[
                        {
                            "emailAddress": {"address": email},
                            "type": "required",
                            "status": {"response": "accepted"},
                        }
                        for email in (peer_email, admin_email, OUTSIDE_GUEST)
                    ],
                )
            )
        connection, _ = await _connect(session, access, providers, provider)
        await _sync(session, connection)
        connected = await _primary(session, connection)
        event_id = (await _linked_events(session, connected.id))["private-roster"].id
        event = await _fresh(session, CalendarEvent, event_id)
        assert event.guest_list_hidden
        owner_view = await provider_details(session, event, access.member_id)
        assert {p.email for p in owner_view.participants} >= {peer_email, admin_email, OUTSIDE_GUEST}
        peer_view = await provider_details(session, event, access.peer_id)
        assert {p.email for p in peer_view.participants if not p.is_organizer} == {peer_email}
        attendees = await queries.get_attendees_for_events(
            session, [event_id], viewer_id=access.peer_id
        )
        assert {a.user_id for a, _ in attendees[event_id]} == {access.peer_id, access.member_id}
        _, agent_attendees = await CalendarEventOperations(
            session, _indexer(), None
        ).get_event_with_attendees(
            access.peer_id,
            access.org_id,
            event_id,
        )
        assert {a.user_id for a, _ in agent_attendees} == {access.peer_id, access.member_id}
        exports = await build_exports(
            session, [event], viewer_id=access.peer_id, organization_id=access.org_id
        )
        assert admin_email not in {a.person.email for e in exports for a in e.attendees}
        bundle = await load_bundle(session, event_id)
        assert bundle is not None
        request = EventMailRequest(
            delivery_id=generate_id(),
            organization_id=access.org_id,
            recipient_id=access.peer_id,
            event_id=event_id,
            kind=CalendarMailKind.INVITATION,
            occurrence_date=None,
            changes=(),
        )
        document = build_message_document(bundle, request, recipient_email=peer_email).decode()
        assert peer_email in document
        assert admin_email not in document
        assert OUTSIDE_GUEST not in document

    async def test_google_rsvp_keeps_other_guests(self, session, access, providers):
        providers.google.put_event(
            providers.google.email,
            _google_event(
                "rsvp-copy",
                "Invitation",
                organizer={"email": OUTSIDE_GUEST},
                attendees=[
                    {"email": providers.google.email, "self": True, "responseStatus": "needsAction"},
                    {"email": "another@example.com", "responseStatus": "tentative"},
                ],
            ),
        )
        connection, _ = await _connect(session, access, providers, CalendarProvider.GOOGLE)
        await _sync(session, connection)
        connected = await _primary(session, connection)
        event_id = (await _linked_events(session, connected.id))["rsvp-copy"].id
        await CalendarEventOperations(session, _indexer(), None).update_attendee_status(
            access.member_id,
            access.org_id,
            event_id,
            AttendeeStatus.ACCEPTED,
        )
        (push,) = await _pending_pushes(session, event_id)
        await run_push(session, push.id, push.generation, _indexer())
        guests = providers.google.events[providers.google.email]["rsvp-copy"]["attendees"]
        assert {g["email"]: g["responseStatus"] for g in guests} == {
            providers.google.email: "accepted",
            "another@example.com": "tentative",
        }

    @pytest.mark.parametrize("bounded", [False, True])
    async def test_snapshot_sweep_respects_both_window_bounds_and_recurrence(
        self, session, access, providers, bounded
    ):

        connection, _ = await _connect(session, access, providers, CalendarProvider.MICROSOFT)
        connected = await _primary(session, connection)
        target = SyncTargetRow(
            connected_calendar_id=connected.id,
            organization_id=access.org_id,
            owner_id=access.member_id,
            calendar_id=connected.calendar_id,
        )
        end = START + timedelta(days=10)
        items = tuple(
            ProviderEvent(
                provider_event_id=key,
                kind=ItemKind.MASTER if rule else ItemKind.SINGLE,
                title=key,
                start_time=start,
                end_time=start + timedelta(hours=1),
                recurrence=rule,
            )
            for key, start, rule in (
                ("inside", START + timedelta(days=1), ()),
                ("future", end + timedelta(days=1), ()),
                ("past", START - timedelta(days=20), ()),
                ("future-series", end + timedelta(days=1), ("RRULE:FREQ=DAILY;COUNT=3",)),
                ("ended-series", START - timedelta(days=20), ("RRULE:FREQ=DAILY;COUNT=3",)),
                ("inside-series", START - timedelta(days=20), ("RRULE:FREQ=DAILY",)),
            )
        )
        await stage_provider_changes(
            session,
            target,
            ChangeBatch(items=items),
            members={},
            scan_id=None,
            window_start=START,
        )
        await session.commit()
        events = await _linked_events(session, connected.id)
        outcome = await stage_provider_changes(
            session,
            target,
            ChangeBatch(items=(), full_scan=True),
            members={},
            scan_id=generate_id(),
            window_start=START,
            window_end=end if bounded else None,
        )
        await session.commit()
        removed = {"inside", "inside-series"}
        if not bounded:
            removed |= {"future", "future-series"}
        assert set(outcome.removed_ids) == {events[key].id for key in removed}
        for key in events.keys() - removed:
            assert not (await _fresh(session, CalendarEvent, events[key].id)).is_deleted


class TestEgressLifecycle:
    @pytest.mark.parametrize("provider", [CalendarProvider.GOOGLE, CalendarProvider.MICROSOFT])
    async def test_oauth_uses_a_sealed_egress_job_without_holding_the_api_transaction(
        self, session, access, providers, monkeypatch, provider
    ):
        code = "secret-authorization-code"
        seen = []

        async def complete(ref, user_id, org_id, sealed, **kwargs):
            assert ref == COMPLETE_CALENDAR_CONNECTION
            assert ref.queue == QueueName.EGRESS
            assert code not in sealed
            assert not session.in_transaction()
            assert not providers.google.tokens.refresh_tokens
            assert not providers.graph.tokens.refresh_tokens
            result = await lifecycle_jobs.complete_calendar_connection({}, user_id, org_id, sealed)
            assert "access_token" not in repr(result)
            assert "refresh_token" not in repr(result)
            seen.append(result)
            return result

        monkeypatch.setattr(oauth_module, "run_job_and_wait", complete)
        connection, _ = await _connect(session, access, providers, provider, code=code)
        assert connection.status == ConnectionStatus.ACTIVE
        assert len(seen) == 1

    async def test_queue_failure_does_not_exchange_or_consume_the_callback(
        self, session, access, providers, monkeypatch
    ):
        monkeypatch.setattr(
            oauth_module, "run_job_and_wait", AsyncMock(side_effect=RuntimeError("secret-code"))
        )
        with pytest.raises(UnavailableError) as error:
            await _connect(session, access, providers, CalendarProvider.GOOGLE)
        assert "secret-code" not in str(error.value)
        assert not providers.google.tokens.refresh_tokens
        assert (
            await session.scalar(
                select(CalendarConnection.id).where(
                    CalendarConnection.organization_id == access.org_id,
                )
            )
            is None
        )
        attempt = await session.scalar(
            select(CalendarConnectionAttempt).where(
                CalendarConnectionAttempt.organization_id == access.org_id,
            )
        )
        assert attempt.consumed_at is None

    async def test_worker_rechecks_membership_after_queue_delay(
        self, session, access, providers, monkeypatch
    ):
        async def delayed(ref, user_id, org_id, sealed, **kwargs):
            async with open_session() as worker_session:
                await worker_session.execute(
                    update(OrganizationMember)
                    .where(
                        OrganizationMember.organization_id == access.org_id,
                        OrganizationMember.user_id == access.member_id,
                    )
                    .values(is_active=False)
                )
                await worker_session.commit()
            return await lifecycle_jobs.complete_calendar_connection({}, user_id, org_id, sealed)

        monkeypatch.setattr(oauth_module, "run_job_and_wait", delayed)
        with pytest.raises(MembershipRequiredError):
            await _connect(session, access, providers, CalendarProvider.GOOGLE)
        assert not providers.google.tokens.refresh_tokens

    async def test_worker_rechecks_membership_after_provider_response(
        self, session, access, providers, monkeypatch
    ):
        original = GoogleCalendarClient.identity

        async def identity(client, grant):
            result = await original(client, grant)
            async with open_session() as worker_session:
                await worker_session.execute(
                    update(OrganizationMember)
                    .where(
                        OrganizationMember.organization_id == access.org_id,
                        OrganizationMember.user_id == access.member_id,
                    )
                    .values(is_active=False)
                )
                await worker_session.commit()
            return result

        monkeypatch.setattr(GoogleCalendarClient, "identity", identity)
        with pytest.raises(MembershipRequiredError):
            await _connect(session, access, providers, CalendarProvider.GOOGLE)
        assert providers.google.tokens.refresh_tokens
        assert (
            await session.scalar(
                select(CalendarConnection.id).where(
                    CalendarConnection.organization_id == access.org_id,
                )
            )
            is None
        )

    async def test_expired_queued_callback_never_contacts_provider(
        self, session, access, providers, monkeypatch
    ):
        async def expired(ref, user_id, org_id, sealed, **kwargs):
            async with open_session() as worker_session:
                cipher = OrgCipher(worker_session)
                payload = loads(await cipher.decrypt(access.org_id, sealed))
                payload["deadline"] = (datetime.now(UTC) - timedelta(seconds=1)).isoformat()
                sealed = await cipher.encrypt(access.org_id, dumps_str(payload))
            return await lifecycle_jobs.complete_calendar_connection({}, user_id, org_id, sealed)

        monkeypatch.setattr(oauth_module, "run_job_and_wait", expired)
        with pytest.raises(ValidationError, match="expired"):
            await _connect(session, access, providers, CalendarProvider.GOOGLE)
        assert not providers.google.tokens.refresh_tokens

    @pytest.mark.parametrize("reconnect", [False, True])
    async def test_disconnect_commits_before_sealed_cleanup_and_skips_reconnected_accounts(
        self, session, access, providers, monkeypatch, reconnect
    ):
        connection, _ = await _connect(session, access, providers, CalendarProvider.GOOGLE)
        token = next(iter(providers.google.tokens.refresh_tokens))
        queued = []

        async def enqueue(ref, *args, **kwargs):
            assert ref == CLEANUP_CALENDAR_CONNECTION
            assert ref.queue == QueueName.EGRESS
            assert token not in repr(args)
            assert not session.in_transaction()
            async with open_session() as worker_session:
                saved = await worker_session.get(CalendarConnection, connection.id)
                assert saved.status == ConnectionStatus.DISCONNECTED
                assert saved.refresh_token_encrypted is None
            queued.append(args)
            return JobEnqueueResult(job=None, outcome=JobEnqueueOutcome.ENQUEUED)

        monkeypatch.setattr(cleanup_module, "enqueue_job_reconnecting", enqueue)
        await connection_ops.disconnect(session, access.member_id, access.org_id, connection.id)
        assert not providers.google.tokens.revoked
        assert len(queued) == 1
        if reconnect:
            await _connect(session, access, providers, CalendarProvider.GOOGLE, code="reconnect")
        result = await lifecycle_jobs.cleanup_calendar_connection({}, *queued[0])
        assert result["status"] == (CleanupStatus.SKIPPED if reconnect else CleanupStatus.DONE)
        assert bool(providers.google.tokens.revoked) is not reconnect

    async def test_unavailable_cleanup_queue_keeps_local_disconnect(
        self, session, access, providers, monkeypatch
    ):
        connection, _ = await _connect(session, access, providers, CalendarProvider.GOOGLE)
        monkeypatch.setattr(
            cleanup_module,
            "enqueue_job_reconnecting",
            AsyncMock(side_effect=RuntimeError("queue down")),
        )
        await connection_ops.disconnect(session, access.member_id, access.org_id, connection.id)
        saved = await _fresh(session, CalendarConnection, connection.id)
        assert saved.status == ConnectionStatus.DISCONNECTED
        assert saved.refresh_token_encrypted is None
        assert not providers.google.tokens.revoked

    async def test_worker_exception_returns_no_sensitive_details(
        self, session, access, providers, monkeypatch
    ):
        monkeypatch.setattr(
            lifecycle_jobs,
            "exchange_connection",
            AsyncMock(side_effect=RuntimeError("secret-code-and-token")),
        )
        with pytest.raises(UnavailableError) as error:
            await _connect(session, access, providers, CalendarProvider.GOOGLE)
        assert "secret-code-and-token" not in str(error.value)
        assert not providers.google.tokens.refresh_tokens

    async def test_callback_round_trip_through_real_valkey_and_egress_registration(
        self, session, access, providers, monkeypatch
    ):
        queue_name = f"test:calendar-egress:{generate_id()}"
        job_id = f"{queue_name}:connect"
        pool = get_queue(QueueName.EGRESS)

        async def complete(ref, *args, **kwargs):
            pending = asyncio.create_task(
                actual_run_job_and_wait(
                    ref,
                    *args,
                    **kwargs,
                    _queue_name=queue_name,
                    _job_id=job_id,
                )
            )
            try:
                async with asyncio.timeout(5):
                    while not await pool.zcard(queue_name):
                        await asyncio.sleep(0.01)
                worker = Worker(
                    EGRESS_JOBS,
                    queue_name=queue_name,
                    valkey_pool=pool,
                    job_serializer=serialize_job_payload,
                    job_deserializer=deserialize_job_payload,
                    burst=True,
                    handle_signals=False,
                    poll_delay=0.01,
                )
                await asyncio.wait_for(worker.main(), timeout=10)
                return await pending
            finally:
                if not pending.done():
                    pending.cancel()
                    await asyncio.gather(pending, return_exceptions=True)
                await pool.delete(
                    queue_name,
                    f"arq:job:{job_id}",
                    f"arq:result:{job_id}",
                    f"{queue_name}:health-check",
                )

        monkeypatch.setattr(oauth_module, "run_job_and_wait", complete)
        connection, _ = await _connect(session, access, providers, CalendarProvider.GOOGLE)
        assert connection.status == ConnectionStatus.ACTIVE
        assert providers.google.tokens.refresh_tokens

    @pytest.mark.parametrize("provider", [CalendarProvider.GOOGLE, CalendarProvider.MICROSOFT])
    async def test_channel_stop_runs_only_when_cleanup_job_executes(
        self, session, access, providers, monkeypatch, provider
    ):
        monkeypatch.setenv("CALENDAR_PUSH_BASE_URL", "https://calendar.example.com")
        connection, _ = await _connect(session, access, providers, provider)
        await _sync(session, connection)
        connected = await _primary(session, connection)
        assert connected.push_channel_id
        channels = (
            providers.google.channels
            if provider == CalendarProvider.GOOGLE
            else providers.graph.subscriptions
        )
        assert connected.push_channel_id in channels
        enqueue = AsyncMock(
            return_value=JobEnqueueResult(job=None, outcome=JobEnqueueOutcome.ENQUEUED)
        )
        monkeypatch.setattr(cleanup_module, "enqueue_job_reconnecting", enqueue)
        await connection_ops.disconnect(session, access.member_id, access.org_id, connection.id)
        assert connected.push_channel_id in channels
        ref, *args = enqueue.await_args.args
        assert ref == CLEANUP_CALENDAR_CONNECTION
        result = await lifecycle_jobs.cleanup_calendar_connection({}, *args)
        assert result["status"] == CleanupStatus.DONE
        assert connected.push_channel_id not in channels

    async def test_provider_response_after_callback_deadline_is_not_committed(
        self, session, access, providers, monkeypatch
    ):
        original = GoogleCalendarClient.identity

        class LateClock(datetime):
            @classmethod
            def now(cls, tz=None):
                return datetime.now(tz) + timedelta(minutes=5)

        async def identity(client, grant):
            result = await original(client, grant)
            monkeypatch.setattr(oauth_module, "datetime", LateClock)
            return result

        monkeypatch.setattr(GoogleCalendarClient, "identity", identity)
        with pytest.raises(ValidationError, match="expired"):
            await _connect(session, access, providers, CalendarProvider.GOOGLE)
        assert providers.google.tokens.refresh_tokens
        assert (
            await session.scalar(
                select(CalendarConnection.id).where(
                    CalendarConnection.organization_id == access.org_id,
                )
            )
            is None
        )
