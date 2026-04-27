"""ARQ task: respond to a chat message as an agent.

Enqueued by the chat `send_message` post-commit hook when
`mention_detector.detect_agent_mentions` returns a match and the
`chat.agents_enabled` org flag is on. Opens a fresh async session and
hands off to `AgentChatBridge.respond_to_chat_message`, which drives the
runtime and fans translated events back into the chat stream.

Task name: `respond_to_chat_message` - stable and referenced by
`_post_commit_send` in `domains/chat/messages/operations.py`.
"""

from typing import Any
from uuid import UUID

from loguru import logger

from uniffy.db.session import open_session
from uniffy.domains.agents.chat_integration.operations import AgentChatBridge


async def respond_to_chat_message(
    ctx: dict[str, Any],
    channel_id: str,
    trigger_message_id: str,
    agent_id: str,
    trigger_rule: str,
) -> dict[str, Any]:
    """Run the agent against a chat trigger.

    Parameters
    ----------
    ctx : dict
        ARQ worker context.
    channel_id : str
        UUID of the chat channel.
    trigger_message_id : str
        UUID of the user message that triggered the invocation.
    agent_id : str
        UUID of the agent to invoke.
    trigger_rule : str
        Detection rule that matched (``dm`` / ``mention`` / ``reply``).
        Recorded for analytics.

    Returns
    -------
    dict
        Execution summary.

    """
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
        async with open_session() as session:
            bridge = AgentChatBridge(session)
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
