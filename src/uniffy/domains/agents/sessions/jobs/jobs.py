"""ARQ job: compact an agent session when it crosses the token budget.

Idempotent via an owned Valkey `SET NX` lease keyed
`compaction_lock:{session_id}` so two workers cannot race on summary insertion.
"""

from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import select

from uniffy.core.jobs.locks import acquire_owned_job_lock, release_owned_job_lock
from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.agents.session import AgentSession
from uniffy.core.valkey.ops import _get_ops_client
from uniffy.db.session import open_session
from uniffy.domains.agents.providers.operations import ProviderOperations
from uniffy.domains.agents.runtime.models.resolver import resolve_provider_and_model
from uniffy.domains.agents.sessions.operations import (
    FALLBACK_CONTEXT_WINDOW,
    SessionOperations,
)

logger = logger.bind(component="agents.sessions.jobs.jobs")

COMPACT_SESSION_JOB_TIMEOUT_SECONDS = 900
_LOCK_TTL_SECONDS = COMPACT_SESSION_JOB_TIMEOUT_SECONDS + 30
_LOCK_KEY_TEMPLATE = "compaction_lock:{session_id}"


async def _acquire_lock(session_id: UUID) -> str | None:
    client = _get_ops_client()
    if client is None:
        return None
    try:
        return await acquire_owned_job_lock(
            client,
            _LOCK_KEY_TEMPLATE.format(session_id=session_id),
            _LOCK_TTL_SECONDS,
        )
    except Exception:
        logger.warning(f"compact_session: lock SET NX failed for session {session_id}")
        return None


async def _release_lock(session_id: UUID, token: str) -> None:
    client = _get_ops_client()
    if client is None:
        return
    try:
        await release_owned_job_lock(
            client,
            _LOCK_KEY_TEMPLATE.format(session_id=session_id),
            token,
        )
    except Exception:
        logger.warning(f"compact_session: lock DEL failed for session {session_id}")


async def compact_session(
    ctx: dict[str, Any],
    session_id: str,
) -> dict[str, Any]:
    try:
        sid = UUID(session_id)
    except ValueError:
        logger.error(f"compact_session: invalid session_id {session_id}")
        return {"status": "error", "error": "invalid_uuid"}

    lock_token = await _acquire_lock(sid)
    if lock_token is None:
        return {"status": "skipped", "reason": "lock_held", "session_id": session_id}

    try:
        async with open_session() as session:
            session_ops = SessionOperations(session)
            provider_ops = ProviderOperations(session)

            agent_session = (
                await session.execute(select(AgentSession).where(AgentSession.id == sid))
            ).scalar_one_or_none()
            if agent_session is None:
                return {
                    "status": "error",
                    "error": "session_not_found",
                    "session_id": session_id,
                }

            agent = (
                await session.execute(select(Agent).where(Agent.id == agent_session.agent_id))
            ).scalar_one_or_none()
            if agent is None:
                return {
                    "status": "error",
                    "error": "agent_not_found",
                    "session_id": session_id,
                }

            provider, _key_id, model = await resolve_provider_and_model(
                session,
                provider_ops,
                organization_id=agent_session.organization_id,
                agent=agent,
                model_override=agent_session.model_override,
            )

            context_window = FALLBACK_CONTEXT_WINDOW
            try:
                models = await provider.get_available_models()
                for m in models:
                    if m.id == model:
                        context_window = m.context_window
                        break
            except Exception:
                pass

            result = await session_ops.compact_session_if_needed(
                user_id=agent_session.user_id,
                organization_id=agent_session.organization_id,
                session_id=sid,
                provider=provider,
                model=model,
                context_window_tokens=context_window,
            )
            return {
                "status": "success",
                "session_id": session_id,
                "performed": result.performed,
                "messages_compacted": result.messages_compacted,
                "tokens_before": result.tokens_before,
                "tokens_after": result.tokens_after,
            }
    except Exception as exc:
        logger.exception(f"compact_session failed for {session_id}: {exc}")
        return {
            "status": "error",
            "error": str(exc)[:500],
            "session_id": session_id,
        }
    finally:
        await _release_lock(sid, lock_token)
