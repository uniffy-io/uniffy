"""Subscribe feeds: minting, reading back, revoking, and what a token grants."""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest

from uniffy.core.errors import NotFoundError
from uniffy.core.models.calendar.feed_token import CalendarFeedToken
from uniffy.core.types import generate_id
from uniffy.domains.scheduling.calendar.ical import feed as feed_module
from uniffy.domains.scheduling.calendar.ical.feed import (
    FEED_REFRESH_INTERVAL,
    feed_url,
    hash_token,
    issue_feed,
    read_feed,
    record_fetch,
    render_feed,
    resolve_feed,
    revoke_feed,
)

OWNER = generate_id()
STRANGER = generate_id()
ORG = generate_id()
CALENDAR = generate_id()


class _Session:
    """Enough of a session to exercise the feed writes without a database."""

    def __init__(self, *, owner=OWNER, existing: CalendarFeedToken | None = None) -> None:
        self.added: list = []
        self.deleted_rows = 1
        self._owner = owner
        self._existing = existing
        self.scalars_seen: list = []

    def add(self, row) -> None:
        self.added.append(row)

    async def flush(self) -> None:
        return None

    async def scalar(self, statement):
        self.scalars_seen.append(statement)
        # The ownership gate reads first; everything after wants the stored row.
        if len(self.scalars_seen) == 1:
            return self._owner
        return self._existing

    async def execute(self, _statement):
        class _Result:
            rowcount = self.deleted_rows

        return _Result()


class _Cipher:
    """Stands in for OrgCipher: reversible, and records what it was asked."""

    def __init__(self, _session) -> None:
        self.calls: list = []

    async def encrypt(self, _organization_id, plaintext: str) -> str:
        return f"sealed:{plaintext}"

    async def decrypt(self, _organization_id, ciphertext: str) -> str:
        return ciphertext.removeprefix("sealed:")


@pytest.fixture(autouse=True)
def _cipher():
    with patch.object(feed_module, "OrgCipher", _Cipher):
        yield


class TestMinting:
    async def test_mints_a_row_the_owner_can_use(self):
        session = _Session()
        raw_token, row = await issue_feed(
            session, user_id=OWNER, organization_id=ORG, calendar_id=CALENDAR
        )

        assert row.token_hash == hash_token(raw_token)
        assert row.user_id == OWNER
        assert row.calendar_id == CALENDAR
        assert session.added == [row]

    async def test_raw_token_is_never_stored(self):
        session = _Session()
        raw_token, row = await issue_feed(
            session, user_id=OWNER, organization_id=ORG, calendar_id=CALENDAR
        )

        assert raw_token not in row.token_hash
        # Only the envelope holds it, and that is what OrgCipher produced.
        assert row.token_encrypted == f"sealed:{raw_token}"

    async def test_a_stranger_is_refused(self):
        session = _Session(owner=STRANGER)
        with pytest.raises(NotFoundError):
            await issue_feed(session, user_id=OWNER, organization_id=ORG, calendar_id=CALENDAR)
        assert session.added == []

    async def test_regenerating_replaces_the_secret_in_place(self):
        existing = CalendarFeedToken(
            organization_id=ORG,
            calendar_id=CALENDAR,
            user_id=OWNER,
            token_hash=hash_token("old-token"),
            token_encrypted="sealed:old-token",
            last_used_at=datetime(2026, 1, 1, tzinfo=UTC),
        )
        session = _Session(existing=existing)

        raw_token, row = await issue_feed(
            session, user_id=OWNER, organization_id=ORG, calendar_id=CALENDAR
        )

        assert row is existing
        assert raw_token != "old-token"
        # The previous URL stops resolving the moment this row is written.
        assert row.token_hash == hash_token(raw_token)
        assert row.token_hash != hash_token("old-token")
        assert row.last_used_at is None


class TestReadingBack:
    async def test_owner_recovers_the_url_without_reminting(self):
        existing = CalendarFeedToken(
            organization_id=ORG,
            calendar_id=CALENDAR,
            user_id=OWNER,
            token_hash=hash_token("live-token"),
            token_encrypted="sealed:live-token",
        )
        session = _Session(existing=existing)

        result = await read_feed(
            session, user_id=OWNER, organization_id=ORG, calendar_id=CALENDAR
        )

        assert result is not None
        raw_token, row = result
        # A second device gets the same URL, so the first stays subscribed.
        assert raw_token == "live-token"
        assert row is existing

    async def test_no_feed_reads_as_nothing(self):
        session = _Session(existing=None)
        assert (
            await read_feed(session, user_id=OWNER, organization_id=ORG, calendar_id=CALENDAR)
            is None
        )

    async def test_a_stranger_cannot_read_someones_url(self):
        session = _Session(owner=STRANGER)
        with pytest.raises(NotFoundError):
            await read_feed(session, user_id=OWNER, organization_id=ORG, calendar_id=CALENDAR)


