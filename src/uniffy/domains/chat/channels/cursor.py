"""Opaque pagination cursors for channel lists."""

import base64
from typing import Any

from uniffy.core.errors import ValidationError
from uniffy.core.json_codec import dumps_bytes, loads
from uniffy.domains.chat.channels.limits import DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE


def encode_cursor(payload: dict[str, Any]) -> str:
    raw = dumps_bytes(payload)
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def decode_cursor(cursor: str) -> dict[str, Any]:
    try:
        padding = "=" * (-len(cursor) % 4)
        raw = base64.urlsafe_b64decode(cursor + padding)
        return loads(raw)
    except ValueError as exc:
        raise ValidationError("cursor", "Invalid pagination cursor") from exc


def clamp_page_size(limit: int | None) -> int:
    if limit is None or limit <= 0:
        return DEFAULT_PAGE_SIZE
    return min(limit, MAX_PAGE_SIZE)
