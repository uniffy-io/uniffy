"""Domain-agnostic realtime collaboration primitives."""

from uniffy.core.realtime.adapter import (
    RealtimeContentAdapter,
    get_realtime_adapter,
    register_realtime_adapter,
)
from uniffy.core.realtime.ws_routes import router as realtime_router

__all__ = [
    "RealtimeContentAdapter",
    "get_realtime_adapter",
    "realtime_router",
    "register_realtime_adapter",
]
