"""Agents ↔ chat integration subdomain.

Owns the bridge that lets agents participate in chat channels:
  - mention_detector: finds agent mentions on incoming messages
  - AgentChatBridge: runs the agent runtime against chat context and
    translates runtime events into chat messages / stream events
  - compaction: scoped-view compaction against chat_messages

Phase 1 ships only stubs: membership works, DMs can be created, but no
runtime invocation happens. Phase 2 fills the behavior in.
"""

from uniffy.domains.agents.chat_integration.mention_detector import (
    MentionDetectionResult,
    detect_agent_mentions,
)
from uniffy.domains.agents.chat_integration.operations import AgentChatBridge

__all__ = ["AgentChatBridge", "MentionDetectionResult", "detect_agent_mentions"]
