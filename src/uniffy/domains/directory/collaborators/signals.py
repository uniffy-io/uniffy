"""Collaborator signals: what counts as working with someone, and how its weight fades."""

import math
from collections import defaultdict
from collections.abc import Iterable
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Any
from uuid import UUID

from sqlalchemy import ColumnElement, func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.people.collaborator_score import CollaboratorScore
from uniffy.domains.directory.membership import filter_active_members

HALF_LIFE = timedelta(days=14)
# Past this, a colleague leaves the ranked tier entirely instead of lingering at a tiny score.
WINDOW = timedelta(days=90)
TEAM_BOOST = 1.0
MAX_ROWS_PER_VIEWER = 300
# Six bind parameters a row keeps each upsert well under PostgreSQL's 32,767 limit.
_UPSERT_CHUNK = 1_000

LN2 = math.log(2)
_TABLE = CollaboratorScore.__table__


class CollaboratorSignal(StrEnum):
    DIRECT_MESSAGE = "direct_message"
    ASSIGNMENT = "assignment"
    CO_ASSIGNMENT = "co_assignment"
    MENTION = "mention"
    REPLY = "reply"
    SHARE = "share"
    INVITE = "invite"
    PICK = "pick"
    CO_ACTIVITY = "co_activity"


SIGNAL_WEIGHTS: dict[CollaboratorSignal, float] = {
    CollaboratorSignal.DIRECT_MESSAGE: 3.0,
    CollaboratorSignal.ASSIGNMENT: 4.0,
    CollaboratorSignal.CO_ASSIGNMENT: 2.0,
    CollaboratorSignal.MENTION: 3.0,
    CollaboratorSignal.REPLY: 2.0,
    CollaboratorSignal.SHARE: 3.0,
    CollaboratorSignal.INVITE: 2.0,
    CollaboratorSignal.PICK: 2.0,
    CollaboratorSignal.CO_ACTIVITY: 1.0,
}

Interaction = tuple[UUID, UUID, CollaboratorSignal]


def decay_factor(elapsed: timedelta) -> float:
    return math.exp(-LN2 * max(elapsed.total_seconds(), 0.0) / HALF_LIFE.total_seconds())


def decayed_score(now: datetime) -> ColumnElement[float]:
    """The stored score faded to `now`, as a SQL expression over the scores table."""
    elapsed = func.extract("epoch", now - _TABLE.c.scored_at)
    return _TABLE.c.score * func.exp(-LN2 * func.greatest(elapsed, 0) / HALF_LIFE.total_seconds())


async def stage_interactions(
    session: AsyncSession,
    organization_id: UUID,
    interactions: Iterable[Interaction],
    *,
    at: datetime | None = None,
) -> int:
    """Add each (user, peer) interaction to the user's score for that peer; never commits."""
    weights: dict[tuple[UUID, UUID], float] = defaultdict(float)
    for user_id, peer_id, signal in interactions:
        if user_id != peer_id:
            weights[(user_id, peer_id)] += SIGNAL_WEIGHTS[signal]
    if not weights:
        return 0

    # A stray id from another organization or a deactivated account never plants a score.
    active = await filter_active_members(
        session, organization_id, {uid for pair in weights for uid in pair}
    )
    now = at or datetime.now(UTC)
    rows: list[dict[str, Any]] = [
        {
            "organization_id": organization_id,
            "user_id": user_id,
            "peer_id": peer_id,
            "score": weight,
            "scored_at": now,
            "last_interaction_at": now,
        }
        # Sorted so concurrent batches lock rows in the same order.
        for (user_id, peer_id), weight in sorted(weights.items())
        if user_id in active and peer_id in active
    ]
    if not rows:
        return 0

    for start in range(0, len(rows), _UPSERT_CHUNK):
        stmt = pg_insert(CollaboratorScore).values(rows[start : start + _UPSERT_CHUNK])
        elapsed = func.extract("epoch", stmt.excluded.scored_at - _TABLE.c.scored_at)
        carried = _TABLE.c.score * func.exp(
            -LN2 * func.greatest(elapsed, 0) / HALF_LIFE.total_seconds()
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=[_TABLE.c.organization_id, _TABLE.c.user_id, _TABLE.c.peer_id],
            set_={
                "score": stmt.excluded.score + carried,
                "scored_at": func.greatest(_TABLE.c.scored_at, stmt.excluded.scored_at),
                "last_interaction_at": func.greatest(
                    _TABLE.c.last_interaction_at, stmt.excluded.last_interaction_at
                ),
            },
        )
        await session.execute(stmt)
    return len(rows)
