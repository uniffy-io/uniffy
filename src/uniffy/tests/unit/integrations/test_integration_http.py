"""IntegrationHttpClient error taxonomy, breaker, caps and path encoding.

No network: the pyqwest client is a MagicMock and responses are plain
FullResponse-shaped fakes.
"""

import asyncio
import json
import time
from unittest.mock import AsyncMock, MagicMock

import pytest

from uniffy.core.errors import NotFoundError, RateLimitExceededError, ValidationError
from uniffy.domains.integrations.base import (
    IntegrationApiError,
    IntegrationAuthError,
    IntegrationUnavailableError,
)
from uniffy.domains.integrations.http import (
    BREAKER_FAILURE_THRESHOLD,
    IntegrationHttpClient,
    encode_segment,
)

_MARKER = "SECRET-CREDENTIAL-MARKER"


def _run(coro):
    return asyncio.run(coro)


class _Headers:
    def __init__(self, values: dict[str, str] | None = None) -> None:
        self._values = {k.lower(): v for k, v in (values or {}).items()}

    def get(self, name: str):
        value = self._values.get(name.lower())
        return None if value is None else [value]


class _Response:
    def __init__(
        self,
        status: int,
        *,
        json_data=None,
        text: str = "",
        content: bytes | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.status = status
        self.headers = _Headers(headers)
        if content is not None:
            self.content = content
        elif json_data is not None:
            self.content = json.dumps(json_data).encode()
        else:
            self.content = text.encode()
        self._json = json_data
        self._text = text

    def json(self):
        return self._json

    def text(self) -> str:
        return self._text


def _client() -> IntegrationHttpClient:
    client = IntegrationHttpClient(
        "github", "https://api.github.com", {"authorization": f"Bearer {_MARKER}"}
    )
    client._http = MagicMock()
    return client


def test_200_returns_decoded_json() -> None:
    client = _client()
    client._http.get = AsyncMock(return_value=_Response(200, json_data={"login": "octocat"}))

    assert _run(client.request("GET", "/user")) == {"login": "octocat"}
    assert client._http.get.call_args.args[0] == "https://api.github.com/user"


def test_204_and_empty_bodies_return_none() -> None:
    client = _client()
    client._http.get = AsyncMock(return_value=_Response(204))
    assert _run(client.request("GET", "/x")) is None

    client._http.get = AsyncMock(return_value=_Response(200, content=b""))
    assert _run(client.request("GET", "/x")) is None


def test_401_raises_auth_error() -> None:
    client = _client()
    client._http.get = AsyncMock(return_value=_Response(401))
    with pytest.raises(IntegrationAuthError):
        _run(client.request("GET", "/user"))


def test_404_raises_not_found() -> None:
    client = _client()
    client._http.get = AsyncMock(return_value=_Response(404))
    with pytest.raises(NotFoundError):
        _run(client.request("GET", "/repos/acme/gone"))


def test_422_raises_api_error_with_status_and_truncated_text() -> None:
    client = _client()
    client._http.get = AsyncMock(return_value=_Response(422, text="e" * 250))
    with pytest.raises(IntegrationApiError) as exc_info:
        _run(client.request("GET", "/search"))
    assert exc_info.value.status_code == 422
    assert "e" * 200 in str(exc_info.value)
    assert "e" * 201 not in str(exc_info.value)


def test_repeated_500s_open_the_breaker() -> None:
    client = _client()
    client._http.get = AsyncMock(return_value=_Response(500))
    for _ in range(BREAKER_FAILURE_THRESHOLD):
        with pytest.raises(IntegrationApiError) as exc_info:
            _run(client.request("GET", "/x"))
        assert exc_info.value.status_code == 500
    with pytest.raises(IntegrationUnavailableError):
        _run(client.request("GET", "/x"))


def test_4xx_never_trips_the_breaker() -> None:
    client = _client()
    client._http.get = AsyncMock(return_value=_Response(404))
    for _ in range(BREAKER_FAILURE_THRESHOLD + 1):
        with pytest.raises(NotFoundError):
            _run(client.request("GET", "/x"))
    client._http.get = AsyncMock(return_value=_Response(200, json_data={}))
    assert _run(client.request("GET", "/x")) == {}


def test_exhausted_403_rate_limit_maps_to_rate_limit_error() -> None:
    client = _client()
    client._http.get = AsyncMock(
        return_value=_Response(
            403,
            headers={
                "x-ratelimit-remaining": "0",
                "x-ratelimit-reset": str(int(time.time()) + 120),
            },
        )
    )
    with pytest.raises(RateLimitExceededError) as exc_info:
        _run(client.request("GET", "/x"))
    assert exc_info.value.retry_after > 0


def test_429_honours_the_retry_after_header() -> None:
    client = _client()
    client._http.get = AsyncMock(return_value=_Response(429, headers={"Retry-After": "7"}))
    with pytest.raises(RateLimitExceededError) as exc_info:
        _run(client.request("GET", "/x"))
    assert exc_info.value.retry_after == 7


def test_plain_403_without_rate_limit_headers_is_an_api_error() -> None:
    client = _client()
    client._http.get = AsyncMock(return_value=_Response(403, text="forbidden"))
    with pytest.raises(IntegrationApiError) as exc_info:
        _run(client.request("GET", "/x"))
    assert exc_info.value.status_code == 403


def test_transport_failures_open_the_breaker_and_skip_the_transport() -> None:
    client = _client()
    client._http.get = AsyncMock(side_effect=ConnectionError("refused"))
    for _ in range(BREAKER_FAILURE_THRESHOLD):
        with pytest.raises(IntegrationApiError):
            _run(client.request("GET", "/x"))
    client._http.get = AsyncMock(return_value=_Response(200, json_data={}))
    with pytest.raises(IntegrationUnavailableError):
        _run(client.request("GET", "/x"))
    client._http.get.assert_not_called()


def test_oversized_bodies_are_discarded() -> None:
    client = _client()
    client._http.get = AsyncMock(return_value=_Response(200, content=b"x" * 2_000_001))
    with pytest.raises(IntegrationApiError) as exc_info:
        _run(client.request("GET", "/x"))
    assert "2MB" in str(exc_info.value)


def test_encode_segment_passes_integers_through() -> None:
    assert encode_segment(42) == "42"


def test_encode_segment_quotes_everything_including_slashes() -> None:
    encoded = encode_segment("a b/c")
    assert encoded == "a%20b%2Fc"
    assert "/" not in encoded


@pytest.mark.parametrize(
    "value",
    ["", "..", "a/../b", "/leading", "a\nb", "a\x7fb"],
    ids=["empty", "dotdot", "traversal", "leading-slash", "newline", "delete-char"],
)
def test_encode_segment_rejects_unsafe_segments(value: str) -> None:
    with pytest.raises(ValidationError):
        encode_segment(value)


_ERROR_SCENARIOS = [
    pytest.param(_Response(401), None, id="401"),
    pytest.param(_Response(403, text="nope"), None, id="403"),
    pytest.param(_Response(404), None, id="404"),
    pytest.param(_Response(422, text="unprocessable"), None, id="422"),
    pytest.param(_Response(429, headers={"Retry-After": "3"}), None, id="429"),
    pytest.param(_Response(500), None, id="500"),
    pytest.param(None, ConnectionError("refused"), id="transport"),
]


@pytest.mark.parametrize(("response", "side_effect"), _ERROR_SCENARIOS)
def test_error_text_never_contains_the_credential(response, side_effect) -> None:
    client = _client()
    client._http.get = AsyncMock(return_value=response, side_effect=side_effect)
    with pytest.raises(Exception) as exc_info:
        _run(client.request("GET", "/user"))
    assert _MARKER not in str(exc_info.value)


def test_query_params_reach_pyqwest_as_strings() -> None:
    """pyqwest rejects non-string query values; tool args arrive as ints and bools."""
    import pyqwest
    from pyqwest.testing import ASGITransport

    from uniffy.domains.integrations.http import IntegrationHttpClient

    captured: dict = {}

    async def app(scope, receive, send):
        captured["query"] = scope.get("query_string")
        await send(
            {
                "type": "http.response.start",
                "status": 200,
                "headers": [(b"content-type", b"application/json")],
            }
        )
        await send({"type": "http.response.body", "body": b"{}"})

    async def _call() -> None:
        client = IntegrationHttpClient("github", "http://upstream", {"user-agent": "t"})
        client._http = pyqwest.Client(ASGITransport(app))
        await client.request(
            "GET",
            "/search/issues",
            params={"q": "bug", "per_page": 20, "page": 1, "ref": None, "flag": True},
        )

    asyncio.run(_call())
    assert captured["query"] == b"q=bug&per_page=20&page=1&flag=true"
