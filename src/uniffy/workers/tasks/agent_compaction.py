"""ARQ task: compact an agent session asynchronously.

Enqueued by `RuntimeOperations` when a session crosses the token budget.
Idempotent via a Valkey ``SET NX`` lock keyed
``compaction_lock:{session_id}`` with a 5-minute TTL: if another worker is
already compacting the session, the job becomes a no-op so two workers
can't race on summary insertion.
"""

from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import select

from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.agents.session import AgentSession
from uniffy.core.valkey.ops import _get_ops_client
from uniffy.db.session import open_session
from uniffy.domains.agents.providers.operations import ProviderOperations
from uniffy.domains.agents.runtime.model_resolver import resolve_model
from uniffy.domains.agents.sessions.operations import (
    FALLBACK_CONTEXT_WINDOW,
    SessionOperations,
)

_LOCK_TTL_SECONDS = 300
_LOCK_KEY_TEMPLATE = "compaction_lock:{session_id}"


async def _acquire_lock(session_id: UUID) -> bool:
    """Try to acquire the compaction lock. Returns True on success."""
    client = _get_ops_client()
    if client is None:
        return False
    try:
        return bool(
            await client.set(
                _LOCK_KEY_TEMPLATE.format(session_id=session_id),
                "1",
                ex=_LOCK_TTL_SECONDS,
                nx=True,
            )
        )
    except Exception:
        logger.warning(
            f"compact_session: lock SET NX failed for session {session_id}"
        )
        return False


async def _release_lock(session_id: UUID) -> None:
    client = _get_ops_client()
    if client is None:
        return
    try:
        await client.delete(_LOCK_KEY_TEMPLATE.format(session_id=session_id))
    except Exception:
        logger.warning(
            f"compact_session: lock DEL failed for session {session_id}"
        )


async def compact_session(
    ctx: dict[str, Any],
    session_id: str,
) -> dict[str, Any]:
    """Compact a single agent session.

    Acquires a Valkey lock, loads the session, resolves the active provider
    + model, and runs ``SessionOperations.compact_session_if_needed``. On
    lock-loss the job is a no-op (another worker is handling it).
    """
    try:
        sid = UUID(session_id)
    except ValueError:
        logger.error(f"compact_session: invalid session_id {session_id}")
        return {"status": "error", "error": "invalid_uuid"}

    if not await _acquire_lock(sid):
        return {"status": "skipped", "reason": "lock_held", "session_id": session_id}

    try:
        async with open_session() as session:
            session_ops = SessionOperations(session)
            provider_ops = ProviderOperations(session)

            agent_session = (
                await session.execute(
                    select(AgentSession).where(AgentSession.id == sid)
                )
            ).scalar_one_or_none()
            if agent_session is None:
                return {
                    "status": "error",
                    "error": "session_not_found",
                    "session_id": session_id,
                }

            agent = (
                await session.execute(
                    select(Agent).where(Agent.id == agent_session.agent_id)
                )
            ).scalar_one_or_none()
            if agent is None:
                return {
                    "status": "error",
                    "error": "agent_not_found",
                    "session_id": session_id,
                }

            target_model = agent_session.model_override or agent.primary_model
            if agent.primary_provider_key_id:
                provider, _pk = await provider_ops.get_provider_for_key(
                    organization_id=agent_session.organization_id,
                    key_id=agent.primary_provider_key_id,
                )
            else:
                provider = await provider_ops.get_provider_for_model(
                    organization_id=agent_session.organization_id,
                    model_id=target_model,
                )

            model = await resolve_model(
                session_model_override=agent_session.model_override,
                agent_primary_model=agent.primary_model,
                agent_fallback_models=agent.fallback_models or [],
                provider=provider,
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
        await _release_lock(sid)
