"""y-protocols binary framing helpers; re-exports ``pycrdt._sync`` primitives."""

from pycrdt import (
    YMessageType,
    YSyncMessageType,
    create_awareness_message,
    create_sync_message,
    create_update_message,
    handle_sync_message,
)

from uniffy.core.realtime.multiplex import write_var_string, write_var_uint

__all__ = [
    "Y_MESSAGE_AUTH",
    "YMessageType",
    "YSyncMessageType",
    "create_auth_denied_message",
    "create_awareness_message",
    "create_sync_message",
    "create_update_message",
    "handle_sync_message",
    "is_sync_write_frame",
    "peek_message_type",
    "peek_sync_sub_type",
]

# y-protocols/auth: pycrdt only models SYNC and AWARENESS.
Y_MESSAGE_AUTH = 2
_AUTH_PERMISSION_DENIED = 0


def create_auth_denied_message(reason: str) -> bytes:
    """Tell one client its doc is read-only so it stops emitting write frames."""
    return (
        write_var_uint(Y_MESSAGE_AUTH) + write_var_uint(_AUTH_PERMISSION_DENIED)
    ) + write_var_string(reason)


def peek_message_type(frame: bytes) -> int | None:
    """y-protocols message type byte, ``None`` for empty frames."""
    if not frame:
        return None
    return frame[0]


def peek_sync_sub_type(frame: bytes) -> int | None:
    """SYNC sub-type byte (step1 / step2 / update), ``None`` if not a SYNC frame."""
    if len(frame) < 2 or frame[0] != YMessageType.SYNC:
        return None
    return frame[1]


def is_sync_write_frame(frame: bytes) -> bool:
    """True iff the SYNC frame mutates server state (SYNC_STEP2 or SYNC_UPDATE).

    SYNC_STEP1 is a pure read (state-vector handshake) and is allowed for VIEWERs.
    """
    sub = peek_sync_sub_type(frame)
    return sub in (YSyncMessageType.SYNC_STEP2, YSyncMessageType.SYNC_UPDATE)
