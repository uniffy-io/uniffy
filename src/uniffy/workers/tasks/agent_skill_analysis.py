"""ARQ task: analyze an idle conversation and propose skill drafts.

Each conversation turn enqueues its own deferred job; this task self-debounces
by exiting unless the conversation has stayed quiet for the full debounce
window, and is idempotent via a Valkey `SET NX` lock. Gated by a per-org opt-in
and a daily budget. Every suggestion lands as a pending draft - the task never
activates a skill (that is always an explicit `SaveSkillDraft`).
"""

import contextlib
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.agents.message import AgentMessage
from uniffy.core.models.chat.message import ChatMessage
from uniffy.core.valkey.ops import _get_ops_client
from uniffy.db.session import open_session
from uniffy.domains.agents.providers.operations import ProviderOperations
from uniffy.domains.agents.runtime.model_resolver import resolve_provider_and_model
from uniffy.domains.agents.sessions.operations import SKILL_ANALYSIS_DEBOUNCE_SECONDS
from uniffy.domains.agents.skills.analysis import (
    SkillEvolutionAnalyzer,
    consume_analysis_budget,
    is_skill_evolution_enabled,
)
from uniffy.workers.tasks import SkillAnalysisDestination

logger = logger.bind(component="tasks.agent_skill_analysis")

_LOCK_TTL_SECONDS = 300
_LOCK_KEY_TEMPLATE = "analyze_skills_lock:{kind}:{destination_id}"


async def _acquire_lock(kind: SkillAnalysisDestination, destination_id: UUID) -> bool:
    client = _get_ops_client()
    if client is None:
        return False
    try:
        return bool(
            await client.set(
                _LOCK_KEY_TEMPLATE.format(kind=kind, destination_id=destination_id),
                "1",
                ex=_LOCK_TTL_SECONDS,
                nx=True,
            )
        )
    except Exception:
        return False


async def _release_lock(kind: SkillAnalysisDestination, destination_id: UUID) -> None:
    client = _get_ops_client()
    if client is None:
        return
    with contextlib.suppress(Exception):
        await client.delete(_LOCK_KEY_TEMPLATE.format(kind=kind, destination_id=destination_id))


async def _latest_activity_at(
    session: AsyncSession, destination_kind: SkillAnalysisDestination, destination_id: UUID
) -> datetime | None:
    if destination_kind is SkillAnalysisDestination.SESSION:
        stmt = select(func.max(AgentMessage.created_at)).where(
            AgentMessage.session_id == destination_id
        )
    else:
        stmt = select(func.max(ChatMessage.created_at)).where(
            ChatMessage.channel_id == destination_id,
            ChatMessage.is_deleted == False,  # noqa: E712
        )
    return (await session.execute(stmt)).scalar()


def _conversation_is_quiet(
    latest_activity: datetime | None, now: datetime, debounce_seconds: int
) -> bool:
    """True when the newest message predates the debounce window.

    A message inside the window means a later salted job will analyze the
    fresher transcript, so this job exits instead of running against a still
    active conversation.
    """
    if latest_activity is None:
        return True
    return (now - latest_activity).total_seconds() >= debounce_seconds


async def analyze_session_for_skills(
    ctx: dict[str, Any],
    destination_kind: str,
    destination_id: str,
    user_id: str,
    agent_id: str,
    organization_id: str,
) -> dict[str, Any]:
    try:
        resolved_kind = SkillAnalysisDestination(destination_kind)
    except ValueError:
        return {"status": "error", "error": "bad_destination_kind"}
    try:
        dest = UUID(destination_id)
        uid = UUID(user_id)
        aid = UUID(agent_id)
        org_id = UUID(organization_id)
    except ValueError:
        return {"status": "error", "error": "invalid_uuid"}

    if not await _acquire_lock(resolved_kind, dest):
        return {"status": "skipped", "reason": "lock_held"}

    try:
        async with open_session() as session:
            latest_activity = await _latest_activity_at(session, resolved_kind, dest)
            if not _conversation_is_quiet(
                latest_activity, datetime.now(UTC), SKILL_ANALYSIS_DEBOUNCE_SECONDS
            ):
                return {"status": "skipped", "reason": "still_active"}

            if not await is_skill_evolution_enabled(session, org_id):
                return {"status": "skipped", "reason": "disabled"}

            analyzer = SkillEvolutionAnalyzer(session)
            if resolved_kind is SkillAnalysisDestination.SESSION:
                signals = await analyzer.gather_session_signals(
                    session_id=dest, organization_id=org_id
                )
            else:
                signals = await analyzer.gather_channel_signals(
                    channel_id=dest, organization_id=org_id
                )
            if signals is None:
                return {"status": "skipped", "reason": "no_signal"}

            if not await consume_analysis_budget(org_id):
                return {"status": "skipped", "reason": "over_budget"}

            agent = (
                await session.execute(select(Agent).where(Agent.id == aid))
            ).scalar_one_or_none()
            if agent is None:
                return {"status": "error", "error": "agent_not_found"}

            try:
                provider, _key_id, model = await resolve_provider_and_model(
                    session,
                    ProviderOperations(session),
                    organization_id=org_id,
                    agent=agent,
                )
            except Exception:
                logger.opt(exception=True).warning("skill analysis: no usable provider")
                return {"status": "skipped", "reason": "no_provider"}

            proposals = await analyzer.run_analysis(signals=signals, provider=provider, model=model)
            drafts = await analyzer.apply_proposals(
                proposals,
                organization_id=org_id,
                user_id=uid,
                agent_id=aid,
                session_id=(dest if resolved_kind is SkillAnalysisDestination.SESSION else None),
                channel_id=(dest if resolved_kind is SkillAnalysisDestination.CHANNEL else None),
                active_skills=signals.active_skills,
            )
            return {
                "status": "success",
                "proposals": len(proposals),
                "drafts_created": len(drafts),
            }
    except Exception as exc:
        logger.exception(f"analyze_session_for_skills failed: {exc}")
        return {"status": "error", "error": str(exc)[:500]}
    finally:
        await _release_lock(resolved_kind, dest)
