"""AgentChatBridge contract tests.

The bridge's `respond_to_chat_message` grew real behavior in Phase 2: it
loads the trigger / channel / agent, invokes the runtime, and translates
stream events. The tests here exercise the guard paths (missing trigger,
non-user trigger) without requiring a full DB fixture. Runtime-backed
integration lives in `test_chat_runtime_destination.py` / Phase 2i.

`handle_confirmation_decision` is still a stub until Phase 2e.
`build_runtime_context_from_chat` and `publish_runtime_event_to_chat` are
unused entry points kept for plan-parity.
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from uniffy.core.types import generate_id as uuid7
from uniffy.domains.agents.chat_integration.operations import AgentChatBridge


def _run(coro):
    return asyncio.run(coro)


def _bridge_with_missing_trigger() -> AgentChatBridge:
    """Bridge whose session returns None for any `get(...)`.

    Exercises the missing-trigger guard without touching the DB.
    """
    session = MagicMock()
    session.get = AsyncMock(return_value=None)
    return AgentChatBridge(session)


class TestAgentChatBridgeStub:
    def test_respond_to_chat_message_returns_when_trigger_missing(self) -> None:
        bridge = _bridge_with_missing_trigger()
        _run(
            bridge.respond_to_chat_message(
                channel_id=uuid7(),
                trigger_message_id=uuid7(),
                agent_id=uuid7(),
            )
        )

    def test_handle_confirmation_decision_raises_when_state_missing(self) -> None:
        """Real (not stub) handler: unknown request_id -> NotFoundError."""
        from uniffy.core.errors import NotFoundError

        bridge = AgentChatBridge(MagicMock())
        with pytest.raises(NotFoundError):
            _run(
                bridge.handle_confirmation_decision(
                    request_id=uuid7(),
                    channel_id=uuid7(),
                    message_id=uuid7(),
                    decision="approved",
                    decided_by=uuid7(),
                    rationale=None,
                )
            )

    def test_build_runtime_context_raises_not_implemented(self) -> None:
        bridge = AgentChatBridge(MagicMock())
        with pytest.raises(NotImplementedError):
            _run(bridge.build_runtime_context_from_chat(channel_id=uuid7(), agent_id=uuid7()))

    def test_publish_runtime_event_raises_not_implemented(self) -> None:
        bridge = AgentChatBridge(MagicMock())
        with pytest.raises(NotImplementedError):
            _run(
                bridge.publish_runtime_event_to_chat(
                    event=object(),
                    channel_id=uuid7(),
                    agent_id=uuid7(),
                )
            )
