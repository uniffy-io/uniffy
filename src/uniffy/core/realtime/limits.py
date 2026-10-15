import os

from uniffy.core.errors import ValidationError

MAX_DOCUMENT_BYTES = int(os.getenv("REALTIME_MAX_DOCUMENT_BYTES", "524288"))
MAX_SNAPSHOT_BYTES = int(os.getenv("REALTIME_MAX_SNAPSHOT_BYTES", "8388608"))
MAX_DOCS_PER_SOCKET = int(os.getenv("REALTIME_MAX_DOCS_PER_SOCKET", "32"))
MAX_SOCKETS_PER_USER = int(os.getenv("REALTIME_MAX_SOCKETS_PER_USER", "16"))
MAX_MESSAGES_PER_SECOND = int(os.getenv("REALTIME_MAX_MESSAGES_PER_SECOND", "120"))
MAX_AWARENESS_BYTES = 64 * 1024


def validate_document_size(text: str) -> None:
    if len(text.encode()) > MAX_DOCUMENT_BYTES:
        raise ValidationError("content", f"Content exceeds {MAX_DOCUMENT_BYTES} UTF-8 bytes")
