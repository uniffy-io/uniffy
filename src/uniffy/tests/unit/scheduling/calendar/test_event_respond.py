"""Responding to an invitation from the message it arrived in."""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import jwt
import pytest
from fastapi import HTTPException

from uniffy.core.auth.tokens import (
    create_access_token,
    create_event_response_token,
    decode_asset_read_token,
    decode_event_response_token,
)
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.shared import AttendeeStatus
from uniffy.domains.scheduling.calendar.mail.compose import _respond_links_for
from uniffy.domains.scheduling.calendar.mail.outbox import CalendarMailKind, EventMailRequest
from uniffy.domains.scheduling.calendar.routes import (
    RESPOND_PATH,
    RespondRequest,
    create_calendar_router,
    respond_from_mail,
)

USER = uuid4()
ORG = uuid4()
EVENT = uuid4()

# Every token here is signed with the secret read from the environment at call
# time, and CI carries none. Setting it per test also keeps one case free to
# override it.
_TEST_SECRET = "test-32-byte-secret-padding-for-rsvp-tokens-1"


@pytest.fixture(autouse=True)
def _set_jwt_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("JWT_SECRET_KEY", _TEST_SECRET)


class TestToken:
    def test_it_names_one_attendee_and_one_event(self) -> None:
        claims = decode_event_response_token(create_event_response_token(USER, ORG, EVENT))

        assert claims["sub"] == str(USER)
        assert claims["org_id"] == str(ORG)
        assert claims["eid"] == str(EVENT)

    def test_it_is_not_accepted_where_another_kind_is_expected(self) -> None:
        """Least privilege: an RSVP link must not open an asset route."""
        token = create_event_response_token(USER, ORG, EVENT)

        with pytest.raises(jwt.InvalidTokenError):
            decode_asset_read_token(token)

    def test_an_access_token_is_not_accepted_as_an_rsvp_link(self) -> None:
        with pytest.raises(jwt.InvalidTokenError):
            decode_event_response_token(create_access_token(USER, ORG))

    def test_an_expired_link_is_refused(self) -> None:
        token = create_event_response_token(
            USER, ORG, EVENT, expires_delta=timedelta(days=-400)
        )

        with pytest.raises(jwt.ExpiredSignatureError):
            decode_event_response_token(token)

    def test_it_outlives_an_ordinary_session(self) -> None:
        """An invitation can sit in an inbox for weeks before the meeting."""
        claims = decode_event_response_token(create_event_response_token(USER, ORG, EVENT))

        assert datetime.fromtimestamp(claims["exp"], UTC) - datetime.now(UTC) > timedelta(days=30)


