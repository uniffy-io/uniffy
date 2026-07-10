"""Unit tests for the LiveKit Twirp admin client and its circuit breaker."""

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from uniffy.domains.calls.config import LiveKitConfig
from uniffy.domains.calls.livekit_client import (
    BREAKER_FAILURE_THRESHOLD,
    LiveKitAdminClient,
    LiveKitApiError,
    LiveKitUnavailableError,
)

CONFIG = LiveKitConfig(
    host="http://livekit:7880",
    api_key="k",
    api_secret="s" * 32,
    ws_url="/livekit",
)


def _run(coro):
    return asyncio.run(coro)


def _response(status: int, payload: dict | None = None) -> MagicMock:
    response = MagicMock()
    response.status = status
    response.json.return_value = payload or {}
    response.text.return_value = ""
    return response


def _client() -> LiveKitAdminClient:
    admin = LiveKitAdminClient(CONFIG)
    admin._http = MagicMock()
    return admin


def test_list_participants_unwraps_payload():
    client = _client()
    client._http.post = AsyncMock(
        return_value=_response(200, {"participants": [{"identity": "u:d"}]})
    )
    participants = _run(client.list_participants("room"))
    assert participants == [{"identity": "u:d"}]
    url = client._http.post.call_args.args[0]
    assert url == "http://livekit:7880/twirp/livekit.RoomService/ListParticipants"
    headers = client._http.post.call_args.kwargs["headers"]
    assert headers["authorization"].startswith("Bearer ")


def test_4xx_raises_without_tripping_breaker():
    client = _client()
    client._http.post = AsyncMock(return_value=_response(404))
    for _ in range(BREAKER_FAILURE_THRESHOLD + 1):
        with pytest.raises(LiveKitApiError) as exc_info:
            _run(client.delete_room("gone"))
        assert exc_info.value.status_code == 404
    # Breaker stayed closed: the next call still reaches the transport.
    client._http.post = AsyncMock(return_value=_response(200))
    _run(client.delete_room("ok"))


def test_breaker_opens_after_repeated_5xx():
    client = _client()
    client._http.post = AsyncMock(return_value=_response(500))
    for _ in range(BREAKER_FAILURE_THRESHOLD):
        with pytest.raises(LiveKitApiError):
            _run(client.list_rooms())
    with pytest.raises(LiveKitUnavailableError):
        _run(client.list_rooms())


def test_transport_error_counts_as_failure():
    client = _client()
    client._http.post = AsyncMock(side_effect=ConnectionError("refused"))
    for _ in range(BREAKER_FAILURE_THRESHOLD):
        with pytest.raises(LiveKitApiError):
            _run(client.list_rooms())
    with pytest.raises(LiveKitUnavailableError):
        _run(client.list_rooms())


def test_mute_participant_microphone_targets_mic_tracks():
    client = _client()
    client._http.post = AsyncMock(
        side_effect=[
            _response(
                200,
                {
                    "participants": [
                        {
                            "identity": "u1:d1",
                            "tracks": [
                                {"sid": "TR_mic", "source": "MICROPHONE", "type": "AUDIO"},
                                {"sid": "TR_cam", "source": "CAMERA", "type": "VIDEO"},
                            ],
                        },
                        {
                            "identity": "u2:d1",
                            "tracks": [{"sid": "TR_other", "source": "MICROPHONE"}],
                        },
                    ]
                },
            ),
            _response(200),
        ]
    )
    muted = _run(client.mute_participant_microphone("room", "u1:d1"))
    assert muted is True
    assert client._http.post.call_count == 2
    mute_body = client._http.post.call_args.kwargs["content"]
    assert mute_body == {"room": "room", "identity": "u1:d1", "track_sid": "TR_mic", "muted": True}
