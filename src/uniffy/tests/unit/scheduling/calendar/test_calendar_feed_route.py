"""Serving a subscribe feed: what a polled URL returns, and what it refuses."""

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException, status

from uniffy.core.models.calendar.feed_token import CalendarFeedToken
from uniffy.domains.scheduling.calendar.routes import (
    FEED_CACHE_CONTROL,
    FEED_PATH,
    RESPOND_PATH,
    create_calendar_router,
    serve_feed,
)

USER = uuid4()
ORG = uuid4()
CALENDAR = uuid4()

DOCUMENT = b"BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n"
OTHER_DOCUMENT = b"BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-CALNAME:Other\r\nEND:VCALENDAR\r\n"


def _row() -> CalendarFeedToken:
    return CalendarFeedToken(
        organization_id=ORG,
        calendar_id=CALENDAR,
        user_id=USER,
        token_hash="unused-here",
        token_encrypted="unused-here",
    )


@asynccontextmanager
async def _session(recorder):
    yield recorder


_UNSET = object()


async def _fetch(
    token: str = "live-token",
    *,
    row: CalendarFeedToken | None | object = _UNSET,
    document: bytes = DOCUMENT,
    if_none_match: str | None = None,
    limiter: AsyncMock | None = None,
    client_ip: str | None = "203.0.113.7",
):
    resolved = _row() if row is _UNSET else row
    recorder = MagicMock()
    with (
        patch(
            "uniffy.domains.scheduling.calendar.routes.open_session",
            lambda: _session(recorder),
        ),
        patch(
            "uniffy.domains.scheduling.calendar.routes.resolve_feed",
            AsyncMock(return_value=resolved),
        ) as resolver,
        patch(
            "uniffy.domains.scheduling.calendar.routes.render_feed",
            AsyncMock(return_value=document),
        ),
        patch(
            "uniffy.domains.scheduling.calendar.routes.record_fetch", AsyncMock()
        ) as recorder,
        patch(
            "uniffy.domains.scheduling.calendar.routes.check_rate_limit",
            limiter or AsyncMock(),
        ),
        patch(
            "uniffy.domains.scheduling.calendar.routes.client_ip_for_rate_limit",
            return_value=client_ip,
        ),
    ):
        response = await serve_feed(token, if_none_match=if_none_match)
    return response, resolver, resolved, recorder


class TestServing:
    async def test_a_live_feed_returns_the_document(self):
        response, _, _, _ = await _fetch()

        assert response.status_code == status.HTTP_200_OK
        assert response.body == DOCUMENT
        assert response.media_type.startswith("text/calendar")

    async def test_the_ics_suffix_is_not_part_of_the_token(self):
        _, resolver, _, _ = await _fetch("live-token.ics")

        assert resolver.await_args.args[1] == "live-token"

    async def test_a_fetch_is_committed_so_a_stale_subscription_shows(self):
        """The route's session is not auto-committing, so the write has to be
        made durable deliberately rather than left on the loaded row."""
        _, _, row, recorder = await _fetch()

        recorder.assert_awaited_once()
        assert recorder.await_args.args[1] is row

    async def test_nothing_is_cached_by_a_shared_proxy(self):
        response, _, _, _ = await _fetch()

        assert response.headers["cache-control"] == FEED_CACHE_CONTROL
        assert "private" in FEED_CACHE_CONTROL

    async def test_no_cookie_is_ever_set(self):
        """The feed is a capability URL; it must not mint a session."""
        response, _, _, _ = await _fetch()

        assert "set-cookie" not in response.headers


