"""Unit tests for channel-transcript gathering in the skill-evolution analyzer."""

from types import SimpleNamespace as NS
from unittest.mock import AsyncMock, MagicMock

from uniffy.core.models.chat.message import SenderType
from uniffy.core.types import generate_id
from uniffy.domains.agents.skills.analysis import SkillEvolutionAnalyzer

_INTERNAL_META = {"kind": "final", "visibility": "agent_internal"}


def _msg(sender_type: SenderType, content: str, metadata: dict | None = None) -> NS:
    return NS(sender_type=sender_type, content=content, message_metadata=metadata)


def _analyzer_over(rows: list[NS]) -> SkillEvolutionAnalyzer:
    result = MagicMock()
    result.scalars.return_value.all.return_value = rows
    analyzer = SkillEvolutionAnalyzer.__new__(SkillEvolutionAnalyzer)
    analyzer._session = MagicMock()
    analyzer._session.execute = AsyncMock(return_value=result)
    return analyzer


class TestGatherChannelSignals:
    async def test_keeps_user_and_final_agent_lines_only(self) -> None:
        # Newest-first, as the created_at.desc() query returns them; the gatherer
        # reverses into chronological order before building the transcript.
        rows = [
            _msg(SenderType.AGENT, "INTERNAL_TEXT", _INTERNAL_META),
            _msg(SenderType.AGENT, "CONTEXTRESET_TEXT", {"kind": "context_reset"}),
            _msg(SenderType.AGENT, "SUMMARY_TEXT", {"kind": "summary"}),
            _msg(SenderType.AGENT, "TOOLRESULT_TEXT", {"kind": "tool_result"}),
            _msg(SenderType.AGENT, "TOOLCALL_TEXT", {"kind": "tool_call"}),
            _msg(SenderType.AGENT, "the assistant final reply", {"kind": "final"}),
            _msg(SenderType.USER, "hello from the user", None),
        ]
        signals = await _analyzer_over(rows).gather_channel_signals(
            channel_id=generate_id(), organization_id=generate_id()
        )

        assert signals is not None
        lines = signals.transcript.splitlines()
        # Only the user turn and the agent's final reply survive, in order.
        assert lines == [
            "User: hello from the user",
            "Assistant: the assistant final reply",
        ]

    async def test_excludes_every_non_final_and_internal_agent_row(self) -> None:
        rows = [
            _msg(SenderType.USER, "user asked something", None),
            _msg(SenderType.AGENT, "final answer", {"kind": "final"}),
            _msg(SenderType.AGENT, "TOOLCALL_TEXT", {"kind": "tool_call"}),
            _msg(SenderType.AGENT, "TOOLRESULT_TEXT", {"kind": "tool_result"}),
            _msg(SenderType.AGENT, "SUMMARY_TEXT", {"kind": "summary"}),
            _msg(SenderType.AGENT, "CONTEXTRESET_TEXT", {"kind": "context_reset"}),
            _msg(SenderType.AGENT, "INTERNAL_TEXT", _INTERNAL_META),
        ]
        signals = await _analyzer_over(rows).gather_channel_signals(
            channel_id=generate_id(), organization_id=generate_id()
        )

        assert signals is not None
        transcript = signals.transcript
        # tool_call / tool_result rows may carry text but must never leak in.
        for excluded in (
            "TOOLCALL_TEXT",
            "TOOLRESULT_TEXT",
            "SUMMARY_TEXT",
            "CONTEXTRESET_TEXT",
            "INTERNAL_TEXT",
        ):
            assert excluded not in transcript
        assert transcript.count("Assistant:") == 1
        assert transcript.count("User:") == 1

    async def test_user_row_without_kind_is_kept(self) -> None:
        rows = [_msg(SenderType.USER, "just a user message", None)]
        signals = await _analyzer_over(rows).gather_channel_signals(
            channel_id=generate_id(), organization_id=generate_id()
        )

        assert signals is not None
        assert signals.transcript == "User: just a user message"

    async def test_no_human_facing_rows_returns_none(self) -> None:
        rows = [
            _msg(SenderType.AGENT, "TOOLCALL_TEXT", {"kind": "tool_call"}),
            _msg(SenderType.AGENT, "SUMMARY_TEXT", {"kind": "summary"}),
        ]
        signals = await _analyzer_over(rows).gather_channel_signals(
            channel_id=generate_id(), organization_id=generate_id()
        )

        assert signals is None
