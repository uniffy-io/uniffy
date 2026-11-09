"""Fetch a URL a person typed, reaching only the addresses the policy allowed."""

import asyncio
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any
from urllib.parse import urljoin, urlsplit

from pyqwest import Client, HTTPTransport, ReadError, RemoteProtocolError, StreamError, WriteError

from uniffy.infrastructure.outbound.addresses import (
    OutboundFailure,
    OutboundFetchError,
    Resolver,
    normalize_public_url,
    resolve_public,
)
from uniffy.infrastructure.outbound.metrics import OUTBOUND_FETCH_TOTAL

MAX_REDIRECTS = 5
CONNECT_TIMEOUT_SECONDS = 10.0
USER_AGENT = "Uniffy"

_REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})
_NOT_MODIFIED = 304
_TRANSPORT_ERRORS = (ConnectionError, ReadError, WriteError, RemoteProtocolError, StreamError)


TransportFactory = Callable[[str, Sequence[str]], Any]


@dataclass(frozen=True)
class FetchResult:
    """A 2xx body, or a 304 with ``body`` None."""

    status: int
    body: bytes | None
    etag: str | None
    last_modified: str | None


def _pinned_transport(host: str, addresses: Sequence[str]) -> HTTPTransport:
    # The override pins the connection to the checked addresses while TLS still
    # verifies the certificate against the hostname.
    return HTTPTransport(
        dns_overrides={host: list(addresses)},
        follow_redirects=False,
        enable_cookie_store=False,
        tls_include_system_certs=True,
        connect_timeout=CONNECT_TIMEOUT_SECONDS,
        # Spans would record the full URL, which for a private feed is its secret.
        enable_otel=False,
    )


async def fetch_public(
    url: str,
    *,
    caller: str,
    max_bytes: int,
    deadline_seconds: float,
    headers: Mapping[str, str] | None = None,
    max_redirects: int = MAX_REDIRECTS,
    transport_factory: TransportFactory = _pinned_transport,
    resolver: Resolver | None = None,
) -> FetchResult:
    try:
        result = await asyncio.wait_for(
            _follow(url, dict(headers or {}), max_bytes, max_redirects, transport_factory, resolver),
            timeout=deadline_seconds,
        )
    except TimeoutError as exc:
        OUTBOUND_FETCH_TOTAL.labels(caller=caller, outcome=OutboundFailure.TIMEOUT.value).inc()
        raise OutboundFetchError(OutboundFailure.TIMEOUT) from exc
    except OutboundFetchError as exc:
        OUTBOUND_FETCH_TOTAL.labels(caller=caller, outcome=exc.failure.value).inc()
        raise
    OUTBOUND_FETCH_TOTAL.labels(caller=caller, outcome=str(result.status)).inc()
    return result


async def _follow(
    url: str,
    headers: dict[str, str],
    max_bytes: int,
    max_redirects: int,
    transport_factory: TransportFactory,
    resolver: Resolver | None,
) -> FetchResult:
    current = normalize_public_url(url)
    headers.setdefault("user-agent", USER_AGENT)
    for _hop in range(max_redirects + 1):
        parts = urlsplit(current)
        host = parts.hostname or ""
        port = parts.port or (443 if parts.scheme == "https" else 80)  # noqa: PLR2004 - URL scheme
        addresses = await resolve_public(host, port, resolver=resolver)
        transport = transport_factory(host, addresses)
        try:
            outcome = await _request(transport, current, headers, max_bytes)
        finally:
            close = getattr(transport, "aclose", None)
            if close is not None:
                await close()
        if isinstance(outcome, FetchResult):
            return outcome
        current = _next_hop(current, outcome)
        # Validators belong to the first URL; a new host must not see them.
        headers.pop("if-none-match", None)
        headers.pop("if-modified-since", None)
    raise OutboundFetchError(OutboundFailure.TOO_MANY_REDIRECTS)


async def _request(
    transport: Any, url: str, headers: dict[str, str], max_bytes: int
) -> FetchResult | str:
    """The final result, or the raw ``Location`` of a redirect to follow."""
    try:
        async with Client(transport).stream("GET", url, headers) as response:
            status = response.status
            if status in _REDIRECT_STATUSES:
                location = response.headers.get("location")
                if not location:
                    raise OutboundFetchError(OutboundFailure.REDIRECT_REFUSED, status)
                return location
            if status == _NOT_MODIFIED:
                return FetchResult(status, None, *_validators(response.headers))
            if not 200 <= status < 300:  # noqa: PLR2004 - HTTP status class
                raise OutboundFetchError(OutboundFailure.HTTP_STATUS, status)
            body = await _read_capped(response.content, max_bytes)
            return FetchResult(status, body, *_validators(response.headers))
    except _TRANSPORT_ERRORS as exc:
        raise OutboundFetchError(OutboundFailure.UNREACHABLE) from exc


def _validators(headers: Any) -> tuple[str | None, str | None]:
    return headers.get("etag") or None, headers.get("last-modified") or None


async def _read_capped(chunks: Any, max_bytes: int) -> bytes:
    # Counted after decompression, so a small compressed bomb still hits the cap.
    buffer = bytearray()
    async for chunk in chunks:
        buffer.extend(chunk)
        if len(buffer) > max_bytes:
            raise OutboundFetchError(OutboundFailure.TOO_LARGE)
    return bytes(buffer)


def _next_hop(current: str, location: str) -> str:
    target = urljoin(current, location)
    try:
        normalized = normalize_public_url(target)
    except OutboundFetchError as exc:
        raise OutboundFetchError(OutboundFailure.REDIRECT_REFUSED) from exc
    # A secret path must not leave TLS because a server said so.
    if urlsplit(current).scheme == "https" and urlsplit(normalized).scheme != "https":  # noqa: PLR2004 - URL scheme
        raise OutboundFetchError(OutboundFailure.REDIRECT_REFUSED)
    return normalized