class TestConditionalFetch:
    async def test_an_unchanged_feed_answers_304_without_a_body(self):
        first, _, _, _ = await _fetch()
        etag = first.headers["etag"]

        second, _, _, _ = await _fetch(if_none_match=etag)

        assert second.status_code == status.HTTP_304_NOT_MODIFIED
        assert second.body == b""
        assert second.headers["etag"] == etag

    async def test_a_changed_feed_answers_200_with_a_new_validator(self):
        first, _, _, _ = await _fetch()
        etag = first.headers["etag"]

        second, _, _, _ = await _fetch(document=OTHER_DOCUMENT, if_none_match=etag)

        assert second.status_code == status.HTTP_200_OK
        assert second.headers["etag"] != etag

    async def test_a_quoted_validator_survives_surrounding_whitespace(self):
        first, _, _, _ = await _fetch()

        second, _, _, _ = await _fetch(if_none_match=f"  {first.headers['etag']} ")

        assert second.status_code == status.HTTP_304_NOT_MODIFIED


class TestRefusal:
    async def test_an_unknown_token_is_indistinguishable_from_a_revoked_one(self):
        with pytest.raises(HTTPException) as caught:
            await _fetch(row=None)

        # 404 rather than 401: probing the endpoint reveals no live feed ids.
        assert caught.value.status_code == status.HTTP_404_NOT_FOUND

    async def test_a_refused_fetch_never_renders_the_calendar(self):
        with (
            patch(
                "uniffy.domains.scheduling.calendar.routes.open_session",
                lambda: _session(MagicMock()),
            ),
            patch(
                "uniffy.domains.scheduling.calendar.routes.resolve_feed",
                AsyncMock(return_value=None),
            ),
            patch(
                "uniffy.domains.scheduling.calendar.routes.render_feed", AsyncMock()
            ) as renderer,
            patch(
                "uniffy.domains.scheduling.calendar.routes.check_rate_limit", AsyncMock()
            ),
            patch(
                "uniffy.domains.scheduling.calendar.routes.client_ip_for_rate_limit",
                return_value=None,
            ),
        ):
            with pytest.raises(HTTPException):
                await serve_feed("never-minted")

        renderer.assert_not_awaited()


class TestRateLimit:
    async def test_both_the_feed_and_the_caller_are_bounded(self):
        limiter = AsyncMock()
        await _fetch(limiter=limiter)

        keys = [call.kwargs["key"] for call in limiter.await_args_list]
        assert any(key.startswith("rl:calendar:feed:token:") for key in keys)
        assert any(key.endswith("203.0.113.7") for key in keys)

    async def test_the_raw_token_never_becomes_a_bucket_key(self):
        limiter = AsyncMock()
        await _fetch(limiter=limiter)

        keys = [call.kwargs["key"] for call in limiter.await_args_list]
        assert all("live-token" not in key for key in keys)

    async def test_an_unknowable_client_address_is_skipped_not_guessed(self):
        limiter = AsyncMock()
        await _fetch(limiter=limiter, client_ip=None)

        keys = [call.kwargs["key"] for call in limiter.await_args_list]
        assert len(keys) == 1
        assert keys[0].startswith("rl:calendar:feed:token:")

    async def test_the_limit_is_checked_before_anything_is_resolved(self):
        limiter = AsyncMock(side_effect=HTTPException(status_code=429))
        with (
            patch(
                "uniffy.domains.scheduling.calendar.routes.resolve_feed", AsyncMock()
            ) as resolver,
            patch("uniffy.domains.scheduling.calendar.routes.check_rate_limit", limiter),
            patch(
                "uniffy.domains.scheduling.calendar.routes.client_ip_for_rate_limit",
                return_value=None,
            ),
        ):
            with pytest.raises(HTTPException):
                await serve_feed("live-token")

        resolver.assert_not_awaited()


class TestMethod:
    def test_a_feed_is_read_only(self):
        router = create_calendar_router(MagicMock())

        route = next(r for r in router.routes if r.path.endswith(FEED_PATH))
        assert route.methods == {"GET"}

    def test_the_feed_and_the_rsvp_route_stay_separate(self):
        router = create_calendar_router(MagicMock())

        paths = {r.path for r in router.routes}
        assert any(path.endswith(FEED_PATH) for path in paths)
        assert any(path.endswith(RESPOND_PATH) for path in paths)
