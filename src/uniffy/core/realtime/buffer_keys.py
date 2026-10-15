"""Data contract of the realtime update buffer: key layout, records, limits and results."""

import hashlib
from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum
from uuid import UUID

import pycrdt

from uniffy.core.realtime.limits import MAX_FRAME_BYTES
from uniffy.core.realtime.wire import MAX_WIRE_STRING_BYTES
from uniffy.core.types import ContentType

_MIB = 1024 * 1024

# Bucket count and key shape are a storage format. Changing either bumps the version so new keys
# never alias pending data written under the previous layout.
LAYOUT_VERSION = 1
BUCKET_COUNT = 16
RECORD_FORMAT = 1
MAX_PENDING_DOCUMENT_BYTES = 16 * _MIB
MAX_PENDING_DOCUMENT_RECORDS = 4096
DUE_DELAY_MS = 10_000

# ':' separates identity segments and braces delimit the hash tag.
_SEGMENT_RESERVED = frozenset(":{}")
_NAMESPACE_RESERVED = frozenset("{}*?[]\\")


def bucket_for(organization_id: UUID, content_type: ContentType, content_id: UUID) -> int:
    """Stable across processes and releases, unlike ``hash()``."""
    identity = f"{organization_id}:{content_type.value}:{content_id}".encode()
    return int.from_bytes(hashlib.sha256(identity).digest()[:8], "big") % BUCKET_COUNT


@dataclass(frozen=True, slots=True)
class BufferScope:
    """One document generation inside one buffer epoch; every per-document key names all of it."""

    organization_id: UUID
    content_type: ContentType
    content_id: UUID
    generation: str
    epoch: str

    def __post_init__(self) -> None:
        if not (
            isinstance(self.organization_id, UUID)
            and isinstance(self.content_type, ContentType)
            and isinstance(self.content_id, UUID)
            and isinstance(self.generation, str)
            and isinstance(self.epoch, str)
        ):
            raise ValueError("buffer scope needs UUID ids, a ContentType and string segments")
        if not self.epoch:
            raise ValueError("buffer epoch is empty")
        for segment in (self.generation, self.epoch):
            oversized = len(segment.encode()) > MAX_WIRE_STRING_BYTES
            if oversized or not _SEGMENT_RESERVED.isdisjoint(segment):
                raise ValueError(f"unusable buffer identity segment {segment!r}")

    @property
    def bucket(self) -> int:
        return bucket_for(self.organization_id, self.content_type, self.content_id)

    @property
    def member(self) -> str:
        """Due-index member and key suffix naming this scope; :func:`parse_member` reverses it."""
        return (
            f"{self.organization_id}:{self.content_type.value}:{self.content_id}:"
            f"{self.generation}:{self.epoch}"
        )


def parse_member(member: bytes | str) -> BufferScope:
    text = member.decode() if isinstance(member, bytes) else member
    parts = text.split(":")
    if len(parts) != 5:  # noqa: PLR2004 - organization, type, id, generation, epoch
        raise ValueError(f"malformed buffer member {text!r}")
    organization_id, content_type, content_id, generation, epoch = parts
    return BufferScope(
        UUID(organization_id), ContentType(content_type), UUID(content_id), generation, epoch
    )


@dataclass(frozen=True, slots=True)
class BufferKeys:
    stream: str
    control: str
    receipts: str
    due: str
    accounting: str


def validate_namespace(namespace: str) -> None:
    if not _NAMESPACE_RESERVED.isdisjoint(namespace):
        raise ValueError(f"buffer namespace {namespace!r} holds hash-tag or glob characters")


def bucket_prefix(bucket: int, namespace: str = "") -> str:
    if not 0 <= bucket < BUCKET_COUNT:
        raise ValueError(f"bucket {bucket} is outside 0..{BUCKET_COUNT - 1}")
    # The braces are the hash tag: one bucket's keys share a cluster slot, so every buffer
    # script stays single-slot.
    return f"{namespace}rtbuf:{{v{LAYOUT_VERSION}:{bucket:02d}}}"


def due_key(bucket: int, namespace: str = "") -> str:
    return f"{bucket_prefix(bucket, namespace)}:due"


def accounting_key(bucket: int, namespace: str = "") -> str:
    return f"{bucket_prefix(bucket, namespace)}:accounting"


