"""LiveKit connection settings resolved from env."""

import os
from dataclasses import dataclass

from uniffy.core.models.calls import ScreenShareQuality


class LiveKitConfigError(RuntimeError):
    pass


def default_screen_share_quality() -> ScreenShareQuality:
    """Deploy-time screen-share ceiling for many-viewer calls (self-host safe).

    A 1:1 DIRECT call overrides this to MAX at resolve time; this only governs
    channel / group calls where egress scales with the viewer count.
    """
    raw = os.getenv("CALLS_DEFAULT_SCREEN_SHARE_QUALITY", "BALANCED").strip().upper()
    try:
        return ScreenShareQuality[raw]
    except KeyError:
        return ScreenShareQuality.BALANCED


@dataclass(frozen=True)
class LiveKitConfig:
    host: str
    api_key: str
    api_secret: str
    # Either a path resolved client-side against window.location (same-origin
    # edge route, e.g. "/livekit") or an absolute ws(s):// split-origin override.
    ws_url: str

    @classmethod
    def from_env(cls) -> LiveKitConfig:
        host = os.getenv("LIVEKIT_HOST", "").rstrip("/")
        api_key = os.getenv("LIVEKIT_API_KEY", "")
        api_secret = os.getenv("LIVEKIT_API_SECRET", "")
        ws_url = os.getenv("LIVEKIT_WS_URL", "/livekit")
        if not host or not api_key or not api_secret:
            raise LiveKitConfigError(
                "LIVEKIT_HOST, LIVEKIT_API_KEY and LIVEKIT_API_SECRET are required"
            )
        return cls(host=host, api_key=api_key, api_secret=api_secret, ws_url=ws_url)


@dataclass(frozen=True)
class TurnConfig:
    """Ephemeral TURN credential settings (k8s/STUNner relayed-media mode).

    Unset TURN_SERVER_URLS means direct media (embedded TURN via LiveKit
    signaling) and resolves to None everywhere.
    """

    server_urls: tuple[str, ...]
    shared_secret: str
    credential_ttl_seconds: int

    @classmethod
    def from_env(cls) -> TurnConfig | None:
        raw_urls = os.getenv("TURN_SERVER_URLS", "")
        urls = tuple(url.strip() for url in raw_urls.split(",") if url.strip())
        if not urls:
            return None
        shared_secret = os.getenv("TURN_SHARED_SECRET", "")
        if not shared_secret:
            raise LiveKitConfigError(
                "TURN_SHARED_SECRET is required when TURN_SERVER_URLS is set"
            )
        try:
            ttl = int(os.getenv("TURN_CREDENTIAL_TTL_SECONDS", "28800"))
        except ValueError as exc:
            raise LiveKitConfigError(
                "TURN_CREDENTIAL_TTL_SECONDS must be an integer number of seconds"
            ) from exc
        if ttl <= 0:
            raise LiveKitConfigError("TURN_CREDENTIAL_TTL_SECONDS must be positive")
        return cls(
            server_urls=urls,
            shared_secret=shared_secret,
            credential_ttl_seconds=ttl,
        )


_config: LiveKitConfig | None = None
_turn_config: TurnConfig | None = None
_turn_config_loaded = False


def get_livekit_config() -> LiveKitConfig:
    global _config
    if _config is None:
        _config = LiveKitConfig.from_env()
    return _config


def get_turn_config() -> TurnConfig | None:
    global _turn_config, _turn_config_loaded
    if not _turn_config_loaded:
        _turn_config = TurnConfig.from_env()
        _turn_config_loaded = True
    return _turn_config
