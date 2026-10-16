"""Resident documents load from the checkpoint plus verified tail and realign with it later."""

import time
from uuid import UUID

import pycrdt
from loguru import logger

from uniffy.core.auth.permissions import role_can_view
from uniffy.core.realtime.adapter import get_realtime_adapter
from uniffy.core.realtime.admission import latest_under_lock, read_latest
from uniffy.core.realtime.buffer import BufferUnavailable, RecoveryRequired, UpdateBuffer
from uniffy.core.realtime.buffer_keys import LatestState
from uniffy.core.realtime.metrics import REALTIME_HYDRATION_DURATION
from uniffy.core.realtime.resident import follow
from uniffy.core.realtime.state import DocKey, YDocSession
from uniffy.core.realtime.storage import EditDenied, load_snapshot, lock_document, stage_seed
from uniffy.infrastructure.database.session import open_session

logger = logger.bind(component="core.realtime.hydration")

# Reading the buffer failed; the resident document stays as it is until the next refresh.
_UNVERIFIED = (BufferUnavailable, LookupError, RecoveryRequired, ValueError)


async def hydrate(
    buffer: UpdateBuffer, key: DocKey, organization_id: UUID, user_id: UUID
) -> YDocSession:
    """Resident document from the checkpoint plus its verified buffered tail.

    When the buffer cannot be read the checkpoint alone seeds it, without an epoch, and the
    next refresh realigns it.
    """
    content_type, content_id = key
    started = time.perf_counter()
    adapter = get_realtime_adapter(content_type)
    async with open_session() as db:
        await lock_document(db, key, organization_id)
        if not role_can_view(await adapter.authorize(db, user_id, organization_id, content_id)):
            raise EditDenied
        await stage_seed(db, key, organization_id)
        await db.commit()
        policy_key = await adapter.policy_key(db, content_id, organization_id)
        await lock_document(db, key, organization_id)
        state: LatestState | None = None
        try:
            state = await latest_under_lock(buffer, db, key, organization_id)
        except _UNVERIFIED:
            logger.opt(exception=True).warning(
                "Realtime buffer unreadable; resident document starts from its checkpoint"
            )
            await db.rollback()
        row = None if state is not None else await load_snapshot(db, key)
        await db.commit()
    if row is not None and row.organization_id not in (None, organization_id):
        raise EditDenied

    session = YDocSession(
        key=key, ydoc=pycrdt.Doc(), organization_id=organization_id, policy_key=policy_key
    )
    if state is not None:
        follow(session, state)
    elif row is not None:
        session.ydoc.apply_update(row.updates)
        session.generation = row.generation or ""
    REALTIME_HYDRATION_DURATION.labels(
        content_type=content_type.value, source="buffer" if state else "checkpoint"
    ).observe(time.perf_counter() - started)
    return session


async def realign(buffer: UpdateBuffer, session: YDocSession) -> list[bytes]:
    """Follow checkpoint plus tail; the frames tell attached clients what changed.

    The caller holds ``session.lock``. An unverifiable buffer keeps the resident document.
    """
    try:
        state = await read_latest(buffer, session.key, session.organization_id)
    except _UNVERIFIED as exc:
        logger.warning(f"Resident document kept; latest realtime state unverified: {exc!r}")
        return []
    return [] if state is None else follow(session, state)
