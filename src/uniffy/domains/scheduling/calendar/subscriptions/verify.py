"""Read a new address on the egress fleet before saving it, so a bad one never becomes a calendar."""

import traceback
from uuid import UUID

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.crypto.org_cipher import OrgCipher
from uniffy.core.errors import UnavailableError
from uniffy.core.jobs import run_job_and_wait
from uniffy.core.models.calendar.subscription import SubscriptionFailure
from uniffy.domains.scheduling.calendar.jobs.contracts import CHECK_CALENDAR_FEED
from uniffy.domains.scheduling.calendar.jobs.subscriptions import CHECK_JOB_TIMEOUT_SECONDS

logger = logger.bind(component="scheduling.calendar.subscriptions.verify")

_FAILURES = {failure.value: failure for failure in SubscriptionFailure}
_UNAVAILABLE = "Calendar addresses cannot be checked right now. Try again in a moment."


class FeedCheckFailed(Exception):
    """The address could not be read as a calendar; nothing was saved."""

    def __init__(self, failure: SubscriptionFailure, status: int | None = None) -> None:
        self.failure = failure
        self.status = status
        super().__init__(failure.value)


async def verify_address(session: AsyncSession, organization_id: UUID, normalized_url: str) -> None:
    # Sealed for the trip through the queue; the worker opens it with the same org key.
    sealed = await OrgCipher(session).encrypt(organization_id, normalized_url)
    # The wait must not hold a transaction, or a slow host pins a connection and its locks.
    await session.rollback()
    try:
        report = await run_job_and_wait(
            CHECK_CALENDAR_FEED,
            str(organization_id),
            sealed,
            timeout=CHECK_JOB_TIMEOUT_SECONDS + 5,
        )
    except TimeoutError as exc:
        raise FeedCheckFailed(SubscriptionFailure.TIMEOUT) from exc
    except UnavailableError:
        raise UnavailableError(_UNAVAILABLE) from None
    except Exception as exc:
        # A plain traceback: the sinks' variable dumps would print the address.
        logger.warning(
            "Calendar feed check did not answer",
            traceback="".join(traceback.format_exception(exc)),
        )
        raise UnavailableError(_UNAVAILABLE) from exc

    if not isinstance(report, dict) or report.get("crashed"):
        raise UnavailableError(_UNAVAILABLE)
    code = report.get("failure")
    if code is None:
        return
    if code not in _FAILURES:
        raise UnavailableError(_UNAVAILABLE)
    status = report.get("status")
    raise FeedCheckFailed(_FAILURES[code], status if isinstance(status, int) else None)
