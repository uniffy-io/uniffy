import base64
import binascii
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from uniffy.core.errors import ValidationError
from uniffy.core.json_codec import dumps_bytes, loads


@dataclass(frozen=True, slots=True)
class BookmarkCursor:
    created_at: datetime
    bookmark_id: UUID


def encode_bookmark_cursor(cursor: BookmarkCursor) -> str:
    payload = dumps_bytes({
        "t": cursor.created_at.isoformat(),
        "i": str(cursor.bookmark_id),
    })
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def decode_bookmark_cursor(token: str) -> BookmarkCursor:
    try:
        padding = "=" * (-len(token) % 4)
        payload = base64.urlsafe_b64decode((token + padding).encode("ascii"))
        data = loads(payload)
        created_at = datetime.fromisoformat(data["t"])
        if created_at.tzinfo is None:
            raise ValueError
        return BookmarkCursor(
            created_at=created_at,
            bookmark_id=UUID(data["i"]),
        )
    except (binascii.Error, ValueError, KeyError, TypeError) as exc:
        raise ValidationError("page_token", "Malformed pagination cursor") from exc
