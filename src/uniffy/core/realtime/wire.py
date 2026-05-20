"""y-protocols binary framing helpers.

Re-exports ``pycrdt._sync`` primitives so the rest of ``core/realtime``
does not depend on a private module path, plus two predicates used by
the session loop (:func:`peek_message_type`, :func:`is_sync_write_frame`).
"""

from pycrdt import (
    YMessageType,
    YSyncMessageType,
    create_awareness_message,
    create_sync_message,
    create_update_message,
    handle_sync_message,
)

__all__ = [
    "YMessageType",
    "YSyncMessageType",
    "create_awareness_message",
    "create_sync_message",
    "create_update_message",
    "handle_sync_message",
    "is_sync_write_frame",
    "peek_message_type",
    "peek_sync_sub_type",
]


def peek_message_type(frame: bytes) -> int | None:
    """Return the y-protocols message type byte, or ``None`` for empty frames."""
    if not frame:
        return None
    return frame[0]


def peek_sync_sub_type(frame: bytes) -> int | None:
    """Return the SYNC sub-type byte (step1 / step2 / update), or ``None``."""
    if len(frame) < 2 or frame[0] != YMessageType.SYNC:
        return None
    return frame[1]


def is_sync_write_frame(frame: bytes) -> bool:
    """Return True iff the SYNC frame mutates server state.

    SYNC_STEP1 is a pure read (state-vector handshake) and is allowed
    for VIEWERs. SYNC_STEP2 and SYNC_UPDATE both write into the YDoc.
    """
    sub = peek_sync_sub_type(frame)
    return sub in (YSyncMessageType.SYNC_STEP2, YSyncMessageType.SYNC_UPDATE)
