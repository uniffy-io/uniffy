from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from uniffy.core.errors import UnavailableError
from uniffy.core.models.calendar.subscription import SubscriptionFailure
from uniffy.domains.scheduling.calendar.subscriptions import refresh, verify
from uniffy.domains.scheduling.calendar.subscriptions.refresh import check_feed
from uniffy.domains.scheduling.calendar.subscriptions.verify import FeedCheckFailed, verify_address
from uniffy.infrastructure.outbound import FetchResult

URL = "https://calendar.example.org/secret-path/basic.ics"
SEALED_URL = "sealed"


def _session() -> AsyncMock:
    return AsyncMock()


async def _verify(answer) -> None:
    cipher = MagicMock()
    cipher.return_value.encrypt = AsyncMock(return_value=SEALED_URL)
    with (
        patch.object(verify, "OrgCipher", cipher),
        patch.object(verify, "run_job_and_wait", answer),
    ):
        await verify_address(_session(), uuid4(), URL)


async def test_a_readable_address_passes() -> None:
    await _verify(AsyncMock(return_value={"failure": None, "status": None, "event_count": 3}))


async def test_the_worker_gets_the_sealed_address_never_the_plain_one() -> None:
    answer = AsyncMock(return_value={"failure": None, "status": None, "event_count": 0})
    await _verify(answer)

    assert URL not in answer.await_args.args
    assert SEALED_URL in answer.await_args.args


@pytest.mark.parametrize(
    ("report", "failure", "status"),
    [
        ({"failure": "BLOCKED_ADDRESS", "status": None}, SubscriptionFailure.BLOCKED_ADDRESS, None),
        ({"failure": "HTTP_STATUS", "status": 404}, SubscriptionFailure.HTTP_STATUS, 404),
        ({"failure": "NOT_A_CALENDAR", "status": None}, SubscriptionFailure.NOT_A_CALENDAR, None),
    ],
)
async def test_a_refusal_names_why(report, failure, status) -> None:
    with pytest.raises(FeedCheckFailed) as refused:
        await _verify(AsyncMock(return_value=report))

    assert (refused.value.failure, refused.value.status) == (failure, status)


async def test_a_worker_that_does_not_answer_in_time_reads_as_a_timeout() -> None:
    with pytest.raises(FeedCheckFailed) as refused:
        await _verify(AsyncMock(side_effect=TimeoutError))

    assert refused.value.failure == SubscriptionFailure.TIMEOUT


@pytest.mark.parametrize(
    "answer",
    [
        AsyncMock(side_effect=UnavailableError("queue down")),
        AsyncMock(return_value={"failure": None, "crashed": True}),
        AsyncMock(side_effect=RuntimeError("result lost")),
        AsyncMock(return_value={"failure": "FROM_A_NEWER_BUILD"}),
    ],
)
async def test_a_check_that_could_not_run_is_unavailable_not_a_verdict(answer) -> None:
    with pytest.raises(UnavailableError):
        await _verify(answer)


async def test_the_check_refuses_a_private_address_before_connecting() -> None:
    check = await check_feed("http://127.0.0.1:8000/x.ics")

    assert check.failure == SubscriptionFailure.BLOCKED_ADDRESS


async def test_the_check_reads_the_feed_without_storing_it() -> None:
    body = (
        b"BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\nBEGIN:VEVENT\r\n"
        b"UID:a@example.org\r\nSUMMARY:Holiday\r\nDTSTART;VALUE=DATE:20261224\r\n"
        b"END:VEVENT\r\nEND:VCALENDAR\r\n"
    )
    fetched = FetchResult(status=200, body=body, etag=None, last_modified=None)
    with patch.object(refresh, "fetch_public", AsyncMock(return_value=fetched)):
        check = await check_feed(URL)

    assert (check.failure, check.event_count) == (None, 1)


async def test_the_check_refuses_a_page_that_is_not_a_calendar() -> None:
    fetched = FetchResult(status=200, body=b"<html></html>", etag=None, last_modified=None)
    with patch.object(refresh, "fetch_public", AsyncMock(return_value=fetched)):
        check = await check_feed(URL)

    assert check.failure == SubscriptionFailure.NOT_A_CALENDAR
