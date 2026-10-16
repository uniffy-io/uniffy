"""Read and admit live document state for resident sessions.

Admission takes fresh PostgreSQL checks under the document lock, validates against the resident
document and applies an update to it only once the buffer accepted it.
"""

import contextlib
from collections.abc import AsyncIterator, Callable, Sequence
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions import role_can_edit
from uniffy.core.realtime.adapter import get_realtime_adapter
from uniffy.core.realtime.buffer import (
    AdmissionUnknown,
    BufferUnavailable,
    RecoveryReason,
    RecoveryRequired,
    UpdateBuffer,
)
from uniffy.core.realtime.buffer_keys import (
    AdmissionStatus,
    BufferHead,
    LatestState,
    LatestTail,
    Receipt,
)
from uniffy.core.realtime.checkpoint import stage_recovered
from uniffy.core.realtime.epoch import ensure_epoch
from uniffy.core.realtime.resident import (
    accept_update,
    check_update,
    follow,
    follow_tail,
    held_state,
    release_update,
)
from uniffy.core.realtime.state import DocKey, YDocSession
from uniffy.core.realtime.storage import EditDenied, lock_document, stage_seed
from uniffy.core.types import ContentRole
from uniffy.infrastructure.database.session import open_session

_SETTLE_ATTEMPTS = 3

type Broadcast = Callable[[YDocSession, Sequence[bytes]], None]


class UpdateConflict(Exception):
    """The update id already names different bytes in this epoch."""


class RoleRefused(EditDenied):
    """The writer's fresh role refused the update; attached handles should adopt that role."""

    def __init__(self, role: ContentRole | None) -> None:
        super().__init__(role)
        self.role = role


