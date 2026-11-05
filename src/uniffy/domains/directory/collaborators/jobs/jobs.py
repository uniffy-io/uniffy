"""Nightly collaborator upkeep: credit shared work that sends no notification, then prune."""

from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import CTE, Select, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.calls.call import CallParticipant
from uniffy.core.models.projects.activity import TaskActivity
from uniffy.core.models.projects.task import Task
from uniffy.domains.directory.collaborators.signals import (
    HALF_LIFE,
    LN2,
    MAX_ROWS_PER_VIEWER,
    WINDOW,
    CollaboratorSignal,
    Interaction,
    stage_interactions,
)
from uniffy.infrastructure.database import open_session

logger = logger.bind(component="directory.collaborators.jobs")

LOOKBACK = timedelta(days=1)
# Work touched by more people than this is a shared space, not a working relationship.
MAX_PARTICIPANTS = 8


def _pairs(people: CTE, group_column: str, person_column: str) -> Select[tuple[UUID, UUID, UUID]]:
    """Every ordered pair of distinct people within each small group of `people`."""
    group = people.c[group_column]
    small = (
        select(group)
        .group_by(group)
        .having(func.count().between(2, MAX_PARTICIPANTS))
        .scalar_subquery()
    )
    x, y = people.alias("x"), people.alias("y")
    return (
        select(x.c.organization_id, x.c[person_column], y.c[person_column])
        .join(
            y,
            (y.c[group_column] == x.c[group_column]) & (y.c[person_column] != x.c[person_column]),
        )
        .where(x.c[group_column].in_(small))
    )


def _task_pairs(since: datetime) -> Select[tuple[UUID, UUID, UUID]]:
    # Humans who changed the same task in the window; agent changes credit no one.
    actors = (
        select(Task.organization_id, TaskActivity.task_id, TaskActivity.actor_id)
        .distinct()
        .join(Task, Task.id == TaskActivity.task_id)
        .where(
            TaskActivity.timestamp >= since,
            TaskActivity.agent_id.is_(None),
            Task.is_deleted.is_(False),
        )
        .cte("actors")
    )
    return _pairs(actors, "task_id", "actor_id")


def _call_pairs(since: datetime) -> Select[tuple[UUID, UUID, UUID]]:
    people = (
        select(CallParticipant.organization_id, CallParticipant.call_id, CallParticipant.user_id)
        .distinct()
        .where(CallParticipant.joined_at >= since)
        .cte("people")
    )
    return _pairs(people, "call_id", "user_id")


_PRUNE_EXPIRED = text("DELETE FROM people_collaborator_scores WHERE last_interaction_at < :cutoff")

# Only viewers over the cap are ranked, so the nightly sort stays proportional to the overflow.
_PRUNE_OVERFLOW = text(
    """
    WITH crowded AS (
        SELECT organization_id, user_id
        FROM people_collaborator_scores
        GROUP BY organization_id, user_id
        HAVING count(*) > CAST(:keep AS integer)
    ),
    ranked AS (
        SELECT s.organization_id, s.user_id, s.peer_id,
               row_number() OVER (
                   PARTITION BY s.organization_id, s.user_id
                   ORDER BY s.score * exp(
                       -CAST(:ln2 AS double precision)
                       * greatest(extract(epoch FROM (CAST(:now AS timestamptz) - s.scored_at)), 0)
                       / CAST(:half_life AS double precision)
                   ) DESC
               ) AS rank
        FROM people_collaborator_scores s
        JOIN crowded c USING (organization_id, user_id)
    )
    DELETE FROM people_collaborator_scores s
    USING ranked
    WHERE ranked.rank > CAST(:keep AS integer)
      AND s.organization_id = ranked.organization_id
      AND s.user_id = ranked.user_id
      AND s.peer_id = ranked.peer_id
    """
)


async def _shared_work(session: AsyncSession, since: datetime) -> dict[UUID, list[Interaction]]:
    by_org: dict[UUID, list[Interaction]] = defaultdict(list)
    for statement in (_task_pairs(since), _call_pairs(since)):
        result = await session.execute(statement)
        for organization_id, user_id, peer_id in result.all():
            by_org[organization_id].append((user_id, peer_id, CollaboratorSignal.CO_ACTIVITY))
    return by_org


async def _credit_shared_work(session: AsyncSession, now: datetime) -> int:
    credited = 0
    try:
        by_org = await _shared_work(session, now - LOOKBACK)
    except Exception:
        await session.rollback()
        logger.opt(exception=True).warning("Failed to read shared work")
        return 0
    for organization_id, pairs in by_org.items():
        try:
            credited += await stage_interactions(session, organization_id, pairs, at=now)
            await session.commit()
        except Exception:
            await session.rollback()
            logger.opt(exception=True).warning(
                "Failed to credit shared work", organization_id=str(organization_id)
            )
    return credited


async def _prune(session: AsyncSession, now: datetime) -> int:
    try:
        expired = await session.execute(_PRUNE_EXPIRED, {"cutoff": now - WINDOW})
        overflow = await session.execute(
            _PRUNE_OVERFLOW,
            {
                "ln2": LN2,
                "now": now,
                "half_life": HALF_LIFE.total_seconds(),
                "keep": MAX_ROWS_PER_VIEWER,
            },
        )
        await session.commit()
    except Exception:
        await session.rollback()
        logger.opt(exception=True).warning("Failed to prune collaborator scores")
        return 0
    return (expired.rowcount or 0) + (overflow.rowcount or 0)


async def derive_collaborator_activity(ctx: dict[str, Any]) -> dict[str, Any]:
    """Credit yesterday's co-edits and calls, then drop stale and overflow scores."""
    now = datetime.now(UTC)
    # Never raises once credits commit, so a retry cannot credit the same day twice.
    async with open_session() as session:
        credited = await _credit_shared_work(session, now)
        pruned = await _prune(session, now)
    logger.info(f"Collaborator upkeep: credited={credited} pruned={pruned}")
    return {"credited": credited, "pruned": pruned}
