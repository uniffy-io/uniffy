"""Fetching a user-supplied URL: redirects re-checked, bodies capped, secrets kept out of errors."""

import asyncio
from collections.abc import Sequence

import pytest
from pyqwest.testing import ASGITransport

from uniffy.infrastructure.outbound import OutboundFailure, OutboundFetchError, fetch_public

SECRET_URL = "https://feeds.example.com/private-abc123/basic.ics"
_SECRET = "private-abc123"
_PUBLIC = "93.184.215.14"
_ETAG = '"v1"'


def _resolver(table: dict[str, str]):
    async def resolve(host: str, port: int) -> Sequence[str]:
        return [table.get(host, _PUBLIC)]

    return resolve


def _app(routes: dict[str, tuple[int, list[tuple[bytes, bytes]], bytes]], seen: list):
    async def app(scope, receive, send):
        seen.append((scope["path"], dict(scope["headers"])))
        status, headers, body = routes.get(scope["path"], (404, [], b""))
        await send({"type": "http.response.start", "status": status, "headers": headers})
        await send({"type": "http.response.body", "body": body})

    return app


def _factory(app, hosts: list):
    def build(host: str, addresses: Sequence[str]):
        hosts.append((host, tuple(addresses)))
        return ASGITransport(app)

    return build


async def _fetch(url, app, *, resolver=None, hosts=None, **kwargs):
    return await fetch_public(
        url,
        caller="test",
        max_bytes=kwargs.pop("max_bytes", 1024),
        deadline_seconds=kwargs.pop("deadline_seconds", 5),
        transport_factory=_factory(app, hosts if hosts is not None else []),
        resolver=resolver or _resolver({}),
        **kwargs,
    )


async def test_a_body_comes_back_with_its_validators() -> None:
    seen: list = []
    app = _app({"/private-abc123/basic.ics": (200, [(b"etag", b'"v1"')], b"BEGIN:VCALENDAR")}, seen)
    hosts: list = []
    result = await _fetch(SECRET_URL, app, hosts=hosts)
    assert result.body == b"BEGIN:VCALENDAR"
    assert result.etag == _ETAG
    assert hosts == [("feeds.example.com", (_PUBLIC,))]


async def test_validators_are_sent_and_a_304_has_no_body() -> None:
    seen: list = []
    app = _app({"/private-abc123/basic.ics": (304, [], b"")}, seen)
    result = await _fetch(SECRET_URL, app, headers={"if-none-match": '"v1"'})
    assert result.status == 304
    assert result.body is None
    assert seen[0][1][b"if-none-match"] == b'"v1"'


async def test_a_redirect_to_a_private_host_is_refused() -> None:
    app = _app(
        {"/private-abc123/basic.ics": (302, [(b"location", b"https://internal.corp/x")], b"")}, []
    )
    with pytest.raises(OutboundFetchError) as caught:
        await _fetch(SECRET_URL, app, resolver=_resolver({"internal.corp": "10.1.2.3"}))
    assert caught.value.failure == OutboundFailure.BLOCKED_ADDRESS


async def test_a_redirect_is_followed_with_validators_dropped() -> None:
    seen: list = []
    app = _app(
        {
            "/private-abc123/basic.ics": (301, [(b"location", b"/moved.ics")], b""),
            "/moved.ics": (200, [], b"BEGIN:VCALENDAR"),
        },
        seen,
    )
    result = await _fetch(SECRET_URL, app, headers={"if-none-match": '"v1"'})
    assert result.body == b"BEGIN:VCALENDAR"
    assert b"if-none-match" not in seen[1][1]


async def test_leaving_tls_on_a_redirect_is_refused() -> None:
    app = _app(
        {"/private-abc123/basic.ics": (302, [(b"location", b"http://feeds.example.com/x")], b"")},
        [],
    )
    with pytest.raises(OutboundFetchError) as caught:
        await _fetch(SECRET_URL, app)
    assert caught.value.failure == OutboundFailure.REDIRECT_REFUSED


async def test_a_redirect_loop_stops() -> None:
    app = _app(
        {"/private-abc123/basic.ics": (302, [(b"location", b"/private-abc123/basic.ics")], b"")}, []
    )
    with pytest.raises(OutboundFetchError) as caught:
        await _fetch(SECRET_URL, app)
    assert caught.value.failure == OutboundFailure.TOO_MANY_REDIRECTS


async def test_a_body_past_the_cap_is_abandoned() -> None:
    app = _app({"/private-abc123/basic.ics": (200, [], b"x" * 2048)}, [])
    with pytest.raises(OutboundFetchError) as caught:
        await _fetch(SECRET_URL, app, max_bytes=1024)
    assert caught.value.failure == OutboundFailure.TOO_LARGE


async def test_an_error_status_keeps_its_code() -> None:
    app = _app({}, [])
    with pytest.raises(OutboundFetchError) as caught:
        await _fetch(SECRET_URL, app)
    assert caught.value.failure == OutboundFailure.HTTP_STATUS
    assert caught.value.status == 404


async def test_a_slow_server_hits_the_deadline() -> None:
    async def app(scope, receive, send):
        await asyncio.sleep(1)

    with pytest.raises(OutboundFetchError) as caught:
        await _fetch(SECRET_URL, app, deadline_seconds=0.05)
    assert caught.value.failure == OutboundFailure.TIMEOUT


@pytest.mark.parametrize(
    "app",
    [
        _app({}, []),
        _app({"/private-abc123/basic.ics": (302, [(b"location", b"http://x.example/")], b"")}, []),
        _app({"/private-abc123/basic.ics": (200, [], b"x" * 4096)}, []),
    ],
)
async def test_error_text_never_carries_the_url(app) -> None:
    with pytest.raises(OutboundFetchError) as caught:
        await _fetch(SECRET_URL, app)
    assert _SECRET not in str(caught.value)
    assert _SECRET not in repr(caught.value)