class TestRoute:
    @staticmethod
    def _ops(**behaviour):
        operations = MagicMock()
        operations.update_attendee_status = AsyncMock(**behaviour)
        return operations

    async def _respond(self, response: str = "accepted", *, ops=None):
        operations = ops or self._ops(return_value=True)
        with (
            patch(
                "uniffy.domains.scheduling.calendar.routes.CalendarEventOperations",
                return_value=operations,
            ),
            patch("uniffy.domains.scheduling.calendar.routes.check_rate_limit", AsyncMock()),
            patch("uniffy.domains.scheduling.calendar.routes.open_session"),
        ):
            result = await respond_from_mail(
                MagicMock(),
                RespondRequest(
                    token=create_event_response_token(USER, ORG, EVENT), response=response
                ),
            )
        return result, operations

    @pytest.mark.parametrize(
        ("word", "expected"),
        [
            ("accepted", AttendeeStatus.ACCEPTED),
            ("tentative", AttendeeStatus.TENTATIVE),
            ("declined", AttendeeStatus.DECLINED),
            ("ACCEPTED", AttendeeStatus.ACCEPTED),
        ],
    )
    async def test_a_response_reaches_the_event(
        self, word: str, expected: AttendeeStatus
    ) -> None:
        result, operations = await self._respond(word)

        assert result.status == expected.value
        assert operations.update_attendee_status.await_args.kwargs["status"] is expected
        assert operations.update_attendee_status.await_args.kwargs["user_id"] == USER

    async def test_an_unknown_word_is_refused(self) -> None:
        with pytest.raises(HTTPException) as raised:
            await self._respond("maybe-ish")

        assert raised.value.status_code == 400

    async def test_a_forged_link_is_refused(self) -> None:
        with pytest.raises(HTTPException) as raised:
            await respond_from_mail(
                MagicMock(), RespondRequest(token="not-a-token", response="accepted")
            )

        assert raised.value.status_code == 401

    async def test_somebody_no_longer_invited_cannot_respond(self) -> None:
        """The token names the attendee; the access path decides whether they
        may still answer, so a kept link stops working on removal."""
        ops = self._ops(side_effect=PermissionDeniedError("no access"))

        with pytest.raises(HTTPException) as raised:
            await self._respond(ops=ops)

        assert raised.value.status_code == 403

    async def test_a_deleted_event_reports_itself_gone(self) -> None:
        ops = self._ops(side_effect=NotFoundError("CalendarEvent", EVENT))

        with pytest.raises(HTTPException) as raised:
            await self._respond(ops=ops)

        assert raised.value.status_code == 404

    async def test_a_cancelled_meeting_cannot_be_accepted(self) -> None:
        ops = self._ops(side_effect=ValidationError("event", "Cannot respond to a cancelled event"))

        with pytest.raises(HTTPException) as raised:
            await self._respond(ops=ops)

        assert raised.value.status_code == 409

    async def test_responses_are_rate_limited_per_attendee_and_event(self) -> None:
        limiter = AsyncMock()
        with (
            patch(
                "uniffy.domains.scheduling.calendar.routes.CalendarEventOperations",
                return_value=self._ops(return_value=True),
            ),
            patch("uniffy.domains.scheduling.calendar.routes.check_rate_limit", limiter),
            patch("uniffy.domains.scheduling.calendar.routes.open_session"),
        ):
            await respond_from_mail(
                MagicMock(),
                RespondRequest(
                    token=create_event_response_token(USER, ORG, EVENT), response="accepted"
                ),
            )

        key = limiter.await_args.kwargs["key"]
        assert str(USER) in key
        assert str(EVENT) in key


class TestMethod:
    def test_responding_is_a_post_and_never_a_get(self) -> None:
        """A mail scanner opening every link in a message must not be able to
        accept a meeting on somebody's behalf."""
        router = create_calendar_router(MagicMock())

        route = next(r for r in router.routes if r.path.endswith(RESPOND_PATH))
        assert route.methods == {"POST"}


class TestLinksInMail:
    @staticmethod
    def _request(kind: CalendarMailKind) -> EventMailRequest:
        return EventMailRequest(
            delivery_id=uuid4(),
            organization_id=ORG,
            recipient_id=USER,
            event_id=EVENT,
            kind=kind,
            occurrence_date=None,
            changes=(),
        )

    @pytest.mark.parametrize("kind", [CalendarMailKind.INVITATION, CalendarMailKind.CHANGE])
    def test_an_invitation_and_an_update_offer_all_three_answers(
        self, kind: CalendarMailKind
    ) -> None:
        links = _respond_links_for(self._request(kind))

        assert "response=accepted" in links.accept
        assert "response=tentative" in links.tentative
        assert "response=declined" in links.decline

    def test_a_cancellation_offers_nothing_to_answer(self) -> None:
        links = _respond_links_for(self._request(CalendarMailKind.CANCELLATION))

        assert links.accept == ""
        assert links.decline == ""

    def test_the_link_carries_a_token_the_route_accepts(self) -> None:
        links = _respond_links_for(self._request(CalendarMailKind.INVITATION))

        token = links.accept.split("token=")[1].split("&")[0]
        assert decode_event_response_token(token)["sub"] == str(USER)
