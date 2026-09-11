"""The RPCs a subscriber uses to get, replace, and stop their feed URL."""

from contextlib import asynccontextmanager
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from uniffy.core.models.calendar.feed_token import CalendarFeedToken
from uniffy.domains.scheduling.calendar.rpc.interop import InteropHandlers

USER = uuid4()
ORG = uuid4()
CALENDAR = uuid4()

MINTED_AT = datetime(2026, 9, 11, 8, 30, tzinfo=UTC)
FETCHED_AT = datetime(2026, 9, 11, 9, 30, tzinfo=UTC)


def _row(*, last_used_at: datetime | None = None) -> CalendarFeedToken:
    return CalendarFeedToken(
        organization_id=ORG,
        calendar_id=CALENDAR,
        user_id=USER,
        token_hash="unused-here",
        token_encrypted="unused-here",
        created_at=MINTED_AT,
        last_used_at=last_used_at,
    )


@asynccontextmanager
async def _session():
    yield MagicMock()


def _patches(**doubles):
    module = "uniffy.domains.scheduling.calendar.rpc.interop"
    layers = [
        patch(f"{module}.open_session", lambda: _session()),
        patch(f"{module}.current_user_id", return_value=USER),
        patch(f"{module}.resolve_organization_id", return_value=ORG),
    ]
    layers.extend(patch(f"{module}.{name}", double) for name, double in doubles.items())
    return layers


async def _call(method: str, request, **doubles):
    layers = _patches(**doubles)
    for layer in layers:
        layer.start()
    try:
        return await getattr(InteropHandlers(), method)(request, MagicMock())
    finally:
        for layer in reversed(layers):
            layer.stop()


def _request(calendar_id: str = str(CALENDAR)):
    request = MagicMock()
    request.organization_id = str(ORG)
    request.calendar_id = calendar_id
    return request


class TestGet:
    async def test_it_returns_the_url_already_in_use(self):
        response = await _call(
            "get_calendar_feed_url",
            _request(),
            read_feed=AsyncMock(return_value=("live-token", _row(last_used_at=FETCHED_AT))),
            feed_url=lambda token: f"https://example.test/api/calendar/feed/{token}.ics",
        )

        assert response.url == "https://example.test/api/calendar/feed/live-token.ics"
        assert response.created_at.ToDatetime(tzinfo=UTC) == MINTED_AT
        assert response.last_used_at.ToDatetime(tzinfo=UTC) == FETCHED_AT

    async def test_no_feed_reports_an_empty_url(self):
        response = await _call(
            "get_calendar_feed_url", _request(), read_feed=AsyncMock(return_value=None)
        )

        assert response.url == ""
        assert not response.HasField("created_at")

    async def test_a_feed_never_fetched_reports_no_last_use(self):
        response = await _call(
            "get_calendar_feed_url",
            _request(),
            read_feed=AsyncMock(return_value=("live-token", _row())),
            feed_url=lambda token: f"https://example.test/{token}",
        )

        assert not response.HasField("last_used_at")
        assert response.HasField("created_at")


class TestRegenerate:
    async def test_it_returns_the_new_url(self):
        response = await _call(
            "regenerate_calendar_feed",
            _request(),
            issue_feed=AsyncMock(return_value=("fresh-token", _row())),
            feed_url=lambda token: f"https://example.test/api/calendar/feed/{token}.ics",
        )

        assert response.url.endswith("fresh-token.ics")
        assert response.created_at.ToDatetime(tzinfo=UTC) == MINTED_AT

    async def test_it_mints_for_the_caller_on_the_named_calendar(self):
        issuer = AsyncMock(return_value=("fresh-token", _row()))
        await _call(
            "regenerate_calendar_feed",
            _request(),
            issue_feed=issuer,
            feed_url=lambda token: token,
        )

        # The identity comes from the session, never from the request body.
        assert issuer.await_args.kwargs["user_id"] == USER
        assert issuer.await_args.kwargs["organization_id"] == ORG
        assert issuer.await_args.kwargs["calendar_id"] == CALENDAR


class TestRevoke:
    async def test_it_reports_a_feed_was_stopped(self):
        response = await _call(
            "revoke_calendar_feed", _request(), revoke_feed=AsyncMock(return_value=True)
        )

        assert response.revoked is True

    async def test_it_reports_when_there_was_nothing_to_stop(self):
        response = await _call(
            "revoke_calendar_feed", _request(), revoke_feed=AsyncMock(return_value=False)
        )

        assert response.revoked is False


class TestDefaultCalendar:
    async def test_an_omitted_id_means_the_callers_own_calendar(self):
        """There is no calendar picker in the product yet, so a client has no
        id to send; event creation already reads an empty id the same way."""
        issuer = AsyncMock(return_value=("fresh-token", _row()))
        queries = MagicMock()
        queries.ensure_default_calendar = AsyncMock(return_value=MagicMock(id=CALENDAR))

        await _call(
            "regenerate_calendar_feed",
            _request(calendar_id=""),
            issue_feed=issuer,
            feed_url=lambda token: token,
            queries=queries,
        )

        queries.ensure_default_calendar.assert_awaited_once()
        assert issuer.await_args.kwargs["calendar_id"] == CALENDAR

    async def test_an_explicit_id_is_taken_as_given(self):
        issuer = AsyncMock(return_value=("fresh-token", _row()))
        queries = MagicMock()
        queries.ensure_default_calendar = AsyncMock()

        await _call(
            "regenerate_calendar_feed",
            _request(),
            issue_feed=issuer,
            feed_url=lambda token: token,
            queries=queries,
        )

        queries.ensure_default_calendar.assert_not_awaited()
        assert issuer.await_args.kwargs["calendar_id"] == CALENDAR
