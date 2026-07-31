"""Shared pyqwest core for integration API clients.

One instance per cached connection: it owns the breaker state and the warm
connection pool. Provider clients are thin wrappers that know endpoints.
"""

import asyncio
import time
from typing import Any
from urllib.parse import quote

from loguru import logger
from pyqwest import Client, FullResponse, ReadError, WriteError

from uniffy.core.errors import NotFoundError, RateLimitExceededError, ValidationError
from uniffy.domains.integrations.base import (
    IntegrationApiError,
    IntegrationAuthError,
    IntegrationUnavailableError,
)
from uniffy.observability.metrics import (
    INTEGRATION_HTTP_DURATION,
    INTEGRATION_HTTP_REQUESTS_TOTAL,
)

logger = logger.bind(component="integrations.http")

REQUEST_TIMEOUT_SECONDS = 20.0
BREAKER_FAILURE_THRESHOLD = 5
BREAKER_WINDOW_SECONDS = 30.0
BREAKER_OPEN_SECONDS = 60.0
_MAX_RESPONSE_BYTES = 2_000_000
_ERROR_TEXT_CAP = 200

_TRANSPORT_ERRORS = (ConnectionError, TimeoutError, ReadError, WriteError)


def encode_segment(value: str | int) -> str:
    """URL-encode one path segment; EVERY agent-supplied path piece goes through this."""
    if isinstance(value, int):
        return str(value)
    if not isinstance(value, str) or not value:
        raise ValidationError("path", "Path segment cannot be empty")
    if value.startswith("/"):
        raise ValidationError("path", "Path segment cannot start with '/'")
    if ".." in value:
        raise ValidationError("path", "Path segment cannot contain '..'")
    if any(ord(ch) < 32 or ord(ch) == 127 for ch in value):
        raise ValidationError("path", "Path segment contains control characters")
    return quote(value, safe="")


def _normalize_params(params: dict[str, Any] | None) -> dict[str, str] | None:
    """pyqwest accepts only string query values; ints and bools arrive from tool args."""
    if not params:
        return None
    out: dict[str, str] = {}
    for key, value in params.items():
        if value is None:
            continue
        if isinstance(value, bool):
            out[key] = "true" if value else "false"
        else:
            out[key] = str(value)
    return out or None


def _first_header(response: FullResponse, name: str) -> str | None:
    try:
        values = response.headers.get(name)
    except Exception:
        return None
    if not values:
        return None
    return values[0]


class _CircuitBreaker:
    def __init__(self, provider_id: str) -> None:
        self._provider_id = provider_id
        self._failures: list[float] = []
        self._open_until: float = 0.0

    def check(self) -> None:
        if time.monotonic() < self._open_until:
            raise IntegrationUnavailableError(
                f"{self._provider_id} is temporarily unavailable (repeated failures); "
                f"try again in about a minute"
            )

    def record_success(self) -> None:
        self._failures.clear()

    def record_failure(self) -> None:
        now = time.monotonic()
        self._failures = [t for t in self._failures if now - t < BREAKER_WINDOW_SECONDS]
        self._failures.append(now)
        if len(self._failures) >= BREAKER_FAILURE_THRESHOLD:
            self._open_until = now + BREAKER_OPEN_SECONDS
            self._failures.clear()
            logger.warning(
                f"Integration circuit breaker opened for {BREAKER_OPEN_SECONDS}s "
                f"(provider={self._provider_id})"
            )


