"""ARQ task: analyze an idle conversation and propose skill drafts.

Gated by a per-org opt-in and a daily budget; idempotent via a Valkey
`SET NX` lock. Every suggestion lands as a pending draft - the task never
activates a skill (that is always an explicit `SaveSkillDraft`).
"""

import contextlib
from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import select

from uniffy.core.models.agents.agent import Agent
from uniffy.core.valkey.ops import _get_ops_client
from uniffy.db.session import open_session
from uniffy.domains.agents.providers.operations import ProviderOperations
from uniffy.domains.agents.runtime.model_resolver import resolve_model
from uniffy.domains.agents.skills.analysis import (
    SkillEvolutionAnalyzer,
    consume_analysis_budget,
    is_skill_evolution_enabled,
)

logger = logger.bind(component="tasks.agent_skill_analysis")

_LOCK_TTL_SECONDS = 300
_LOCK_KEY_TEMPLATE = "analyze_skills_lock:{kind}:{destination_id}"


async def _acquire_lock(kind: str, destination_id: UUID) -> bool:
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


async def _release_lock(kind: str, destination_id: UUID) -> None:
    client = _get_ops_client()
    if client is None:
        return
    with contextlib.suppress(Exception):
        await client.delete(_LOCK_KEY_TEMPLATE.format(kind=kind, destination_id=destination_id))


async def analyze_session_for_skills(
    ctx: dict[str, Any],
    destination_kind: str,
    destination_id: str,
    user_id: str,
    agent_id: str,
    organization_id: str,
) -> dict[str, Any]:
    if destination_kind not in ("session", "channel"):
        return {"status": "error", "error": "bad_destination_kind"}
    try:
        dest = UUID(destination_id)
        uid = UUID(user_id)
        aid = UUID(agent_id)
        org_id = UUID(organization_id)
    except ValueError:
        return {"status": "error", "error": "invalid_uuid"}

    if not await _acquire_lock(destination_kind, dest):
        return {"status": "skipped", "reason": "lock_held"}

    try:
        async with open_session() as session:
            if not await is_skill_evolution_enabled(session, org_id):
                return {"status": "skipped", "reason": "disabled"}

            analyzer = SkillEvolutionAnalyzer(session)
            if destination_kind == "session":
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

            provider_ops = ProviderOperations(session)
            try:
                if agent.primary_provider_key_id:
                    provider, _pk = await provider_ops.get_provider_for_key(
                        organization_id=org_id,
                        key_id=agent.primary_provider_key_id,
                    )
                else:
                    provider = await provider_ops.get_provider_for_model(
                        organization_id=org_id,
                        model_id=agent.primary_model,
                    )
            except Exception:
                logger.opt(exception=True).warning("skill analysis: no usable provider")
                return {"status": "skipped", "reason": "no_provider"}

            model = await resolve_model(
                session_model_override=None,
                agent_primary_model=agent.primary_model,
                agent_fallback_models=agent.fallback_models or [],
                provider=provider,
            )

            proposals = await analyzer.run_analysis(
                signals=signals, provider=provider, model=model
            )
            drafts = await analyzer.apply_proposals(
                proposals,
                organization_id=org_id,
                user_id=uid,
                agent_id=aid,
                session_id=dest if destination_kind == "session" else None,
                channel_id=dest if destination_kind == "channel" else None,
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
        await _release_lock(destination_kind, dest)
