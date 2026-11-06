"""External feed subscriptions, asserted on the rows real PostgreSQL holds."""

import asyncio
import time
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import delete, func, select, update

from uniffy.core.audit.actions import Action
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.events.bus import event_from_json
from uniffy.core.jobs import JobEnqueueOutcome, JobEnqueueResult
from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.calendar.exception import RecurrenceException
from uniffy.core.models.calendar.subscription import CalendarSubscription, SubscriptionFailure
from uniffy.core.models.notifications.outbox import NotificationOutbox
from uniffy.core.outbound import FetchResult, OutboundFailure, OutboundFetchError
from uniffy.core.search import SearchIndexer
from uniffy.core.search.engine import SearchAll, SearchAny, SearchFilter, SearchTerm
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import AccessMode, ContentRole, ContentType, NotificationType
from uniffy.domains.permissions.access import ResourceAccessResolver, ResourceKey
from uniffy.domains.permissions.members import ContentMembersOperations
from uniffy.domains.scheduling.calendar import search as calendar_search
from uniffy.domains.scheduling.calendar.availability import get_busy_intervals
from uniffy.domains.scheduling.calendar.calendars import search as calendars_search
from uniffy.domains.scheduling.calendar.calendars.operations import CalendarOperations
from uniffy.domains.scheduling.calendar.calendars.reader import CalendarReader, CalendarSection
from uniffy.domains.scheduling.calendar.events.operations import CalendarEventOperations
from uniffy.domains.scheduling.calendar.ical.parse import FEED_LIMITS, parse_calendar
from uniffy.domains.scheduling.calendar.ical.sync import stage_feed_sync
from uniffy.domains.scheduling.calendar.jobs import subscriptions as subscription_jobs
from uniffy.domains.scheduling.calendar.policy import (
    CalendarPolicyAudience,
    update_calendar_policy,
)
from uniffy.domains.scheduling.calendar.realtime import EventRealtimeAdapter
from uniffy.domains.scheduling.calendar.rpc.calendars import listings_to_proto
from uniffy.domains.scheduling.calendar.subscriptions import operations as subscription_ops
from uniffy.domains.scheduling.calendar.subscriptions import refresh as refresh_module
from uniffy.domains.scheduling.calendar.subscriptions.operations import (
    CalendarSubscriptionOperations,
)
from uniffy.domains.scheduling.calendar.subscriptions.refresh import RefreshStatus, run_refresh
from uniffy.domains.scheduling.calendar.subscriptions.verify import FeedCheckFailed
from uniffy.infrastructure.database import open_session

pytestmark = pytest.mark.asyncio(loop_scope="session")

SECRET_URL = "webcal://calendar.example.com/private-5f2c9e/basic.ics"
SECRET = "private-5f2c9e"
SECRET_HOST = "calendar.example.com"
PLAIN_HOST = "example.org"
ANA_SHIFT = "rota-1"
RENAMED = "On call: Boris"
DEFANGED_TITLE = "Hi CEO"
URN_FIELD = "urn"
DAY = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=2)


def _stamp(moment: datetime) -> bytes:
    return moment.strftime("%Y%m%dT%H%M%SZ").encode()


def _vevent(uid: str, summary: str, start: datetime, *, extra: bytes = b"") -> bytes:
    return (
        b"BEGIN:VEVENT\r\nUID:" + uid.encode() + b"\r\nSUMMARY:" + summary.encode() + b"\r\n"
        b"DTSTAMP:" + _stamp(datetime.now(UTC)) + b"\r\n"
        b"DTSTART:"
        + _stamp(start)
        + b"\r\nDTEND:"
        + _stamp(start + timedelta(hours=1))
        + b"\r\n"
        + extra
        + b"END:VEVENT\r\n"
    )


def _feed(*events: bytes) -> bytes:
    return (
        b"BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n"
        + b"".join(events)
        + b"END:VCALENDAR\r\n"
    )


ROTA = _feed(
    _vevent("rota-1", "On call: Ana", DAY + timedelta(hours=9)),
    _vevent(
        "rota-2",
        "Standup",
        DAY + timedelta(hours=10),
        extra=b"RRULE:FREQ=DAILY;COUNT=5\r\nEXDATE:"
        + _stamp(DAY + timedelta(days=1, hours=10))
        + b"\r\n",
    ),
    _vevent(
        "rota-2",
        "Standup (moved)",
        DAY + timedelta(days=2, hours=11),
        extra=b"RECURRENCE-ID:" + _stamp(DAY + timedelta(days=2, hours=10)) + b"\r\n",
    ),
)


