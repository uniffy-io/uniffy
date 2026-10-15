"""y-protocols binary framing helpers; re-exports ``pycrdt._sync`` primitives."""

from dataclasses import dataclass

from pycrdt import (
    YMessageType,
    YSyncMessageType,
    create_awareness_message,
    create_sync_message,
    create_update_message,
    handle_sync_message,
)

from uniffy.core.realtime.multiplex import (
    read_var_string,
    read_var_uint,
    write_var_string,
    write_var_uint,
)

__all__ = [
    "MAX_WIRE_INTEGER",
    "MAX_WIRE_STRING_BYTES",
    "MESSAGE_ACCEPTED_RECEIPT",
    "MESSAGE_CHECKPOINT_PROGRESS",
    "MESSAGE_FRAGMENT_SEEDER",
    "MESSAGE_SESSION_STATE",
    "Y_MESSAGE_AUTH",
    "AcceptedReceipt",
    "CheckpointProgress",
    "SessionState",
    "YMessageType",
    "YSyncMessageType",
    "create_accepted_receipt_message",
    "create_auth_denied_message",
    "create_awareness_message",
    "create_checkpoint_progress_message",
    "create_fragment_seeder_message",
    "create_session_state_message",
    "create_sync_message",
    "create_update_message",
    "handle_sync_message",
    "is_sync_write_frame",
    "parse_accepted_receipt_message",
    "parse_ack_message",
    "parse_checkpoint_progress_message",
    "parse_generation_message",
    "parse_session_state_message",
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
MESSAGE_SEED_UPDATE = 8
MESSAGE_SEED_REJECTED = 9
MESSAGE_SEED_CAPABILITY = 10
MESSAGE_ACCEPTED_RECEIPT = 11
MESSAGE_CHECKPOINT_PROGRESS = 12
MESSAGE_SESSION_STATE = 13

MAX_WIRE_STRING_BYTES = 128
# Largest integer web and mobile clients represent exactly as a JavaScript number.
MAX_WIRE_INTEGER = 2**53 - 1


@dataclass(frozen=True, slots=True)
class AcceptedReceipt:
    """Buffer holds the client's update; only checkpoint progress proves PostgreSQL does."""

    update_id: str
    generation: str
    epoch: str
    accepted_sequence: int


@dataclass(frozen=True, slots=True)
class CheckpointProgress:
    """PostgreSQL committed every accepted update of this epoch up to ``covered_sequence``."""

    generation: str
    epoch: str
    covered_sequence: int
    checkpoint_revision: int


@dataclass(frozen=True, slots=True)
class SessionState:
    """Buffer head and checkpoint watermark a client reconciles its receipts against."""

    generation: str
    epoch: str
    head_sequence: int
    checkpoint_sequence: int
    checkpoint_revision: int


def _string(value: str) -> bytes:
    if len(value.encode()) > MAX_WIRE_STRING_BYTES:
        raise ValueError(f"wire string exceeds {MAX_WIRE_STRING_BYTES} bytes")
    return write_var_string(value)


def _integer(value: int) -> bytes:
    if not 0 <= value <= MAX_WIRE_INTEGER:
        raise ValueError(f"wire integer {value} outside 0..{MAX_WIRE_INTEGER}")
    return write_var_uint(value)


def _check_accepted_sequence(sequence: int) -> None:
    # Zero means "nothing covered" in progress and session state, so no update can hold it.
    if sequence < 1:
        raise ValueError("accepted sequence starts at 1")


def _check_watermark(head_sequence: int, checkpoint_sequence: int) -> None:
    if checkpoint_sequence > head_sequence:
        raise ValueError("checkpoint sequence is ahead of buffer head")


class _FrameReader:
    """Reads one message body; a wrong type, truncation or trailing bytes raise ``ValueError``."""

    def __init__(self, frame: bytes, message_type: int) -> None:
        kind, self._offset = read_var_uint(frame)
        if kind != message_type:
            raise ValueError(f"expected message type {message_type}, got {kind}")
        self._frame = frame

    def string(self) -> str:
        value, self._offset = read_var_string(
            self._frame, self._offset, max_bytes=MAX_WIRE_STRING_BYTES
        )
        return value

    def integer(self) -> int:
        value, self._offset = read_var_uint(self._frame, self._offset)
        if value > MAX_WIRE_INTEGER:
            raise ValueError(f"wire integer {value} exceeds {MAX_WIRE_INTEGER}")
        return value

    def end(self) -> None:
        if self._offset != len(self._frame):
            raise ValueError("trailing bytes after message")


def create_generation_message(generation: str) -> bytes:
    return write_var_uint(MESSAGE_GENERATION) + write_var_string(generation)


def parse_generation_message(frame: bytes) -> str:
    reader = _FrameReader(frame, MESSAGE_GENERATION)
    generation = reader.string()
    reader.end()
    return generation


def create_ack_message(update_id: str) -> bytes:
    """Committed acknowledgment: PostgreSQL holds the update, never a buffer-only append."""
    return write_var_uint(MESSAGE_ACK) + write_var_string(update_id)


def parse_ack_message(frame: bytes) -> str:
    reader = _FrameReader(frame, MESSAGE_ACK)
    update_id = reader.string()
    reader.end()
    return update_id


def create_accepted_receipt_message(
    *, update_id: str, generation: str, epoch: str, accepted_sequence: int
) -> bytes:
    _check_accepted_sequence(accepted_sequence)
    return (
        write_var_uint(MESSAGE_ACCEPTED_RECEIPT)
        + _string(update_id)
        + _string(generation)
        + _string(epoch)
        + _integer(accepted_sequence)
    )


def parse_accepted_receipt_message(frame: bytes) -> AcceptedReceipt:
    reader = _FrameReader(frame, MESSAGE_ACCEPTED_RECEIPT)
    receipt = AcceptedReceipt(reader.string(), reader.string(), reader.string(), reader.integer())
    reader.end()
    _check_accepted_sequence(receipt.accepted_sequence)
    return receipt


def create_checkpoint_progress_message(
    *, generation: str, epoch: str, covered_sequence: int, checkpoint_revision: int
) -> bytes:
    return (
        write_var_uint(MESSAGE_CHECKPOINT_PROGRESS)
        + _string(generation)
        + _string(epoch)
        + _integer(covered_sequence)
        + _integer(checkpoint_revision)
    )


def parse_checkpoint_progress_message(frame: bytes) -> CheckpointProgress:
    reader = _FrameReader(frame, MESSAGE_CHECKPOINT_PROGRESS)
    progress = CheckpointProgress(
        reader.string(), reader.string(), reader.integer(), reader.integer()
    )
    reader.end()
    return progress


def create_session_state_message(
    *,
    generation: str,
    epoch: str,
    head_sequence: int,
    checkpoint_sequence: int,
    checkpoint_revision: int,
) -> bytes:
    _check_watermark(head_sequence, checkpoint_sequence)
    return (
        write_var_uint(MESSAGE_SESSION_STATE)
        + _string(generation)
        + _string(epoch)
        + _integer(head_sequence)
        + _integer(checkpoint_sequence)
        + _integer(checkpoint_revision)
    )


def parse_session_state_message(frame: bytes) -> SessionState:
    reader = _FrameReader(frame, MESSAGE_SESSION_STATE)
    state = SessionState(
        reader.string(), reader.string(), reader.integer(), reader.integer(), reader.integer()
    )
    reader.end()
    _check_watermark(state.head_sequence, state.checkpoint_sequence)
    return state


def create_fragment_seeder_message(granted: bool, token: str = "") -> bytes:
    frame = write_var_uint(MESSAGE_FRAGMENT_SEEDER) + write_var_uint(int(granted))
    return frame + write_var_string(token) if token else frame


def create_seed_rejected_message(update_id: str) -> bytes:
    return write_var_uint(MESSAGE_SEED_REJECTED) + write_var_string(update_id)


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
