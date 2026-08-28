"""Agents <-> chat integration subdomain."""

from uniffy.domains.agents.bridge.mentions import (
    MentionDetectionResult,
    detect_agent_mentions,
)
from uniffy.domains.agents.bridge.operations import AgentChatBridge

__all__ = ["AgentChatBridge", "MentionDetectionResult", "detect_agent_mentions"]
