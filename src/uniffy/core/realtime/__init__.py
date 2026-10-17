"""Domain-agnostic realtime collaboration primitives."""

from uniffy.core.realtime.adapter import (
    RealtimeContentAdapter,
    get_realtime_adapter,
    register_realtime_adapter,
)
from uniffy.core.realtime.ws_routes import create_realtime_router

__all__ = [
    "RealtimeContentAdapter",
    "create_realtime_router",
    "get_realtime_adapter",
    "register_realtime_adapter",
]
