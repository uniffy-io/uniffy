"""Calls to a fixed provider API host, where the address is code, not something a person typed."""

import asyncio
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from typing import Any
from urllib.parse import urlencode, urlsplit

from pyqwest import Client, HTTPTransport, ReadError, RemoteProtocolError, StreamError, WriteError

from uniffy.core.json_codec import JSONDecodeError, dumps_bytes, loads
from uniffy.core.outbound.metrics import OUTBOUND_API_DURATION, OUTBOUND_API_TOTAL

API_TIMEOUT_SECONDS = 20.0
API_MAX_BYTES = 8 * 1024 * 1024
_CONNECT_TIMEOUT_SECONDS = 10.0
_USER_AGENT = "Uniffy"
_TRANSPORT_ERRORS = (ConnectionError, ReadError, WriteError, RemoteProtocolError, StreamError)

TransportFactory = Callable[[], Any]


class ApiError(Exception):
    """The request got no usable HTTP answer: unreachable, timed out, or too large."""

    def __init__(self, reason: str, *, provider: str) -> None:
        self.reason = reason
        self.provider = provider
        super().__init__(f"{provider} request failed: {reason}")


@dataclass(frozen=True)
class ApiResponse:
    status: int
    headers: Mapping[str, str]
    body: bytes = field(repr=False)

    @property
    def ok(self) -> bool:
        return 200 <= self.status < 300  # noqa: PLR2004 - HTTP status class

    def json(self) -> Any:
        """The decoded body, or None for an empty or non-JSON body."""
        if not self.body:
            return None
        try:
            return loads(self.body)
        except JSONDecodeError:
            return None

    def retry_after(self, now: datetime | None = None) -> float | None:
        return parse_retry_after(self.headers.get("retry-after"), now or datetime.now(UTC))


def parse_retry_after(value: str | None, now: datetime) -> float | None:
    """Seconds to wait from a ``Retry-After`` header given as seconds or an HTTP date."""
    if not value:
        return None
    text = value.strip()
    if text.isdigit():
        return float(text)
    try:
        when = parsedate_to_datetime(text)
    except TypeError, ValueError:
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=UTC)
    return max(0.0, (when - now).total_seconds())


def _default_transport() -> HTTPTransport:
    return HTTPTransport(
        follow_redirects=False,
        enable_cookie_store=False,
        tls_include_system_certs=True,
        connect_timeout=_CONNECT_TIMEOUT_SECONDS,
        # Spans would record query strings, which carry sync cursors and codes.
        enable_otel=False,
    )


class ApiClient:
    """JSON calls to one provider host; a full URL is followed only when it stays on that host."""

    def __init__(
        self,
        provider: str,
        base_url: str,
        *,
        timeout_seconds: float = API_TIMEOUT_SECONDS,
        max_bytes: int = API_MAX_BYTES,
        transport_factory: TransportFactory | None = None,
    ) -> None:
        parts = urlsplit(base_url)
        if parts.scheme != "https" or not parts.hostname:  # noqa: PLR2004 - URL scheme
            raise ValueError(f"{provider} base URL must be https")
        self.provider = provider
        self._base = base_url.rstrip("/")
        self._host = parts.hostname
        self._timeout = timeout_seconds
        self._max_bytes = max_bytes
        self._transport_factory = transport_factory or _default_transport
        self._transport: Any = None

    def _url(self, path_or_url: str) -> str:
        if path_or_url.startswith("/"):
            return f"{self._base}{path_or_url}"
        parts = urlsplit(path_or_url)
        # Paging links come from the provider; a bearer token must never follow one elsewhere.
        if parts.scheme != "https" or parts.hostname != self._host:  # noqa: PLR2004 - URL scheme
            raise ApiError("link_left_host", provider=self.provider)
        return path_or_url

    async def request(
        self,
        method: str,
        path_or_url: str,
        *,
        params: Mapping[str, Any] | None = None,
        json_body: Any = None,
        form: Mapping[str, str] | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> ApiResponse:
        url = self._url(path_or_url)
        sent = {"user-agent": _USER_AGENT, "accept": "application/json"}
        sent.update({key.lower(): value for key, value in (headers or {}).items()})
        content: bytes | None = None
        if json_body is not None:
            content = dumps_bytes(json_body)
            sent["content-type"] = "application/json"
        elif form is not None:
            content = _form(form)
            sent["content-type"] = "application/x-www-form-urlencoded"
        start = time.perf_counter()
        try:
            response = await asyncio.wait_for(
                self._send(method, url, sent, content, _params(params)), timeout=self._timeout
            )
        except TimeoutError as exc:
            self._observe(method, "timeout", start)
            raise ApiError("timeout", provider=self.provider) from exc
        except _TRANSPORT_ERRORS as exc:
            self._observe(method, "unreachable", start)
            raise ApiError("unreachable", provider=self.provider) from exc
        except ApiError as exc:
            self._observe(method, exc.reason, start)
            raise
        self._observe(method, str(response.status), start)
        return response

    async def _send(
        self,
        method: str,
        url: str,
        headers: dict[str, str],
        content: bytes | None,
        params: dict[str, str] | None,
    ) -> ApiResponse:
        if self._transport is None:
            self._transport = self._transport_factory()
        async with Client(self._transport).stream(
            method, url, headers, content, params=params
        ) as response:
            body = bytearray()
            async for chunk in response.content:
                body.extend(chunk)
                if len(body) > self._max_bytes:
                    raise ApiError("too_large", provider=self.provider)
            lowered = {key.lower(): value for key, value in response.headers.items()}
            return ApiResponse(response.status, lowered, bytes(body))

    async def aclose(self) -> None:
        close = getattr(self._transport, "aclose", None)
        self._transport = None
        if close is not None:
            await close()

    def _observe(self, method: str, outcome: str, start: float) -> None:
        OUTBOUND_API_TOTAL.labels(caller=self.provider, method=method, outcome=outcome).inc()
        OUTBOUND_API_DURATION.labels(caller=self.provider).observe(time.perf_counter() - start)


def _params(params: Mapping[str, Any] | None) -> dict[str, str] | None:
    if not params:
        return None
    out: dict[str, str] = {}
    for key, value in params.items():
        if value is None:
            continue
        out[key] = ("true" if value else "false") if isinstance(value, bool) else str(value)
    return out or None


def _form(values: Mapping[str, str]) -> bytes:
    return urlencode(dict(values)).encode()
