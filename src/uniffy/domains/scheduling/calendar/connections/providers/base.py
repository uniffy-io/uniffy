"""What the sync engine asks of a provider, and the typed ways a provider call can fail."""

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from uniffy.core.models.calendar.connection import ProviderAccessRole, SyncFailure
from uniffy.infrastructure.outbound import ApiClient, ApiResponse

# Tests swap in an in-memory provider; production leaves it None for the real network.
TRANSPORT_FACTORY: Callable[[], Any] | None = None

# Reasons a token endpoint gives when the grant is gone and only a new sign-in helps.
REAUTH_ERRORS = frozenset({"invalid_grant", "interaction_required", "consent_required"})


def api_client(provider: str, base_url: str) -> ApiClient:
    return ApiClient(provider, base_url, transport_factory=TRANSPORT_FACTORY)


class ProviderError(Exception):
    """A provider call failed; ``retry_after`` is set when the provider asked us to wait."""

    def __init__(
        self,
        failure: SyncFailure,
        *,
        status: int | None = None,
        retry_after: float | None = None,
        reason: str | None = None,
    ) -> None:
        self.failure = failure
        self.status = status
        self.retry_after = retry_after
        self.reason = reason
        super().__init__(f"{failure.value} {status or ''} {reason or ''}".strip())


class ReauthRequired(ProviderError):
    def __init__(self, reason: str | None = None) -> None:
        super().__init__(SyncFailure.REAUTH_REQUIRED, reason=reason)


class PushUnsupported(Exception):
    """The provider offers no change notifications for this calendar; polling covers it."""


@dataclass(frozen=True)
class PushChannel:
    channel_id: str
    resource_id: str
    expires_at: datetime


class PreconditionFailed(Exception):
    """The provider copy changed since we last read it."""


class CursorExpired(Exception):
    """The provider forgot the sync cursor; the next round must be a full snapshot."""


@dataclass(frozen=True)
class TokenGrant:
    access_token: str = field(repr=False)
    expires_in: int
    refresh_token: str | None = field(default=None, repr=False)
    scope: str = ""
    id_token: str | None = field(default=None, repr=False)


@dataclass(frozen=True)
class ProviderIdentity:
    account_id: str
    email: str
    email_verified: bool


@dataclass(frozen=True)
class ProviderCalendarInfo:
    provider_calendar_id: str
    name: str
    color: str | None
    access_role: ProviderAccessRole
    is_primary: bool
    is_system: bool


@dataclass(frozen=True)
class SyncTarget:
    """What one sync round needs to know about the calendar it reads."""

    provider_calendar_id: str
    is_primary: bool
    cursor: str | None
    window_start: datetime
    window_end: datetime


def classify(
    response: ApiResponse, *, not_found: SyncFailure = SyncFailure.NOT_FOUND
) -> ProviderError:
    """The typed failure for a non-2xx answer; never carries the body, which may echo secrets."""
    status = response.status
    retry_after = response.retry_after()
    if status == 401:  # noqa: PLR2004 - HTTP status
        return ReauthRequired("unauthorized")
    if status == 429 or (status == 403 and _rate_limited(response)):  # noqa: PLR2004 - HTTP status
        return ProviderError(
            SyncFailure.RATE_LIMITED, status=status, retry_after=retry_after or 60.0
        )
    if status == 403:  # noqa: PLR2004 - HTTP status
        return ProviderError(SyncFailure.PERMISSION_DENIED, status=status)
    if status in (404, 410):  # noqa: PLR2004 - HTTP status
        return ProviderError(not_found, status=status)
    if status >= 500:  # noqa: PLR2004 - HTTP status class
        return ProviderError(SyncFailure.PROVIDER_ERROR, status=status, retry_after=retry_after)
    return ProviderError(SyncFailure.PROVIDER_ERROR, status=status)


def _rate_limited(response: ApiResponse) -> bool:
    body = response.json()
    if not isinstance(body, dict):
        return False
    error = body.get("error")
    if not isinstance(error, dict):
        return False
    reasons = {
        str(item.get("reason")) for item in error.get("errors") or [] if isinstance(item, dict)
    }
    return bool(reasons & {"rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded"})


def oauth_error(response: ApiResponse) -> ProviderError:
    """Token endpoint refusals: a dead grant needs a new sign-in, anything else is retried."""
    body = response.json()
    code = body.get("error") if isinstance(body, dict) else None
    if isinstance(code, str) and code in REAUTH_ERRORS:
        return ReauthRequired(code)
    if response.status >= 500 or response.status == 429:  # noqa: PLR2004 - HTTP status
        return ProviderError(
            SyncFailure.UNREACHABLE, status=response.status, retry_after=response.retry_after()
        )
    return ProviderError(
        SyncFailure.PROVIDER_ERROR,
        status=response.status,
        reason=code if isinstance(code, str) else None,
    )
