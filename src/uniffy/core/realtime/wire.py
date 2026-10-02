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
    "MESSAGE_FRAGMENT_SEEDER",
    "YMessageType",
    "YSyncMessageType",
    "create_auth_denied_message",
    "create_fragment_seeder_message",
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
MESSAGE_FRAGMENT_SEEDER = 4
MESSAGE_GENERATION = 5
MESSAGE_DURABLE_UPDATE = 6
MESSAGE_ACK = 7


def create_generation_message(generation: str) -> bytes:
    return write_var_uint(MESSAGE_GENERATION) + write_var_string(generation)


def create_ack_message(update_id: str) -> bytes:
    return write_var_uint(MESSAGE_ACK) + write_var_string(update_id)


def create_fragment_seeder_message(granted: bool) -> bytes:
    return write_var_uint(MESSAGE_FRAGMENT_SEEDER) + write_var_uint(int(granted))


def create_auth_denied_message(reason: str, *, no_view: bool = False) -> bytes:
    """Tell one client its doc is read-only so it stops emitting write frames."""
    return (
        write_var_uint(Y_MESSAGE_AUTH) + write_var_uint(1 if no_view else _AUTH_PERMISSION_DENIED)
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
