"""Event bus for notification dispatch."""

from uniffy.core.events.bus import emit_notification, event_from_json
from uniffy.core.events.mentions import (
    extract_mentioned_team_ids,
    extract_mentioned_user_ids,
)
from uniffy.core.events.types import NotificationEvent

__all__ = [
    "NotificationEvent",
    "emit_notification",
    "event_from_json",
    "extract_mentioned_team_ids",
    "extract_mentioned_user_ids",
]