class SavingUnavailable(Exception):
    """Retryable: the buffer cannot take or verify the update now, so the client keeps it."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True, slots=True)
class Admitted:
    # ``None`` when the update adds nothing and the PostgreSQL checkpoint holds the whole document.
    receipt: Receipt | None
    # False for a duplicate or an update the resident document already holds.
    applied: bool
    # The writer's role, read fresh under the document lock.
    role: ContentRole


_REFUSALS = {
    AdmissionStatus.DOCUMENT_LIMIT: "document_limit",
    AdmissionStatus.BUDGET_EXHAUSTED: "budget_exhausted",
    AdmissionStatus.ORGANIZATION_LIMIT: "organization_limit",
    AdmissionStatus.RECOVERY_REQUIRED: "recovery_required",
}


@contextlib.asynccontextmanager
async def _unverified() -> AsyncIterator[None]:
    try:
        yield
    except AdmissionUnknown as exc:
        raise SavingUnavailable("admission_unknown") from exc
    except BufferUnavailable as exc:
        raise SavingUnavailable("buffer_unavailable") from exc
    except (RecoveryRequired, LookupError, ValueError) as exc:
        # An unsettled or unreadable epoch, or a surviving record that cannot be merged.
        raise SavingUnavailable("recovery_required") from exc


async def latest_under_lock(
    buffer: UpdateBuffer,
    db: AsyncSession,
    key: DocKey,
    organization_id: UUID,
    *,
    reset: RecoveryReason | None = None,
) -> LatestState:
    """Checkpoint plus verified tail on a usable epoch, under the caller's document lock.

    Moving to a fresh epoch commits the caller's transaction and takes the lock again. A gap
    or ``reset`` forces the move even when the epoch's control record looks healthy.
    """
    for _ in range(_SETTLE_ATTEMPTS):
        await ensure_epoch(
            buffer, db, key, organization_id, stage_recovered=stage_recovered, reset=reset
        )
        try:
            state = await buffer.load_latest(db, key)
        except RecoveryRequired as exc:
            if exc.reason is RecoveryReason.MALFORMED:
                raise
            reset = exc.reason if exc.reason is RecoveryReason.GAP else None
            continue
        if state is None:
            raise LookupError(f"{key[0].value}:{key[1]} has no realtime checkpoint")
        return state
    raise BufferUnavailable("realtime buffer epoch did not settle")


async def read_latest(
    buffer: UpdateBuffer, key: DocKey, organization_id: UUID
) -> LatestState | None:
    """Latest state without the document lock; settling a broken epoch takes it."""
    async with open_session() as db:
        try:
            return await buffer.load_latest(db, key)
        except RecoveryRequired as exc:
            if exc.reason is RecoveryReason.MALFORMED:
                raise
            reset = RecoveryReason.GAP if exc.reason is RecoveryReason.GAP else None
            await db.rollback()
            await lock_document(db, key, organization_id)
            state = await latest_under_lock(buffer, db, key, organization_id, reset=reset)
            await db.commit()
            return state


async def _require_edit(db: AsyncSession, session: YDocSession, actor_id: UUID) -> ContentRole:
    role = await get_realtime_adapter(session.key[0]).authorize(
        db, actor_id, session.organization_id, session.key[1]
    )
    if role is None or not role_can_edit(role):
        raise RoleRefused(role)
    return role


async def _latest(
    buffer: UpdateBuffer, db: AsyncSession, session: YDocSession
) -> tuple[LatestState | LatestTail, bool]:
    """The latest state, and whether reaching it may have committed an epoch move.

    While the row still names the checkpoint the resident document follows, only the records
    past its head are read; the process cache and PostgreSQL serve every other case.
    """
    key, organization_id = session.key, session.organization_id
    held = held_state(session)
    if held is not None:
        with contextlib.suppress(RecoveryRequired):
            tail = await buffer.read_since(db, key, held)
            if tail is not None:
                return tail, False
    try:
        state = await buffer.load_latest(db, key)
    except RecoveryRequired as exc:
        if exc.reason is RecoveryReason.MALFORMED:
            raise
        gap = exc.reason is RecoveryReason.GAP
        reset = RecoveryReason.GAP if gap else None
        return await latest_under_lock(buffer, db, key, organization_id, reset=reset), True
    if state is None:
        # A vanished row is seeded again under a fresh generation the client must adopt.
        await stage_seed(db, key, organization_id)
        return await latest_under_lock(buffer, db, key, organization_id), True
    return state, False


async def _reset_after_refusal(
    buffer: UpdateBuffer, db: AsyncSession, session: YDocSession, refused: BufferHead
) -> LatestState:
    key, organization_id = session.key, session.organization_id
    state = await latest_under_lock(buffer, db, key, organization_id)
    if state.head.scope == refused.scope:
        # The probe found the epoch healthy although it refused the append.
        state = await latest_under_lock(
            buffer, db, key, organization_id, reset=RecoveryReason.STALE_TAIL
        )
    return state


def _already_held(head: BufferHead, update_id: str, role: ContentRole) -> Admitted:
    """The resident document equals checkpoint plus tail, so ``head`` already covers the update."""
    if head.head_seq == head.checkpoint_seq:
        # A receipt names a sequence above zero; the checkpoint alone answers as committed.
        return Admitted(None, applied=False, role=role)
    scope = head.scope
    receipt = Receipt(scope.generation, scope.epoch, head.head_seq, update_id)
    return Admitted(receipt, applied=False, role=role)


async def admit_update(
    buffer: UpdateBuffer,
    session: YDocSession,
    actor_id: UUID,
    generation: str,
    update_id: str,
    update: bytes,
    broadcast: Broadcast,
) -> Admitted:
    """Append one update and apply it to the resident document once acceptance is confirmed.

    The caller holds ``session.lock``. Frames that realign the resident document, including a
    fresh session state after an epoch reset, reach every attached client before any receipt
    of the new epoch. An update that adds nothing, such as a sync reply carrying only known
    deletions, appends no record. Raises ``ValueError`` for undecodable bytes and
    :class:`RoleRefused` with the fresh role when the writer may not edit.
    """
    try:
        return await _admit(buffer, session, actor_id, generation, update_id, update, broadcast)
    finally:
        release_update(session)


async def _admit(
    buffer: UpdateBuffer,
    session: YDocSession,
    actor_id: UUID,
    generation: str,
    update_id: str,
    update: bytes,
    broadcast: Broadcast,
) -> Admitted:
    async with open_session() as db:
        await lock_document(db, session.key, session.organization_id)
        role = await _require_edit(db, session, actor_id)
        async with _unverified():
            state, settled = await _latest(buffer, db, session)
        for attempt in range(2):
            if attempt:
                async with _unverified():
                    state = await _reset_after_refusal(buffer, db, session, state.head)
            if attempt or settled:
                # Settling an epoch committed under the lock; check access again after it.
                role = await _require_edit(db, session, actor_id)
            broadcast(
                session,
                follow_tail(session, state)
                if isinstance(state, LatestTail)
                else follow(session, state),
            )
            if not check_update(session, generation, update):
                await db.commit()
                return _already_held(state.head, update_id, role)
            async with _unverified():
                outcome = await buffer.admit(
                    state.head, update_id=update_id, update=update, actor_id=actor_id
                )
            if outcome.status is not AdmissionStatus.RECOVERY_REQUIRED:
                break
        await db.commit()
    status, receipt = outcome.status, outcome.receipt
    if status is AdmissionStatus.ID_CONFLICT:
        raise UpdateConflict
    if status is AdmissionStatus.TYPE_ERROR:
        raise ValueError("update refused by the buffer")
    if receipt is None:
        raise SavingUnavailable(_REFUSALS.get(status, "recovery_required"))
    applied = status is AdmissionStatus.ACCEPTED
    if applied:
        accept_update(session, update, receipt.seq)
    return Admitted(receipt, applied, role)
