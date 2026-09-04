"""Status colours ride the brand axis by sort order, the same sweep the web avatars use."""

import re
from typing import Any

BRAND_AXIS_START = "#694aff"
BRAND_AXIS_END = "#fd7eea"
_RAMP_SPAN = 0.3
_HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


def _channels(hex_color: str) -> tuple[int, int, int]:
    return int(hex_color[1:3], 16), int(hex_color[3:5], 16), int(hex_color[5:7], 16)


def _mix(start: str, end: str, t: float) -> str:
    a = _channels(start)
    b = _channels(end)
    # Half-up rounding to match the web's Math.round, so both sides print the same hex.
    parts = (int(min(255.0, max(0.0, a[i] + (b[i] - a[i]) * t)) + 0.5) for i in range(3))
    return "#" + "".join(f"{p:02x}" for p in parts)


def brand_ramp_color(index: int, total: int) -> str:
    """Start of slot `index` of `total` on the axis: the first slot is violet, the last pink."""
    position = index / (total - 1) if total > 1 else 0.0
    t = min(1.0, max(0.0, position * (1 - _RAMP_SPAN)))
    return _mix(BRAND_AXIS_START, BRAND_AXIS_END, t)


def is_hex_color(value: object) -> bool:
    return isinstance(value, str) and bool(_HEX_RE.match(value))


def assign_status_colors(config: dict[str, Any]) -> dict[str, Any]:
    """Fill every status option that lacks a valid colour with its slot on the brand axis.

    A colour a user picked stays. An empty one means "assign me one", which is also how a
    client resets to brand. Slots follow sortOrder so the ramp reads left to right on a board.
    """
    options = config.get("options")
    if not isinstance(options, list):
        return config
    ordered = sorted(
        (option for option in options if isinstance(option, dict)),
        key=lambda option: (
            option.get("sortOrder") if isinstance(option.get("sortOrder"), (int, float)) else 0
        ),
    )
    total = len(ordered)
    for index, option in enumerate(ordered):
        if not is_hex_color(option.get("color")):
            option["color"] = brand_ramp_color(index, total)
    return config
