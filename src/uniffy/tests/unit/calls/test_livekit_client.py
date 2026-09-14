"""Unit tests for the LiveKit Twirp admin client and its circuit breaker."""

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from uniffy.domains.calls.config import LiveKitConfig
from uniffy.domains.calls.livekit import (
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


async def test_list_participants_unwraps_payload():
    client = _client()
    client._http.post = AsyncMock(
        return_value=_response(200, {"participants": [{"identity": "u:d"}]})
    )
    participants = await client.list_participants("room")
    assert participants == [{"identity": "u:d"}]
    url = client._http.post.call_args.args[0]
    assert url == "http://livekit:7880/twirp/livekit.RoomService/ListParticipants"
    headers = client._http.post.call_args.kwargs["headers"]
    assert headers["authorization"].startswith("Bearer ")


async def test_4xx_raises_without_tripping_breaker():
    client = _client()
    client._http.post = AsyncMock(return_value=_response(404))
    for _ in range(BREAKER_FAILURE_THRESHOLD + 1):
        with pytest.raises(LiveKitApiError) as exc_info:
            await client.delete_room("gone")
        assert exc_info.value.status_code == 404
    # Breaker stayed closed: the next call still reaches the transport.
    client._http.post = AsyncMock(return_value=_response(200))
    await client.delete_room("ok")


async def test_breaker_opens_after_repeated_5xx():
    client = _client()
    client._http.post = AsyncMock(return_value=_response(500))
    for _ in range(BREAKER_FAILURE_THRESHOLD):
        with pytest.raises(LiveKitApiError):
            await client.list_rooms()
    with pytest.raises(LiveKitUnavailableError):
        await client.list_rooms()


async def test_transport_error_counts_as_failure():
    client = _client()
    client._http.post = AsyncMock(side_effect=ConnectionError("refused"))
    for _ in range(BREAKER_FAILURE_THRESHOLD):
        with pytest.raises(LiveKitApiError):
            await client.list_rooms()
    with pytest.raises(LiveKitUnavailableError):
        await client.list_rooms()


@pytest.mark.parametrize("failure", [TimeoutError("unreachable"), ConnectionError("refused"), 503])
async def test_maintenance_stops_requests_on_first_outage_and_recovers(failure):
    client = _client()
    client._http.post = AsyncMock(
        side_effect=failure if isinstance(failure, Exception) else None,
        return_value=_response(failure) if isinstance(failure, int) else None,
    )

    with client.stop_after_unavailable() as media:
        with pytest.raises(LiveKitUnavailableError):
            await client.list_participants("room")
        assert media.reachable is False
        with pytest.raises(LiveKitUnavailableError):
            await client.delete_room("room")
        assert client._http.post.await_count == 1

    client._http.post = AsyncMock(return_value=_response(200))
    with client.stop_after_unavailable() as recovered:
        await client.delete_room("room")
        assert recovered.reachable is True
    client._http.post.assert_awaited_once()


async def test_missing_room_keeps_maintenance_media_available():
    client = _client()
    client._http.post = AsyncMock(side_effect=[_response(404), _response(200)])

    with client.stop_after_unavailable() as media:
        with pytest.raises(LiveKitApiError) as error:
            await client.list_participants("gone")
        assert error.value.status_code == 404
        await client.list_participants("present")
        assert media.reachable is True
    assert client._http.post.await_count == 2


async def test_maintenance_outage_does_not_suppress_other_tasks():
    client = _client()
    failed = asyncio.Event()
    checked = asyncio.Event()
    client._http.post = AsyncMock(side_effect=[TimeoutError("unreachable"), _response(200)])

    async def maintenance():
        with client.stop_after_unavailable():
            with pytest.raises(LiveKitUnavailableError):
                await client.list_rooms()
            failed.set()
            await checked.wait()
            with pytest.raises(LiveKitUnavailableError):
                await client.delete_room("room")

    async def independent_request():
        await failed.wait()
        try:
            await client.list_rooms()
        finally:
            checked.set()

    await asyncio.gather(maintenance(), independent_request())
    assert client._http.post.await_count == 2


async def test_mute_participant_microphone_targets_mic_tracks():
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
    muted = await client.mute_participant_microphone("room", "u1:d1")
    assert muted is True
    assert client._http.post.call_count == 2
    mute_body = client._http.post.call_args.kwargs["content"]
    assert mute_body == {"room": "room", "identity": "u1:d1", "track_sid": "TR_mic", "muted": True}
