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


_config: LiveKitConfig | None = None


def get_livekit_config() -> LiveKitConfig:
    global _config
    if _config is None:
        _config = LiveKitConfig.from_env()
    return _config
