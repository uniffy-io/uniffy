"""Agents <-> chat integration subdomain."""

from uniffy.domains.agents.chat_integration.mention_detector import (
    MentionDetectionResult,
    detect_agent_mentions,
)
from uniffy.domains.agents.chat_integration.operations import AgentChatBridge

__all__ = ["AgentChatBridge", "MentionDetectionResult", "detect_agent_mentions"]
