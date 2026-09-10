"""Opaque keyset cursors for list endpoints ordered by a timestamp."""

import base64
from datetime import datetime
from uuid import UUID

from uniffy.core.errors import ValidationError
from uniffy.core.json_codec import dumps_bytes, loads


def encode_time_cursor(moment: datetime, row_id: UUID) -> str:
    """Cursor for a page ordered by ``(moment, row_id)``.

    The row id breaks ties, so rows sharing a timestamp are neither repeated
    nor skipped across pages.
    """
    payload = dumps_bytes({"t": moment.isoformat(), "i": str(row_id)})
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def decode_time_cursor(token: str, field: str = "page_token") -> tuple[datetime, UUID]:
    """Read a cursor back, reporting a tampered or stale one against ``field``."""
    try:
        padding = "=" * (-len(token) % 4)
        payload = base64.urlsafe_b64decode((token + padding).encode("ascii"))
        data = loads(payload)
        return datetime.fromisoformat(data["t"]), UUID(data["i"])
    except (ValueError, KeyError, TypeError) as exc:
        raise ValidationError(field, "Malformed pagination cursor") from exc
