"""Slim async client for the LiveKit RoomService Twirp API.

Covers only the admin calls the backend needs (kick, mute, reconcile). Kept
SDK-free on purpose: the token format and Twirp JSON surface are stable, and
riding pyqwest (already the ConnectRPC transport) avoids pulling the LiveKit
SDK dependency tree into the self-host bundle.
"""

import asyncio
import time
from typing import Any

from loguru import logger
from pyqwest import Client, ReadError, WriteError

from uniffy.domains.calls.config import LiveKitConfig
from uniffy.domains.calls.tokens import LiveKitTokenMinter

logger = logger.bind(component="calls.livekit_client")

REQUEST_TIMEOUT_SECONDS = 5.0
BREAKER_FAILURE_THRESHOLD = 5
BREAKER_WINDOW_SECONDS = 30.0
BREAKER_OPEN_SECONDS = 60.0

_TRANSPORT_ERRORS = (ConnectionError, TimeoutError, ReadError, WriteError)


class LiveKitApiError(RuntimeError):
    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


class LiveKitUnavailableError(LiveKitApiError):
    """Raised while the circuit breaker is open; callers surface 'calls unavailable'."""


class _CircuitBreaker:
    def __init__(self) -> None:
        self._failures: list[float] = []
        self._open_until: float = 0.0

    def check(self) -> None:
        if time.monotonic() < self._open_until:
            raise LiveKitUnavailableError("LiveKit circuit breaker open")

    def record_success(self) -> None:
        self._failures.clear()

    def record_failure(self) -> None:
        now = time.monotonic()
        self._failures = [t for t in self._failures if now - t < BREAKER_WINDOW_SECONDS]
        self._failures.append(now)
        if len(self._failures) >= BREAKER_FAILURE_THRESHOLD:
            self._open_until = now + BREAKER_OPEN_SECONDS
            self._failures.clear()
            logger.warning(f"LiveKit circuit breaker opened for {BREAKER_OPEN_SECONDS}s")


class LiveKitAdminClient:
    def __init__(self, config: LiveKitConfig) -> None:
        self._config = config
        self._minter = LiveKitTokenMinter(config)
        self._breaker = _CircuitBreaker()
        self._http = Client()

    async def _call(
        self, method: str, payload: dict[str, Any], *, room: str | None = None
    ) -> dict[str, Any]:
        self._breaker.check()
        token = self._minter.mint_admin_token(room=room)
        try:
            response = await asyncio.wait_for(
                self._http.post(
                    f"{self._config.host}/twirp/livekit.RoomService/{method}",
                    headers={
                        "authorization": f"Bearer {token}",
                        "content-type": "application/json",
                    },
                    content=payload,
                ),
                timeout=REQUEST_TIMEOUT_SECONDS,
            )
        except _TRANSPORT_ERRORS as exc:
            self._breaker.record_failure()
            raise LiveKitApiError(f"LiveKit {method} transport error: {exc}") from exc

        if response.status >= 500:
            self._breaker.record_failure()
            raise LiveKitApiError(
                f"LiveKit {method} failed: {response.status}", status_code=response.status
            )
        if response.status >= 400:
            # 4xx is a caller problem (room gone, identity unknown) - the SFU
            # itself is healthy, so the breaker stays closed.
            self._breaker.record_success()
            raise LiveKitApiError(
                f"LiveKit {method} rejected: {response.status} {response.text()[:200]}",
                status_code=response.status,
            )
        self._breaker.record_success()
        data = response.json()
        return data if isinstance(data, dict) else {}

    async def list_rooms(self, names: list[str] | None = None) -> list[dict[str, Any]]:
        payload: dict[str, Any] = {"names": names} if names else {}
        data = await self._call("ListRooms", payload)
        return data.get("rooms", [])

    async def delete_room(self, room: str) -> None:
        await self._call("DeleteRoom", {"room": room}, room=room)

    async def list_participants(self, room: str) -> list[dict[str, Any]]:
        data = await self._call("ListParticipants", {"room": room}, room=room)
        return data.get("participants", [])

    async def remove_participant(self, room: str, identity: str) -> None:
        await self._call("RemoveParticipant", {"room": room, "identity": identity}, room=room)

    async def mute_published_track(
        self, room: str, identity: str, track_sid: str, muted: bool = True
    ) -> None:
        await self._call(
            "MutePublishedTrack",
            {"room": room, "identity": identity, "track_sid": track_sid, "muted": muted},
            room=room,
        )

    async def mute_participant_microphone(self, room: str, identity: str) -> bool:
        """Mute every microphone track the participant publishes; True if any found."""
        participants = await self.list_participants(room)
        muted_any = False
        for participant in participants:
            if participant.get("identity") != identity:
                continue
            for track in participant.get("tracks", []):
                source = str(track.get("source", "")).upper()
                track_type = str(track.get("type", "")).upper()
                if source == "MICROPHONE" or (not source and track_type == "AUDIO"):  # noqa: PLR2004
                    sid = track.get("sid", "")
                    if sid:
                        await self.mute_published_track(room, identity, sid, muted=True)
                        muted_any = True
        return muted_any


_admin_client: LiveKitAdminClient | None = None


def get_livekit_admin_client() -> LiveKitAdminClient:
    global _admin_client
    if _admin_client is None:
        from uniffy.domains.calls.config import get_livekit_config

        _admin_client = LiveKitAdminClient(get_livekit_config())
    return _admin_client
