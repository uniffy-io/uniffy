"""The duration grammar every typed-time surface shares: 1.5h, 1h 30m, 45m or bare minutes."""

import math
import re

_HOURS_MINUTES = re.compile(r"^(\d+(?:\.\d+)?)\s*h(?:\s*(\d+)\s*m)?$")
_MINUTES = re.compile(r"^(\d+)\s*m$")
_BARE = re.compile(r"^(\d+(?:\.\d+)?)$")


def _half_up(value: float) -> int:
    """Round like the web input does; Python's round() would turn 0.5 into 0."""
    return math.floor(value + 0.5)


def parse_duration(text: str) -> int | None:
    """Minutes for a duration string, or None when the text is not one."""
    value = text.strip().lower()
    if not value:
        return None
    if match := _HOURS_MINUTES.match(value):
        return _half_up(float(match.group(1)) * 60 + int(match.group(2) or 0))
    if match := _MINUTES.match(value):
        return int(match.group(1))
    if match := _BARE.match(value):
        return _half_up(float(match.group(1)))
    return None


def format_minutes(minutes: int) -> str:
    if minutes <= 0:
        return "0m"
    if minutes < 60:
        return f"{minutes}m"
    hours, remaining = divmod(minutes, 60)
    return f"{hours}h {remaining}m" if remaining else f"{hours}h"