def _indexer() -> AsyncMock:
    return AsyncMock(spec=SearchIndexer)


def _indexed(indexer: AsyncMock) -> dict[str, dict]:
    return {
        document["urn"]: document
        for call in indexer.batch_index.await_args_list
        for document in call.args[0]
    }


def _urn_terms(expression: SearchFilter) -> set[str]:
    if isinstance(expression, SearchTerm):
        return {str(expression.value)} if expression.field == URN_FIELD else set()
    if isinstance(expression, (SearchAll, SearchAny)):
        return set().union(*(_urn_terms(inner) for inner in expression.expressions))
    return set()


def _removed(indexer: AsyncMock) -> set[str]:
    return set().union(
        set(), *(_urn_terms(call.args[0]) for call in indexer.remove_by_filter.await_args_list)
    )


def _event_urn(event_id) -> str:
    return build_content_urn(ContentType.CALENDAR_EVENT, event_id)


def _ops(session) -> CalendarSubscriptionOperations:
    return CalendarSubscriptionOperations(session, AsyncMock(spec=SearchIndexer))


@pytest.fixture(autouse=True)
def _quiet_effects():
    """Queueing and realtime fan-out are not under test; the rows are."""
    with (
        patch.object(subscription_ops, "enqueue_job_reconnecting", AsyncMock()),
        patch.object(subscription_ops, "verify_address", AsyncMock()),
        patch.object(subscription_ops, "run_job_and_wait", AsyncMock()),
        patch.object(refresh_module, "publish_content_changed", AsyncMock()),
        patch.object(calendar_search, "publish_mention_state", AsyncMock()),
        patch.object(calendars_search, "publish_mention_state", AsyncMock()),
    ):
        yield


async def _subscribe(session, access, *, url: str = SECRET_URL, busy: bool = False) -> Calendar:
    return await _ops(session).create(
        access.member_id,
        access.org_id,
        url=url,
        name="Team rota",
        color="#22c55e",
        refresh_interval_minutes=60,
        counts_as_busy=busy,
    )


async def _subscription(session, calendar_id) -> CalendarSubscription:
    return await session.scalar(
        select(CalendarSubscription)
        .where(CalendarSubscription.calendar_id == calendar_id)
        .execution_options(populate_existing=True)
    )


async def _events(session, calendar_id) -> list[CalendarEvent]:
    return list(
        (
            await session.execute(
                select(CalendarEvent)
                .where(CalendarEvent.calendar_id == calendar_id)
                .execution_options(populate_existing=True)
            )
        ).scalars()
    )


async def _sync(session, access, calendar_id, payload: bytes):
    outcome = await stage_feed_sync(
        session,
        organization_id=access.org_id,
        owner_id=access.member_id,
        calendar_id=calendar_id,
        parsed=parse_calendar(payload, FEED_LIMITS),
    )
    await session.commit()
    return outcome