class IntegrationHttpClient:
    """Authenticated request core for one connection.

    The host comes only from admin-written config; agent input reaches the
    URL only via ``encode_segment`` and ``params``. Error text never carries
    the credential: only this class sets auth headers and never echoes them.
    """

    def __init__(self, provider_id: str, base_url: str, headers: dict[str, str]) -> None:
        self.provider_id = provider_id
        self.base_url = base_url.rstrip("/")
        self._headers = headers
        self._breaker = _CircuitBreaker(provider_id)
        self._http = Client()

    async def request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json_body: dict | list | None = None,
    ) -> Any:
        """One API call returning decoded JSON; 5xx/transport trips the breaker, 4xx does not."""
        self._breaker.check()
        url = f"{self.base_url}{path}"
        params = _normalize_params(params)
        start = time.perf_counter()

        try:
            if method == "GET":
                call = self._http.get(url, self._headers, params=params)
            elif method == "POST":
                call = self._http.post(url, self._headers, content=json_body, params=params)
            elif method == "PUT":
                call = self._http.put(url, self._headers, content=json_body, params=params)
            elif method == "PATCH":
                call = self._http.patch(url, self._headers, content=json_body, params=params)
            elif method == "DELETE":
                call = self._http.delete(url, self._headers, params=params)
            else:
                raise ValidationError("method", f"Unsupported HTTP method: {method}")
            response = await asyncio.wait_for(call, timeout=REQUEST_TIMEOUT_SECONDS)
        except TimeoutError as exc:
            self._breaker.record_failure()
            self._observe("timeout", start)
            raise IntegrationApiError(
                f"{self.provider_id} request timed out after {REQUEST_TIMEOUT_SECONDS:.0f}s"
            ) from exc
        except _TRANSPORT_ERRORS as exc:
            self._breaker.record_failure()
            self._observe("transport", start)
            raise IntegrationApiError(f"{self.provider_id} transport error: {exc}") from exc

        return self._handle_response(method, path, response, start)

    def _handle_response(
        self, method: str, path: str, response: FullResponse, start: float
    ) -> Any:
        status = response.status

        if status >= 500:
            self._breaker.record_failure()
            self._observe("5xx", start)
            raise IntegrationApiError(
                f"{self.provider_id} request failed: HTTP {status}", status_code=status
            )

        if status >= 400:
            self._breaker.record_success()
            self._observe("4xx", start)
            if status == 401:
                raise IntegrationAuthError(
                    f"{self.provider_id} rejected the credential (HTTP 401)"
                )
            if status in (403, 429):
                retry_after = self._rate_limit_retry_after(response, status)
                if retry_after is not None:
                    raise RateLimitExceededError(
                        resource=self.provider_id,
                        limit=int(_first_header(response, "x-ratelimit-limit") or 0),
                        window_seconds=0,
                        retry_after=retry_after,
                    )
            if status == 404:
                raise NotFoundError(f"{self.provider_id} resource", f"{method} {path}")
            raise IntegrationApiError(
                f"{self.provider_id} rejected the request: HTTP {status} "
                f"{response.text()[:_ERROR_TEXT_CAP]}",
                status_code=status,
            )

        self._breaker.record_success()

        if len(response.content) > _MAX_RESPONSE_BYTES:
            self._observe("blocked", start)
            raise IntegrationApiError(
                f"{self.provider_id} response exceeded "
                f"{_MAX_RESPONSE_BYTES // 1_000_000}MB and was discarded"
            )

        self._observe("2xx", start)
        if status == 204 or not response.content:
            return None
        try:
            return response.json()
        except Exception as exc:
            raise IntegrationApiError(
                f"{self.provider_id} returned an unparseable response"
            ) from exc

    def _rate_limit_retry_after(self, response: FullResponse, status: int) -> int | None:
        """Detect an exhausted rate limit on a 403/429 and compute the wait.

        GitHub signals via ``x-ratelimit-remaining: 0`` + epoch ``reset``;
        GitLab (and plain 429s) via ``Retry-After`` seconds.
        """
        retry_header = _first_header(response, "retry-after")
        if retry_header and retry_header.isdigit():
            return int(retry_header)

        remaining = _first_header(response, "x-ratelimit-remaining")
        if remaining == "0":
            reset = _first_header(response, "x-ratelimit-reset")
            if reset and reset.isdigit():
                return max(0, int(int(reset) - time.time()))
            return 60

        if status == 429:
            return 60
        return None

    def _observe(self, status_class: str, start: float) -> None:
        INTEGRATION_HTTP_REQUESTS_TOTAL.labels(
            provider=self.provider_id, status_class=status_class
        ).inc()
        INTEGRATION_HTTP_DURATION.labels(provider=self.provider_id).observe(
            time.perf_counter() - start
        )
