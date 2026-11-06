"""Nightly collaborator upkeep: credit shared work that sends no notification, then prune."""

from collections import defaultdict
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from itertools import permutations
from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import Select, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.calls.call import CallParticipant
from uniffy.core.models.projects.activity import TaskActivity
from uniffy.core.models.projects.task import Task
from uniffy.core.types import ContentType
from uniffy.domains.directory.collaborators.signals import (
    HALF_LIFE,
    LN2,
    MAX_ROWS_PER_VIEWER,
    WINDOW,
    CollaboratorSignal,
    Interaction,
    stage_interactions,
)
from uniffy.domains.permissions.access import ResourceAudienceResolver, ResourceKey
from uniffy.infrastructure.database import open_session

logger = logger.bind(component="directory.collaborators.jobs")

LOOKBACK = timedelta(days=1)
# Work touched by more people than this is a shared space, not a working relationship.
MAX_PARTICIPANTS = 8


ACTIVITY_PAGE_SIZE = 100


def _task_people(since: datetime, until: datetime) -> Select[tuple[UUID, UUID, list[UUID]]]:
    return (
        select(Task.organization_id, Task.id, func.array_agg(TaskActivity.actor_id.distinct()))
        .join(TaskActivity, TaskActivity.task_id == Task.id)
        .where(
            TaskActivity.timestamp >= since,
            TaskActivity.timestamp < until,
            TaskActivity.agent_id.is_(None),
            Task.is_deleted.is_(False),
        )
        .group_by(Task.organization_id, Task.id)
        .having(func.count(TaskActivity.actor_id.distinct()).between(2, MAX_PARTICIPANTS))
        .order_by(Task.id)
    )


def _call_people(since: datetime, until: datetime) -> Select[tuple[UUID, UUID, list[UUID]]]:
    return (
        select(
            CallParticipant.organization_id,
            CallParticipant.call_id,
            func.array_agg(CallParticipant.user_id.distinct()),
        )
        .where(CallParticipant.joined_at >= since, CallParticipant.joined_at < until)
        .group_by(CallParticipant.organization_id, CallParticipant.call_id)
        .having(func.count(CallParticipant.user_id.distinct()).between(2, MAX_PARTICIPANTS))
        .order_by(CallParticipant.call_id)
    )


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


async def _shared_work(
    session: AsyncSession, since: datetime, until: datetime
) -> AsyncIterator[tuple[UUID, list[Interaction]]]:
    sources = (
        (_task_people(since, until), Task.id, ContentType.TASK),
        (_call_people(since, until), CallParticipant.call_id, ContentType.CALL),
    )
    for statement, item_column, content_type in sources:
        after: UUID | None = None
        while True:
            page = statement.limit(ACTIVITY_PAGE_SIZE)
            if after is not None:
                page = page.where(item_column > after)
            rows = (await session.execute(page)).all()
            if not rows:
                break
            by_org: dict[UUID, list[Interaction]] = defaultdict(list)
            for organization_id, item_id, people in rows:
                if content_type == ContentType.TASK:
                    # Former editors must not learn about work done after their access ended.
                    people = await ResourceAudienceResolver(session).filter_resource(
                        organization_id=organization_id,
                        key=ResourceKey(ContentType.TASK, item_id),
                        candidate_user_ids=people,
                    )
                by_org[organization_id].extend(
                    (user_id, peer_id, CollaboratorSignal.CO_ACTIVITY)
                    for user_id, peer_id in permutations(people, 2)
                )
            after = rows[-1][1]
            for organization_id, pairs in by_org.items():
                if pairs:
                    yield organization_id, pairs


async def _credit_shared_work(session: AsyncSession, now: datetime) -> int:
    credited = 0
    try:
        async for organization_id, pairs in _shared_work(session, now - LOOKBACK, now):
            try:
                written = await stage_interactions(session, organization_id, pairs, at=now)
                await session.commit()
                credited += written
            except Exception:
                await session.rollback()
                logger.opt(exception=True).warning(
                    "Failed to credit shared work", organization_id=str(organization_id)
                )
    except Exception:
        await session.rollback()
        logger.opt(exception=True).warning("Failed to read shared work")
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