class TestSync:
    async def test_a_first_sync_mirrors_series_moves_and_cancellations(self, session, access):
        calendar = await _subscribe(session, access)
        outcome = await _sync(session, access, calendar.id, ROTA)

        assert (outcome.created, outcome.updated, outcome.deleted) == (2, 0, 0)
        events = await _events(session, calendar.id)
        masters = {e.ical_uid: e for e in events if e.recurrence_id is None}
        assert set(masters) == {"rota-1", "rota-2"}
        assert all(e.organizer_id == access.member_id for e in events)
        assert all(e.access_mode is AccessMode.OWNER_ONLY for e in events)
        overrides = [e for e in events if e.recurrence_id is not None]
        assert [o.title for o in overrides] == ["Standup (moved)"]
        exceptions = (
            (
                await session.execute(
                    select(RecurrenceException).where(
                        RecurrenceException.event_id == masters["rota-2"].id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert sorted((x.override_event_id is not None) for x in exceptions) == [False, True]

    async def test_an_identical_feed_writes_nothing(self, session, access):
        calendar = await _subscribe(session, access)
        await _sync(session, access, calendar.id, ROTA)
        before = {e.id: e.updated_at for e in await _events(session, calendar.id)}

        outcome = await _sync(session, access, calendar.id, ROTA)

        assert not outcome.changed
        assert outcome.unchanged == 2
        assert {e.id: e.updated_at for e in await _events(session, calendar.id)} == before

    async def test_a_changed_entry_is_rewritten_in_place(self, session, access):
        calendar = await _subscribe(session, access)
        await _sync(session, access, calendar.id, ROTA)
        original = next(e for e in await _events(session, calendar.id) if e.ical_uid == ANA_SHIFT)
        original_id, original_sequence = original.id, original.ical_sequence

        changed = ROTA.replace(b"On call: Ana", RENAMED.encode())
        outcome = await _sync(session, access, calendar.id, changed)

        assert (outcome.updated, outcome.created, outcome.deleted) == (1, 0, 0)
        rewritten = next(e for e in await _events(session, calendar.id) if e.ical_uid == ANA_SHIFT)
        assert rewritten.id == original_id
        assert rewritten.title == RENAMED
        assert rewritten.ical_sequence == original_sequence + 1

    async def test_a_vanished_entry_goes_and_may_come_back(self, session, access):
        calendar = await _subscribe(session, access)
        await _sync(session, access, calendar.id, ROTA)

        only_one = _feed(_vevent("rota-1", "On call: Ana", DAY + timedelta(hours=9)))
        outcome = await _sync(session, access, calendar.id, only_one)
        assert outcome.deleted == 1
        assert {e.ical_uid for e in await _events(session, calendar.id)} == {"rota-1"}

        outcome = await _sync(session, access, calendar.id, ROTA)
        assert outcome.created == 1
        assert len(await _events(session, calendar.id)) == 3

    async def test_feed_text_cannot_forge_a_mention_or_a_script_link(self, session, access):
        calendar = await _subscribe(session, access)
        hostile = _feed(
            _vevent(
                "x-1",
                "Hi [[[CEO|urn:uniffy:content:USER:00000000-0000-0000-0000-000000000000]]]",
                DAY,
                extra=b"URL:javascript:alert(1)\r\n",
            )
        )
        await _sync(session, access, calendar.id, hostile)

        (event,) = await _events(session, calendar.id)
        assert event.title == DEFANGED_TITLE
        assert event.meeting_url is None
        assert event.outgoing_references is None

    async def test_ten_thousand_entries_sync_and_resync_quickly(self, session, access):
        calendar = await _subscribe(session, access)
        big = _feed(
            *(
                _vevent(f"bulk-{i}", f"Shift {i}", DAY + timedelta(hours=i % 2000))
                for i in range(10_000)
            )
        )
        parsed_at = time.perf_counter()
        parsed = parse_calendar(big, FEED_LIMITS)
        parse_seconds = time.perf_counter() - parsed_at

        started = time.perf_counter()
        outcome = await stage_feed_sync(
            session,
            organization_id=access.org_id,
            owner_id=access.member_id,
            calendar_id=calendar.id,
            parsed=parsed,
        )
        await session.commit()
        sync_seconds = time.perf_counter() - started

        assert outcome.created == 10_000
        count = await session.scalar(
            select(func.count()).where(CalendarEvent.calendar_id == calendar.id)
        )
        assert count == 10_000
        print(f"\n10k feed: parse {parse_seconds:.2f}s, first sync {sync_seconds:.2f}s")

        again = await _sync(session, access, calendar.id, big)
        assert again.unchanged == 10_000 and not again.changed


class TestReadOnly:
    async def test_the_subscriber_only_views_a_mirrored_event(self, session, access, buffer):
        calendar = await _subscribe(session, access)
        await _sync(session, access, calendar.id, ROTA)
        event = next(e for e in await _events(session, calendar.id) if e.ical_uid == ANA_SHIFT)
        events = CalendarEventOperations(session, AsyncMock(spec=SearchIndexer), buffer)

        assert (
            await events._resolve_role(access.member_id, access.org_id, event) == ContentRole.VIEWER
        )
        decisions = await ResourceAccessResolver(session).resolve_page(
            actor_id=access.member_id,
            organization_id=access.org_id,
            keys=[ResourceKey(ContentType.CALENDAR_EVENT, event.id)],
        )
        decision = decisions[ResourceKey(ContentType.CALENDAR_EVENT, event.id)]
        assert decision.can_view and decision.role == ContentRole.VIEWER
        # The live description editor authorises the same way, one viewer or many.
        realtime = EventRealtimeAdapter(AsyncMock(spec=SearchIndexer))
        assert (
            await realtime.authorize(session, access.member_id, access.org_id, event.id)
            == ContentRole.VIEWER
        )
        assert await realtime.authorize_many(
            session, [access.member_id], access.org_id, event.id
        ) == {access.member_id: ContentRole.VIEWER}

        with pytest.raises(PermissionDeniedError):
            await events.update(
                access.member_id,
                access.org_id,
                event.id,
                title="Mine now",
                call_lifecycle=AsyncMock(),
            )
        with pytest.raises(PermissionDeniedError):
            await events.delete(access.member_id, access.org_id, event.id)

    async def test_nothing_can_be_filed_on_a_subscribed_calendar(self, session, access, buffer):
        calendar = await _subscribe(session, access)
        events = CalendarEventOperations(session, AsyncMock(spec=SearchIndexer), buffer)

        with pytest.raises(ValidationError):
            await events.create(
                access.member_id,
                access.org_id,
                title="Sneaked in",
                start_time=DAY,
                end_time=DAY + timedelta(hours=1),
                calendar_id=calendar.id,
            )

    async def test_a_subscribed_calendar_cannot_be_shared(self, session, access):
        calendar = await _subscribe(session, access)
        members = ContentMembersOperations(session, AsyncMock(spec=SearchIndexer))

        with pytest.raises(ValidationError):
            await members.set_access_mode(
                access.member_id,
                access.org_id,
                ContentType.CALENDAR,
                calendar.id,
                AccessMode.EXPLICIT_MEMBERS,
                None,
            )

    async def test_nobody_else_sees_the_calendar_or_its_events(self, session, access):
        calendar = await _subscribe(session, access)
        await _sync(session, access, calendar.id, ROTA)

        peer_calendars = await CalendarReader(session).list_calendars(access.peer_id, access.org_id)
        assert calendar.id not in {listing.calendar.id for listing in peer_calendars}
        admin_calendars = await CalendarReader(session).list_calendars(
            access.admin_id, access.org_id
        )
        assert calendar.id not in {listing.calendar.id for listing in admin_calendars}
        own = await CalendarReader(session).list_calendars(access.member_id, access.org_id)
        section = next(item.section for item in own if item.calendar.id == calendar.id)
        assert section == CalendarSection.SUBSCRIBED

        event = (await _events(session, calendar.id))[0]
        decisions = await ResourceAccessResolver(session).resolve_page(
            actor_id=access.peer_id,
            organization_id=access.org_id,
            keys=[ResourceKey(ContentType.CALENDAR_EVENT, event.id)],
        )
        assert not decisions[ResourceKey(ContentType.CALENDAR_EVENT, event.id)].can_view


class TestSubscribe:
    async def test_the_address_is_sealed_and_only_its_host_is_kept(self, session, access):
        calendar = await _subscribe(session, access)
        row = await _subscription(session, calendar.id)

        assert calendar.access_mode is AccessMode.OWNER_ONLY
        assert row.url_host == SECRET_HOST
        assert SECRET not in row.url_encrypted
        audit = await session.scalar(
            select(AuditEvent).where(
                AuditEvent.resource_id == calendar.id,
                AuditEvent.action == Action.CALENDAR_SUBSCRIPTION_CREATED,
            )
        )
        assert audit is not None
        assert SECRET not in str(audit.details)

    async def test_the_calendar_message_carries_the_feed_for_its_owner_only(self, session, access):
        calendar = await _subscribe(session, access, url="https://example.org/wire.ics")
        listings = await CalendarReader(session).list_calendars(access.member_id, access.org_id)
        own = [item for item in listings if item.calendar.id == calendar.id]

        (message,) = await listings_to_proto(session, access.member_id, access.org_id, own)

        assert message.is_read_only
        assert message.subscription is not None
        assert message.subscription.url_host == PLAIN_HOST
        assert SECRET not in str(message)

    async def test_the_same_address_twice_is_refused(self, session, access):
        await _subscribe(session, access, url="https://example.org/twice.ics")
        with pytest.raises(ValidationError):
            await _subscribe(session, access, url="webcal://EXAMPLE.org/twice.ics")

    async def test_an_unfetchable_address_is_refused_up_front(self, session, access):
        with pytest.raises(ValidationError):
            await _subscribe(session, access, url="file:///etc/passwd")

    async def test_an_address_that_cannot_be_read_saves_nothing(self, session, access):
        refused = AsyncMock(side_effect=FeedCheckFailed(SubscriptionFailure.BLOCKED_ADDRESS))
        before = await session.scalar(select(func.count()).select_from(CalendarSubscription))
        with (
            patch.object(subscription_ops, "verify_address", refused),
            pytest.raises(FeedCheckFailed),
        ):
            await _subscribe(session, access, url="https://intranet.example.org/rota.ics")

        after = await session.scalar(select(func.count()).select_from(CalendarSubscription))
        assert after == before
        assert not await session.scalar(
            select(func.count())
            .select_from(Calendar)
            .where(Calendar.owner_id == access.member_id, Calendar.name == "Team rota")
            .where(Calendar.is_deleted.is_(False))
        )

    async def test_a_replacement_address_that_cannot_be_read_keeps_the_old_one(
        self, session, access
    ):
        calendar = await _subscribe(session, access, url="https://example.org/kept.ics")
        kept = await _subscription(session, calendar.id)
        digest, sealed = kept.url_digest, kept.url_encrypted
        refused = AsyncMock(side_effect=FeedCheckFailed(SubscriptionFailure.HTTP_STATUS, 404))
        with (
            patch.object(subscription_ops, "verify_address", refused),
            pytest.raises(FeedCheckFailed),
        ):
            await _ops(session).update(
                access.member_id,
                access.org_id,
                calendar.id,
                url="https://example.org/missing.ics",
                refresh_interval_minutes=None,
                counts_as_busy=None,
            )

        row = await _subscription(session, calendar.id)
        assert (row.url_digest, row.url_encrypted) == (digest, sealed)

    async def test_retry_answers_with_the_refreshed_row(self, session, access):
        calendar = await _subscribe(session, access, url="https://example.org/retry.ics")
        waited = AsyncMock()
        with patch.object(subscription_ops, "run_job_and_wait", waited):
            await _ops(session).refresh_now(access.member_id, access.org_id, calendar.id)

        assert waited.await_args.args[0] == subscription_ops.REFRESH_CALENDAR_SUBSCRIPTION

    async def test_an_organization_can_turn_subscribing_off(self, session, access):
        await update_calendar_policy(
            session,
            access.owner_id,
            access.org_id,
            team_calendar_creators=CalendarPolicyAudience.EVERYONE,
            org_wide_calendar_sharers=CalendarPolicyAudience.EVERYONE,
            allow_external_subscriptions=False,
        )
        try:
            with pytest.raises(PermissionDeniedError):
                await _subscribe(session, access, url="https://example.org/off.ics")
        finally:
            await update_calendar_policy(
                session,
                access.owner_id,
                access.org_id,
                team_calendar_creators=CalendarPolicyAudience.EVERYONE,
                org_wide_calendar_sharers=CalendarPolicyAudience.EVERYONE,
                allow_external_subscriptions=True,
            )

    async def test_new_addresses_are_rate_limited_per_member(self, session, access):
        limit = AsyncMock()
        with patch.object(subscription_ops, "check_rate_limit", limit):
            calendar = await _subscribe(session, access, url="https://example.org/limited.ics")
            await _ops(session).update(
                access.member_id,
                access.org_id,
                calendar.id,
                url="https://example.org/limited-2.ics",
                refresh_interval_minutes=None,
                counts_as_busy=None,
            )
            await _ops(session).update(
                access.member_id,
                access.org_id,
                calendar.id,
                url=None,
                refresh_interval_minutes=None,
                counts_as_busy=True,
            )

        keys = [call.kwargs["key"] for call in limit.await_args_list]
        assert keys == [f"rl:calendar_subscription_address:{access.org_id}:{access.member_id}"] * 2

    async def test_someone_else_cannot_touch_the_subscription(self, session, access):
        calendar = await _subscribe(session, access, url="https://example.org/mine.ics")
        with pytest.raises(NotFoundError):
            await _ops(session).refresh_now(access.peer_id, access.org_id, calendar.id)

    async def test_unsubscribing_removes_the_mirror(self, session, access, buffer):
        calendar = await _subscribe(session, access, url="https://example.org/gone.ics")
        await _sync(session, access, calendar.id, ROTA)
        mirrored = {_event_urn(event.id) for event in await _events(session, calendar.id)}
        indexer = _indexer()
        calendars = CalendarOperations(session, indexer)

        with pytest.raises(ValidationError):
            other = await calendars.create_calendar(
                user_id=access.member_id, organization_id=access.org_id, name="Keep", color="#000"
            )
            await calendars.delete_calendar(
                access.member_id,
                access.org_id,
                calendar.id,
                target_calendar_id=other.id,
                buffer=buffer,
            )

        result = await calendars.delete_calendar(
            access.member_id, access.org_id, calendar.id, target_calendar_id=None, buffer=buffer
        )
        assert result.events_deleted == 2
        assert await _events(session, calendar.id) == []
        assert await _subscription(session, calendar.id) is None
        assert _removed(indexer) == mirrored


def _served(body: bytes | None, *, etag: str | None = '"v1"', status: int = 200):
    return AsyncMock(return_value=FetchResult(status, body, etag, None))


class TestRefresh:
    async def test_a_refresh_mirrors_the_feed_then_skips_an_unchanged_one(self, session, access):
        calendar = await _subscribe(session, access, url="https://example.org/refresh.ics")
        # The refresh ends its own transactions, which expires rows this test holds.
        calendar_id = calendar.id
        subscription_id = (await _subscription(session, calendar_id)).id

        with patch.object(refresh_module, "fetch_public", _served(ROTA)) as fetch:
            report = await run_refresh(session, subscription_id, _indexer())
        assert report.status == RefreshStatus.SYNCED
        assert fetch.await_args.kwargs["headers"] == {}

        row = await _subscription(session, calendar_id)
        assert (row.event_count, row.etag, row.consecutive_failures) == (2, '"v1"', 0)
        assert row.last_success_at is not None

        with patch.object(refresh_module, "fetch_public", _served(None, status=304)) as fetch:
            report = await run_refresh(session, subscription_id, _indexer())
        assert report.status == RefreshStatus.UNCHANGED
        assert fetch.await_args.kwargs["headers"] == {"if-none-match": '"v1"'}

        with patch.object(refresh_module, "fetch_public", _served(ROTA, etag='"v2"')):
            report = await run_refresh(session, subscription_id, _indexer())
        assert report.status == RefreshStatus.UNCHANGED

    async def test_three_failures_break_the_feed_and_notify_once(self, session, access):
        calendar = await _subscribe(session, access, url="https://example.org/broken.ics")
        calendar_id = calendar.id
        subscription_id = (await _subscription(session, calendar_id)).id
        refused = AsyncMock(side_effect=OutboundFetchError(OutboundFailure.HTTP_STATUS, 404))
        wake = AsyncMock()

        with (
            patch.object(refresh_module, "fetch_public", refused),
            patch.object(refresh_module, "enqueue_job_reconnecting", wake),
        ):
            for _ in range(4):
                report = await run_refresh(session, subscription_id, _indexer())
                assert report.status == RefreshStatus.FAILED

        row = await _subscription(session, calendar_id)
        assert row.consecutive_failures == 4
        assert row.last_error_code == SubscriptionFailure.HTTP_STATUS
        assert row.last_error_status == 404
        assert row.next_refresh_at > datetime.now(UTC) + timedelta(hours=4)
        # One notice, durable in the outbox the core fleet sweeps, whoever enqueues the wakeup.
        notices = [
            event
            for event in (
                event_from_json(payload)
                for payload in (
                    await session.execute(
                        select(NotificationOutbox.payload).where(
                            NotificationOutbox.organization_id == access.org_id
                        )
                    )
                ).scalars()
            )
            if event.notification_type is NotificationType.CALENDAR_SUBSCRIPTION_FAILED
            and event.source_urn
            and str(calendar_id) in event.source_urn
        ]
        assert len(notices) == 1
        assert notices[0].target_user_ids == [access.member_id]
        assert SECRET not in notices[0].body
        assert wake.await_count == 1

        with patch.object(refresh_module, "fetch_public", _served(ROTA)):
            assert (
                await run_refresh(session, subscription_id, _indexer())
            ).status == RefreshStatus.SYNCED
        row = await _subscription(session, calendar_id)
        assert (row.consecutive_failures, row.failure_notified_at, row.last_error_code) == (
            0,
            None,
            None,
        )

    async def test_a_feed_the_database_refuses_counts_as_a_failure(self, session, access):
        calendar = await _subscribe(session, access, url="https://example.org/refused.ics")
        calendar_id = calendar.id
        subscription_id = (await _subscription(session, calendar_id)).id
        refused = AsyncMock(side_effect=RuntimeError("value too long"))
        with (
            patch.object(refresh_module, "fetch_public", _served(ROTA)),
            patch.object(refresh_module, "stage_feed_sync", refused),
        ):
            report = await run_refresh(session, subscription_id, _indexer())

        assert report.failure == SubscriptionFailure.UNPROCESSABLE
        row = await _subscription(session, calendar_id)
        assert (row.consecutive_failures, row.last_error_code, row.last_success_at) == (
            1,
            SubscriptionFailure.UNPROCESSABLE,
            None,
        )
        assert row.next_refresh_at > datetime.now(UTC) + timedelta(minutes=30)
        assert await _events(session, calendar_id) == []

    async def test_unsubscribing_mid_refresh_waits_instead_of_deadlocking(self, session, access):
        calendar = await _subscribe(session, access, url="https://example.org/race.ics")
        row = await _subscription(session, calendar.id)
        source = refresh_module._Source(
            subscription_id=row.id,
            organization_id=row.organization_id,
            calendar_id=row.calendar_id,
            calendar_name="Team rota",
            url="https://example.org/race.ics",
            url_digest=row.url_digest,
            etag=None,
            last_modified=None,
            content_digest=None,
        )
        async with open_session() as deleter, open_session() as refresher:
            # Unsubscribing holds the calendar first, then removes the subscription row.
            await deleter.execute(
                select(Calendar.id).where(Calendar.id == calendar.id).with_for_update()
            )
            locking = asyncio.create_task(refresh_module._lock_unchanged(refresher, source))
            await asyncio.sleep(0.3)
            assert not locking.done()
            await deleter.execute(
                delete(CalendarSubscription).where(CalendarSubscription.id == row.id)
            )
            await deleter.commit()
            assert await asyncio.wait_for(locking, timeout=5) is None

    async def test_a_body_that_is_not_a_calendar_fails(self, session, access):
        calendar = await _subscribe(session, access, url="https://example.org/html.ics")
        calendar_id = calendar.id
        subscription_id = (await _subscription(session, calendar_id)).id
        with patch.object(refresh_module, "fetch_public", _served(b"<html>login</html>")):
            report = await run_refresh(session, subscription_id, _indexer())
        assert report.failure == SubscriptionFailure.NOT_A_CALENDAR

    async def test_a_paused_organization_is_not_counted_as_failing(self, session, access):
        calendar = await _subscribe(session, access, url="https://example.org/paused.ics")
        calendar_id = calendar.id
        subscription_id = (await _subscription(session, calendar_id)).id
        await update_calendar_policy(
            session,
            access.owner_id,
            access.org_id,
            team_calendar_creators=CalendarPolicyAudience.EVERYONE,
            org_wide_calendar_sharers=CalendarPolicyAudience.EVERYONE,
            allow_external_subscriptions=False,
        )
        try:
            fetch = _served(ROTA)
            with patch.object(refresh_module, "fetch_public", fetch):
                report = await run_refresh(session, subscription_id, _indexer())
            assert report.status == RefreshStatus.PAUSED
            fetch.assert_not_awaited()
            row = await _subscription(session, calendar_id)
            assert row.consecutive_failures == 0
        finally:
            await update_calendar_policy(
                session,
                access.owner_id,
                access.org_id,
                team_calendar_creators=CalendarPolicyAudience.EVERYONE,
                org_wide_calendar_sharers=CalendarPolicyAudience.EVERYONE,
                allow_external_subscriptions=True,
            )


class TestSearch:
    async def test_a_refresh_indexes_every_row_for_the_subscriber_alone(self, session, access):
        calendar = await _subscribe(session, access, url="https://example.org/search.ics")
        calendar_id = calendar.id
        subscription_id = (await _subscription(session, calendar_id)).id
        indexer = _indexer()

        with patch.object(refresh_module, "fetch_public", _served(ROTA)):
            await run_refresh(session, subscription_id, indexer)

        documents = _indexed(indexer)
        assert set(documents) == {
            _event_urn(event.id) for event in await _events(session, calendar_id)
        }
        assert {document["title"] for document in documents.values()} == {
            "On call: Ana",
            "Standup",
            "Standup (moved)",
        }
        for document in documents.values():
            assert document["owner_id"] == access.member_id
            assert document["access_mode"] == AccessMode.OWNER_ONLY.value
            assert document["container"].user_ids == (access.member_id,)
            assert document["container"].open_to_org is False
        assert (await _subscription(session, calendar_id)).search_stale is False

    async def test_a_provider_change_reindexes_it_and_drops_what_vanished(self, session, access):
        calendar = await _subscribe(session, access, url="https://example.org/churn.ics")
        calendar_id = calendar.id
        subscription_id = (await _subscription(session, calendar_id)).id
        with patch.object(refresh_module, "fetch_public", _served(ROTA)):
            await run_refresh(session, subscription_id, _indexer())
        before = {
            event.ical_uid or event.title: event.id for event in await _events(session, calendar_id)
        }
        standup_rows = {
            _event_urn(event_id)
            for key, event_id in before.items()
            if key in {"rota-2", "Standup (moved)"}
        }

        indexer = _indexer()
        renamed = _feed(_vevent(ANA_SHIFT, RENAMED, DAY + timedelta(hours=9)))
        with patch.object(refresh_module, "fetch_public", _served(renamed, etag='"v2"')):
            report = await run_refresh(session, subscription_id, indexer)

        assert (report.updated, report.deleted) == (1, 1)
        assert {doc["title"] for doc in _indexed(indexer).values()} == {RENAMED}
        assert set(_indexed(indexer)) == {_event_urn(before[ANA_SHIFT])}
        assert _removed(indexer) == standup_rows

    async def test_a_search_outage_is_repaired_by_the_next_refresh(self, session, access):
        calendar = await _subscribe(session, access, url="https://example.org/outage.ics")
        calendar_id = calendar.id
        subscription_id = (await _subscription(session, calendar_id)).id
        down = _indexer()
        down.batch_index.side_effect = RuntimeError("search unavailable")

        with patch.object(refresh_module, "fetch_public", _served(ROTA)):
            report = await run_refresh(session, subscription_id, down)
        assert report.status == RefreshStatus.SYNCED
        assert (await _subscription(session, calendar_id)).search_stale is True

        indexer = _indexer()
        with patch.object(refresh_module, "fetch_public", _served(None, status=304)):
            report = await run_refresh(session, subscription_id, indexer)
        assert report.status == RefreshStatus.UNCHANGED
        assert set(_indexed(indexer)) == {
            _event_urn(event.id) for event in await _events(session, calendar_id)
        }
        assert (await _subscription(session, calendar_id)).search_stale is False

        quiet = _indexer()
        with patch.object(refresh_module, "fetch_public", _served(None, status=304)):
            await run_refresh(session, subscription_id, quiet)
        quiet.batch_index.assert_not_awaited()


class TestBusyAndDispatch:
    async def test_feed_events_count_as_busy_only_when_asked(self, session, access):
        calendar = await _subscribe(session, access, url="https://example.org/busy.ics")
        await _sync(session, access, calendar.id, ROTA)
        window = (DAY, DAY + timedelta(days=1))

        busy = await get_busy_intervals(session, access.org_id, [access.member_id], *window)
        assert busy[access.member_id] == []

        await _ops(session).update(
            access.member_id,
            access.org_id,
            calendar.id,
            url=None,
            refresh_interval_minutes=None,
            counts_as_busy=True,
        )
        busy = await get_busy_intervals(session, access.org_id, [access.member_id], *window)
        assert [(b.start, b.end) for b in busy[access.member_id]] == [
            (DAY + timedelta(hours=9), DAY + timedelta(hours=11))
        ]

    async def test_the_dispatcher_leases_due_feeds(self, session, access):
        calendar = await _subscribe(session, access, url="https://example.org/due.ics")
        await session.execute(
            update(CalendarSubscription)
            .where(CalendarSubscription.calendar_id == calendar.id)
            .values(next_refresh_at=datetime.now(UTC) - timedelta(minutes=1))
        )
        await session.commit()

        queued = JobEnqueueResult(job=None, outcome=JobEnqueueOutcome.ENQUEUED)
        enqueue = AsyncMock(return_value=queued)
        with patch.object(subscription_jobs, "enqueue_job_reconnecting", enqueue):
            await subscription_jobs.dispatch_calendar_subscription_refreshes({})

        row = await _subscription(session, calendar.id)
        queued_ids = {call.args[1] for call in enqueue.await_args_list}
        assert str(row.id) in queued_ids
        assert row.next_refresh_at > datetime.now(UTC) + timedelta(minutes=9)

    async def test_a_paused_organization_steps_out_of_the_dispatch_batch(self, session, access):
        calendar = await _subscribe(session, access, url="https://example.org/stepaside.ics")
        await session.execute(
            update(CalendarSubscription)
            .where(CalendarSubscription.calendar_id == calendar.id)
            .values(next_refresh_at=datetime.now(UTC) - timedelta(minutes=1))
        )
        await session.commit()
        await update_calendar_policy(
            session,
            access.owner_id,
            access.org_id,
            team_calendar_creators=CalendarPolicyAudience.EVERYONE,
            org_wide_calendar_sharers=CalendarPolicyAudience.EVERYONE,
            allow_external_subscriptions=False,
        )
        try:
            enqueue = AsyncMock()
            with patch.object(subscription_jobs, "enqueue_job_reconnecting", enqueue):
                await subscription_jobs.dispatch_calendar_subscription_refreshes({})
            row = await _subscription(session, calendar.id)
            assert str(row.id) not in {call.args[1] for call in enqueue.await_args_list}
            # Out of the way of other organizations' due rows, back soon after re-enabling.
            assert datetime.now(UTC) + timedelta(minutes=4) < row.next_refresh_at
            assert row.next_refresh_at < datetime.now(UTC) + timedelta(minutes=6)
        finally:
            await update_calendar_policy(
                session,
                access.owner_id,
                access.org_id,
                team_calendar_creators=CalendarPolicyAudience.EVERYONE,
                org_wide_calendar_sharers=CalendarPolicyAudience.EVERYONE,
                allow_external_subscriptions=True,
            )
