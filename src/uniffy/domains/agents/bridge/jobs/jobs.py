"""ARQ job: run an agent in response to a chat trigger (DM / mention / reply)."""

from typing import Any, cast
from uuid import UUID

from loguru import logger

from uniffy.core.database import SESSION_FACTORY_CTX_KEY, SessionFactory
from uniffy.core.search import SEARCH_INDEXER_CTX_KEY
from uniffy.core.storage import OBJECT_STORAGE_CTX_KEY, ObjectStorage
from uniffy.domains.agents.bridge.operations import AgentChatBridge

logger = logger.bind(component="agents.bridge.jobs.jobs")


async def respond_to_chat_message(
    ctx: dict[str, Any],
    channel_id: str,
    trigger_message_id: str,
    agent_id: str,
    trigger_rule: str,
) -> dict[str, Any]:
    try:
        cid = UUID(channel_id)
        tmid = UUID(trigger_message_id)
        aid = UUID(agent_id)
    except ValueError:
        logger.error(
            "respond_to_chat_message: invalid UUID in args "
            f"channel={channel_id} trigger={trigger_message_id} agent={agent_id}"
        )
        return {"status": "error", "error": "invalid_uuid"}

    try:
        session_factory = cast(SessionFactory, ctx[SESSION_FACTORY_CTX_KEY])
        async with session_factory() as session:
            storage = cast(ObjectStorage, ctx[OBJECT_STORAGE_CTX_KEY])
            bridge = AgentChatBridge(
                session,
                session_factory,
                storage,
                ctx[SEARCH_INDEXER_CTX_KEY],
            )
            await bridge.respond_to_chat_message(
                channel_id=cid,
                trigger_message_id=tmid,
                agent_id=aid,
                trigger_rule=trigger_rule,
            )
            return {
                "status": "success",
                "channel_id": channel_id,
                "agent_id": agent_id,
                "trigger_rule": trigger_rule,
            }
    except Exception as exc:
        logger.exception(
            f"respond_to_chat_message failed channel={channel_id} "
            f"agent={agent_id} rule={trigger_rule}: {exc}"
        )
        return {
            "status": "error",
            "error": str(exc)[:500],
            "channel_id": channel_id,
            "agent_id": agent_id,
        }