class TestRevoking:
    async def test_revoking_reports_it_removed_one(self):
        session = _Session()
        assert (
            await revoke_feed(session, user_id=OWNER, organization_id=ORG, calendar_id=CALENDAR)
            is True
        )

    async def test_revoking_nothing_reports_false(self):
        session = _Session()
        session.deleted_rows = 0
        assert (
            await revoke_feed(session, user_id=OWNER, organization_id=ORG, calendar_id=CALENDAR)
            is False
        )

    async def test_a_stranger_cannot_revoke(self):
        session = _Session(owner=STRANGER)
        with pytest.raises(NotFoundError):
            await revoke_feed(session, user_id=OWNER, organization_id=ORG, calendar_id=CALENDAR)


class TestResolving:
    def _row(self) -> CalendarFeedToken:
        return CalendarFeedToken(
            organization_id=ORG,
            calendar_id=CALENDAR,
            user_id=OWNER,
            token_hash=hash_token("live-token"),
            token_encrypted="sealed:live-token",
        )

    async def test_a_live_token_resolves_to_its_subscription(self):
        row = self._row()
        session = AsyncMock()
        session.scalar = AsyncMock(side_effect=[row, OWNER, CALENDAR])

        assert await resolve_feed(session, "live-token") is row

    async def test_an_unknown_token_resolves_to_nothing(self):
        session = AsyncMock()
        session.scalar = AsyncMock(return_value=None)

        assert await resolve_feed(session, "never-minted") is None

    async def test_a_deactivated_subscriber_stops_resolving(self):
        row = self._row()
        session = AsyncMock()
        # Row found, but the membership recheck comes back empty.
        session.scalar = AsyncMock(side_effect=[row, None])

        assert await resolve_feed(session, "live-token") is None

    async def test_a_deleted_calendar_stops_resolving(self):
        row = self._row()
        session = AsyncMock()
        session.scalar = AsyncMock(side_effect=[row, OWNER, None])

        assert await resolve_feed(session, "live-token") is None


class TestRendering:
    async def test_reads_as_the_subscriber_and_names_the_calendar(self):
        row = CalendarFeedToken(
            organization_id=ORG,
            calendar_id=CALENDAR,
            user_id=OWNER,
            token_hash=hash_token("live-token"),
            token_encrypted="sealed:live-token",
        )
        session = AsyncMock()
        session.scalar = AsyncMock(return_value="Team calendar")
        reader = AsyncMock()
        reader.list_events = AsyncMock(return_value=([], 0))

        with (
            patch.object(feed_module, "CalendarEventReader", return_value=reader),
            patch.object(feed_module, "build_exports", AsyncMock(return_value=[])),
        ):
            document = await render_feed(session, row)

        # The permission-filtered query runs as the subscriber, never as an
        # unscoped reader: the token carries identity, not access.
        assert reader.list_events.await_args.args[0] == OWNER
        assert reader.list_events.await_args.args[1] == ORG
        assert reader.list_events.await_args.kwargs["calendar_id"] == CALENDAR
        assert b"X-WR-CALNAME:Team calendar" in document
        # Both spellings, so Apple and Outlook each find the poll rate.
        assert b"REFRESH-INTERVAL;VALUE=DURATION:PT1H" in document
        assert b"X-PUBLISHED-TTL:PT1H" in document
        assert FEED_REFRESH_INTERVAL == timedelta(hours=1)

    async def test_the_window_is_bounded(self):
        row = CalendarFeedToken(
            organization_id=ORG,
            calendar_id=CALENDAR,
            user_id=OWNER,
            token_hash=hash_token("live-token"),
            token_encrypted="sealed:live-token",
        )
        session = AsyncMock()
        session.scalar = AsyncMock(return_value="Team calendar")
        reader = AsyncMock()
        reader.list_events = AsyncMock(return_value=([], 0))

        with (
            patch.object(feed_module, "CalendarEventReader", return_value=reader),
            patch.object(feed_module, "build_exports", AsyncMock(return_value=[])),
        ):
            await render_feed(session, row)

        kwargs = reader.list_events.await_args.kwargs
        span = kwargs["end_date"] - kwargs["start_date"]
        assert span.days == feed_module.FEED_PAST_DAYS + feed_module.FEED_FUTURE_DAYS
        assert kwargs["page_size"] == feed_module.MAX_FEED_EVENTS


class TestRecordingAFetch:
    async def test_it_commits_so_the_note_survives_the_request(self):
        """The feed route's session does not commit on exit; leaving the write
        on the loaded row would drop it silently."""
        row = CalendarFeedToken(
            organization_id=ORG,
            calendar_id=CALENDAR,
            user_id=OWNER,
            token_hash=hash_token("live-token"),
            token_encrypted="sealed:live-token",
        )
        session = AsyncMock()

        await record_fetch(session, row)

        session.execute.assert_awaited_once()
        session.commit.assert_awaited_once()
        assert row.last_used_at is not None


class TestUrl:
    def test_url_carries_the_token_and_an_ics_suffix(self, monkeypatch):
        monkeypatch.setenv("UNIFFY_BASE_URL", "https://cal.example.com/")
        assert feed_url("abc123") == "https://cal.example.com/api/calendar/feed/abc123.ics"