def stream_pattern(bucket: int, namespace: str = "") -> str:
    return f"{bucket_prefix(bucket, namespace)}:stream:*"


def buffer_keys(scope: BufferScope, namespace: str = "") -> BufferKeys:
    prefix = bucket_prefix(scope.bucket, namespace)
    member = scope.member
    return BufferKeys(
        stream=f"{prefix}:stream:{member}",
        control=f"{prefix}:control:{member}",
        receipts=f"{prefix}:receipts:{member}",
        due=f"{prefix}:due",
        accounting=f"{prefix}:accounting",
    )


def scope_of_stream(key: bytes | str, bucket: int, namespace: str = "") -> BufferScope:
    text = key.decode() if isinstance(key, bytes) else key
    prefix = f"{bucket_prefix(bucket, namespace)}:stream:"
    if not text.startswith(prefix):
        raise ValueError(f"{text!r} is not a stream key of bucket {bucket}")
    return parse_member(text[len(prefix) :])


def validate_update(update_id: str, update: bytes) -> None:
    """Refuse what the admission script would refuse, before any Valkey round trip."""
    if not isinstance(update_id, str) or not isinstance(update, bytes):
        raise ValueError("update id must be str and update must be bytes")
    if not 0 < len(update_id.encode()) <= MAX_WIRE_STRING_BYTES:
        raise ValueError(f"update id must hold 1 to {MAX_WIRE_STRING_BYTES} UTF-8 bytes")
    if not 0 < len(update) <= MAX_FRAME_BYTES:
        raise ValueError(f"update must hold 1 to {MAX_FRAME_BYTES} bytes")


@dataclass(frozen=True, slots=True)
class Receipt:
    generation: str
    epoch: str
    seq: int
    update_id: str


@dataclass(frozen=True, slots=True)
class BufferHead:
    """One epoch's accepted head and PostgreSQL watermark, bound to the instance that issued it."""

    scope: BufferScope
    head_seq: int
    checkpoint_seq: int
    checkpoint_revision: int
    run_id: str


@dataclass(frozen=True, slots=True)
class BufferedUpdate:
    seq: int
    update_id: str
    update: bytes
    actor_id: UUID
    accepted_at_ms: int


def merge_tail(checkpoint: bytes, tail: Sequence[BufferedUpdate]) -> bytes:
    """Raw-update merge keeps delete sets and structs whose causal predecessors are missing."""
    if not tail:
        return checkpoint
    return pycrdt.merge_updates(checkpoint, *(record.update for record in tail))


@dataclass(frozen=True, slots=True)
class LatestState:
    head: BufferHead
    checkpoint: bytes
    tail: tuple[BufferedUpdate, ...]

    def merged(self) -> bytes:
        return merge_tail(self.checkpoint, self.tail)

    @property
    def size(self) -> int:
        return len(self.checkpoint) + sum(len(record.update) for record in self.tail)


class AdmissionStatus(StrEnum):
    ACCEPTED = "accepted"
    DUPLICATE = "duplicate"
    ID_CONFLICT = "id_conflict"
    DOCUMENT_LIMIT = "document_limit"
    BUDGET_EXHAUSTED = "budget_exhausted"
    TYPE_ERROR = "type_error"
    # The epoch is missing, stale or bound to another instance: run ensure_epoch, then retry.
    RECOVERY_REQUIRED = "recovery_required"


@dataclass(frozen=True, slots=True)
class AdmissionOutcome:
    status: AdmissionStatus
    receipt: Receipt | None = None


@dataclass(frozen=True, slots=True)
class PendingUsage:
    bytes: int
    records: int


@dataclass(frozen=True, slots=True)
class TrimResult:
    removed_bytes: int
    removed_records: int
    remaining_records: int


def parse_record(entry_id: bytes, fields: dict[bytes, bytes]) -> BufferedUpdate | None:
    try:
        seq, separator, suffix = entry_id.partition(b"-")
        if separator != b"-" or suffix != b"0" or fields[b"v"] != str(RECORD_FORMAT).encode():
            return None
        return BufferedUpdate(
            seq=int(seq),
            update_id=fields[b"i"].decode(),
            update=fields[b"u"],
            actor_id=UUID(fields[b"a"].decode()),
            accepted_at_ms=int(fields[b"t"]),
        )
    except KeyError, ValueError:
        return None
