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


async def record_skill_injections(
    session: AsyncSession,
    *,
    skills: list,
    agent_id: UUID,
    user_id: UUID,
    organization_id: UUID,
    session_id: UUID | None = None,
) -> None:
    """Stage one injected=true row per skill placed in the prompt this turn.

    Rows are added to the runtime session and committed by the ambient flow;
    if the run rolls back, the usage rows roll back with it.
    """
    if not skills:
        return
    try:
        session.add_all(
            [
                AgentSkillUsage(
                    skill_id=s.id,
                    skill_version=int(getattr(s, "latest_version_number", 0) or 0),
                    agent_id=agent_id,
                    user_id=user_id,
                    organization_id=organization_id,
                    session_id=session_id,
                    injected=True,
                )
                for s in skills
            ]
        )
    except Exception:
        logger.opt(exception=True).warning("Failed to stage skill injection usage")


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
    """Write a single usage row for an explicit signal (view_skill or slash invocation)."""
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
