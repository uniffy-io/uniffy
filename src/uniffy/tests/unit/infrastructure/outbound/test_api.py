"""Provider API calls: JSON in and out, paging links held to the provider host, typed failures."""

import asyncio
from datetime import UTC, datetime

import pytest
from pyqwest.testing import ASGITransport

from uniffy.core.json_codec import dumps_bytes, loads
from uniffy.infrastructure.outbound import ApiClient, ApiError, parse_retry_after

BASE = "https://api.example.com/v1"


def _app(seen: list, *, status: int = 200, body: bytes = b'{"ok": true}', headers=None, delay=0.0):
    async def app(scope, receive, send):
        message = await receive()
        seen.append({
            "method": scope["method"],
            "path": scope["path"],
            "query": scope["query_string"].decode(),
            "headers": {k.decode(): v.decode() for k, v in scope["headers"]},
            "body": message.get("body", b""),
        })
        if delay:
            await asyncio.sleep(delay)
        await send({"type": "http.response.start", "status": status, "headers": headers or []})
        await send({"type": "http.response.body", "body": body})

    return app


def _client(app, **kwargs) -> ApiClient:
    return ApiClient("test", BASE, transport_factory=lambda: ASGITransport(app), **kwargs)


async def test_json_goes_out_and_comes_back() -> None:
    seen: list = []
    client = _client(_app(seen))
    response = await client.request(
        "POST",
        "/events",
        params={"sendUpdates": "all", "skip": None, "flag": True},
        json_body={"summary": "Standup"},
        headers={"Authorization": "Bearer t"},
    )
    assert response.status == 200
    assert response.ok
    assert response.json() == {"ok": True}
    request = seen[0]
    assert request["path"] == "/v1/events"
    assert request["query"] == "sendUpdates=all&flag=true"
    assert request["headers"]["authorization"] == "Bearer t"
    assert request["headers"]["content-type"] == "application/json"
    assert loads(request["body"]) == {"summary": "Standup"}


async def test_a_form_body_is_url_encoded() -> None:
    seen: list = []
    client = _client(_app(seen))
    await client.request("POST", "/token", form={"code": "a b", "grant_type": "authorization_code"})
    assert seen[0]["headers"]["content-type"] == "application/x-www-form-urlencoded"
    assert seen[0]["body"] == b"code=a+b&grant_type=authorization_code"


async def test_error_statuses_are_returned_not_raised() -> None:
    seen: list = []
    client = _client(
        _app(seen, status=429, body=dumps_bytes({"error": "slow"}), headers=[(b"Retry-After", b"7")])
    )
    response = await client.request("GET", "/events")
    assert response.status == 429
    assert not response.ok
    assert response.headers["retry-after"] == "7"
    assert response.retry_after() == 7.0


async def test_a_paging_link_on_the_same_host_is_followed() -> None:
    seen: list = []
    client = _client(_app(seen))
    await client.request("GET", "https://api.example.com/v1/events?page=2")
    assert seen[0]["query"] == "page=2"


@pytest.mark.parametrize(
    "link",
    [
        "https://attacker.example.net/v1/events",
        "http://api.example.com/v1/events",
        "https://api.example.com.attacker.net/v1",
    ],
)
async def test_a_link_off_the_provider_host_is_refused(link: str) -> None:
    seen: list = []
    client = _client(_app(seen))
    with pytest.raises(ApiError) as caught:
        await client.request("GET", link, headers={"authorization": "Bearer secret"})
    assert caught.value.reason == "link_left_host"
    assert "secret" not in str(caught.value)
    assert seen == []


async def test_a_body_over_the_cap_is_refused() -> None:
    client = _client(_app([], body=b"x" * 2048), max_bytes=1024)
    with pytest.raises(ApiError) as caught:
        await client.request("GET", "/big")
    assert caught.value.reason == "too_large"


async def test_a_slow_host_times_out() -> None:
    client = _client(_app([], delay=1.0), timeout_seconds=0.05)
    with pytest.raises(ApiError) as caught:
        await client.request("GET", "/slow")
    assert caught.value.reason == "timeout"


def test_the_base_must_be_https() -> None:
    with pytest.raises(ValueError):
        ApiClient("test", "http://api.example.com")


def test_retry_after_reads_seconds_and_dates() -> None:
    now = datetime(2026, 11, 7, 12, 0, 0, tzinfo=UTC)
    assert parse_retry_after("30", now) == 30.0
    assert parse_retry_after("Sat, 07 Nov 2026 12:01:00 GMT", now) == 60.0
    assert parse_retry_after("Sat, 07 Nov 2026 11:00:00 GMT", now) == 0.0
    assert parse_retry_after("soon", now) is None
    assert parse_retry_after(None, now) is None
