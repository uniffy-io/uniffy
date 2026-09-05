"""Best-effort writers for agents_skill_usages attribution rows.

Usage logging is an analytics signal for the evolution analyzer, never a
correctness dependency of a run - every writer swallows its own errors so a
logging failure can't break the agent turn.
"""

from uuid import UUID

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.agents.skill_usage import AgentSkillUsage

logger = logger.bind(component="agents.skills.usage")


async def record_skill_event(
    session: AsyncSession,
    *,
    skill_id: UUID,
    skill_version: int,
    agent_id: UUID,
    user_id: UUID,
    organization_id: UUID,
    session_id: UUID | None = None,
    viewed: bool = False,
    invoked: bool = False,
    commit: bool = True,
) -> None:
    """Record an explicit invocation without making analytics a run dependency."""
    try:
        session.add(
            AgentSkillUsage(
                skill_id=skill_id,
                skill_version=skill_version,
                agent_id=agent_id,
                user_id=user_id,
                organization_id=organization_id,
                session_id=session_id,
                viewed=viewed,
                invoked=invoked,
            )
        )
        if commit:
            await session.commit()
    except Exception:
        logger.opt(exception=True).warning("Failed to record skill usage event")
