"""Deleting an agent must retire it everywhere, not just hide it from a list.

The row survives so past chat messages still resolve a name, while every path
that would let the agent act refuses.
"""

from types import SimpleNamespace as NS
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from uniffy.core.errors import ValidationError
from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.agents.cron_task import AgentCronTask
from uniffy.core.models.agents.memory import AgentMemory
from uniffy.core.models.chat.message import SenderType
from uniffy.core.types import generate_id

OPS_MODULE = "uniffy.domains.agents.agents.operations"


def _agent(**overrides):
    """Stand-in row; the ops under test only read attributes off it."""
    return NS(
        id=overrides.get("id", generate_id()),
        organization_id=overrides.get("organization_id", generate_id()),
        owner_id=generate_id(),
        name="Ada",
        enabled_skills=overrides.get("enabled_skills", []),
        is_default=overrides.get("is_default", False),
        is_deleted=overrides.get("is_deleted", False),
        deleted_at=overrides.get("deleted_at"),
        avatar_key=None,
        avatar_emoji=None,
    )


class _RecordingSession:
    """Captures the statements a fan-out issues so their targets are assertable."""

    def __init__(self) -> None:
        self.statements: list = []
        self.commits = 0

    async def execute(self, stmt):
        self.statements.append(stmt)
        return MagicMock()

    async def commit(self) -> None:
        self.commits += 1

    async def refresh(self, _obj) -> None:
        return None

    def targets(self) -> list[str]:
        return [
            getattr(getattr(s, "table", None), "name", "")
            or getattr(getattr(s, "entity_description", None) or {}, "get", lambda _k: "")("name")
            for s in self.statements
        ]


def _ops(session, agent):
    from uniffy.domains.agents.agents.operations import AgentOperations

    ops = AgentOperations.__new__(AgentOperations)
    ops.session = session
    ops._fetch_by_id = AsyncMock(return_value=agent)
    ops.search_indexer = MagicMock(remove=AsyncMock())
    ops._index_for_search = AsyncMock()
    return ops


def _quiet_side_effects():
    """Patch the Valkey / search side effects the fan-out fires after commit."""
    return [
        patch(f"{OPS_MODULE}.require_agents_builder", AsyncMock()),
        patch(f"{OPS_MODULE}.invalidate_agent_profile", AsyncMock()),
        patch(f"{OPS_MODULE}.invalidate_cached_agent", AsyncMock()),
        patch(f"{OPS_MODULE}.invalidate_cached_agent_skills", AsyncMock()),
        patch(f"{OPS_MODULE}.invalidate_memory_index", AsyncMock()),
        patch(f"{OPS_MODULE}.set_cached_agent", AsyncMock()),
        patch(f"{OPS_MODULE}.track_agent_skill_refs", AsyncMock()),
    ]


class TestDeleteFanOut:
    async def test_marks_deleted_and_clears_default(self) -> None:
        agent = _agent(is_default=True)
        session = _RecordingSession()
        ops = _ops(session, agent)

        patches = _quiet_side_effects()
        for p in patches:
            p.start()
        try:
            await ops.delete_agent(
                user_id=generate_id(),
                organization_id=agent.organization_id,
                agent_id=agent.id,
            )
        finally:
            for p in patches:
                p.stop()

        assert agent.is_deleted is True
        assert agent.deleted_at is not None
        # A retired agent must not keep the org's default slot hostage.
        assert agent.is_default is False

    async def test_disables_cron_tasks_and_drops_agent_bound_memories(self) -> None:
        agent = _agent()
        session = _RecordingSession()
        ops = _ops(session, agent)

        patches = _quiet_side_effects()
        for p in patches:
            p.start()
        try:
            await ops.delete_agent(
                user_id=generate_id(),
                organization_id=agent.organization_id,
                agent_id=agent.id,
            )
        finally:
            for p in patches:
                p.stop()

        assert len(session.statements) == 2

    async def test_search_row_is_removed(self) -> None:
        agent = _agent()
        session = _RecordingSession()
        ops = _ops(session, agent)

        patches = _quiet_side_effects()
        for p in patches:
            p.start()
        try:
            await ops.delete_agent(
                user_id=generate_id(),
                organization_id=agent.organization_id,
                agent_id=agent.id,
            )
        finally:
            for p in patches:
                p.stop()

        ops.search_indexer.remove.assert_awaited_once()


class TestRestore:
    async def test_clears_flags_and_reindexes(self) -> None:
        agent = _agent(is_deleted=True, deleted_at="2026-07-30")
        session = _RecordingSession()
        ops = _ops(session, agent)

        patches = _quiet_side_effects()
        for p in patches:
            p.start()
        try:
            restored = await ops.restore_agent(
                user_id=generate_id(),
                organization_id=agent.organization_id,
                agent_id=agent.id,
            )
        finally:
            for p in patches:
                p.stop()

        assert restored.is_deleted is False
        assert restored.deleted_at is None
        ops._index_for_search.assert_awaited_once()
        # Restoring never re-enables a schedule: the runs would start unasked.
        assert session.statements == []

    async def test_live_agent_is_a_no_op(self) -> None:
        agent = _agent(is_deleted=False)
        session = _RecordingSession()
        ops = _ops(session, agent)

        patches = _quiet_side_effects()
        for p in patches:
            p.start()
        try:
            await ops.restore_agent(
                user_id=generate_id(),
                organization_id=agent.organization_id,
                agent_id=agent.id,
            )
        finally:
            for p in patches:
                p.stop()

        ops._index_for_search.assert_not_awaited()
        assert session.commits == 0


class TestChatInvocationRefusesDeletedAgent:
    async def test_no_run_is_started(self) -> None:
        from uniffy.domains.agents.chat_integration.operations import AgentChatBridge

        org_id = generate_id()
        channel_id = generate_id()
        trigger_id = generate_id()
        agent = _agent(organization_id=org_id, is_deleted=True)

        trigger = NS(
            id=trigger_id,
            channel_id=channel_id,
            sender_type=SenderType.USER,
            sender_id=generate_id(),
            root_id=None,
            message_metadata=None,
        )
        channel = NS(id=channel_id, organization_id=org_id)

        async def _get(model, ident):
            if model is Agent:
                return agent
            return trigger if ident == trigger_id else channel

        session = MagicMock()
        session.get = AsyncMock(side_effect=_get)

        bridge = AgentChatBridge.__new__(AgentChatBridge)
        bridge._session = session
        bridge._load_user_member_ids = AsyncMock(
            side_effect=AssertionError("run started for a deleted agent")
        )

        await bridge.respond_to_chat_message(channel_id, trigger_id, agent.id)


class TestFrozenAgentDm:
    async def test_send_is_refused(self) -> None:
        from uniffy.domains.chat.messages.operations import ChatMessageOperations

        org_id = generate_id()
        agent_id = generate_id()
        channel = NS(
            id=generate_id(),
            organization_id=org_id,
            is_agent_dm=True,
            agent_id=agent_id,
        )

        result = MagicMock()
        result.scalar_one_or_none = MagicMock(return_value=True)
        session = MagicMock()
        session.execute = AsyncMock(return_value=result)
        session.add = MagicMock(side_effect=AssertionError("message row written"))

        ops = ChatMessageOperations.__new__(ChatMessageOperations)
        ops.session = session
        ops.access = MagicMock(
            get_channel=AsyncMock(return_value=channel),
            require_send=AsyncMock(),
        )

        with pytest.raises(ValidationError):
            await ops.send_message(
                user_id=generate_id(),
                organization_id=org_id,
                channel_id=channel.id,
                content="are you there?",
            )


class TestQueriesExcludeDeletedAgents:
    """The filters live in SQL, so the statements themselves are the assertion."""

    async def test_mention_detection_joins_the_agent_row(self) -> None:
        from uniffy.core.models.chat.channel import ChannelType
        from uniffy.domains.agents.chat_integration.mention_detector import (
            detect_agent_mentions,
        )

        captured: list = []

        async def execute(stmt):
            captured.append(str(stmt))
            res = MagicMock()
            res.all = MagicMock(return_value=[])
            return res

        session = MagicMock()
        session.execute = AsyncMock(side_effect=execute)
        message = NS(
            sender_type=SenderType.USER,
            mentioned_agent_ids=None,
            reply_to_id=None,
            root_id=None,
        )
        channel = NS(id=generate_id(), channel_type=ChannelType.DIRECT)

        await detect_agent_mentions(session, message, channel)

        assert captured, "no membership query issued"
        assert "agents_agents" in captured[0]
        assert "is_deleted" in captured[0]

    async def test_due_cron_tasks_join_the_agent_row(self) -> None:
        from uniffy.domains.agents.cron.operations import CronTaskOperations

        captured: list = []

        async def execute(stmt):
            captured.append(str(stmt))
            res = MagicMock()
            res.scalars = MagicMock(return_value=MagicMock(all=MagicMock(return_value=[])))
            return res

        session = MagicMock()
        session.execute = AsyncMock(side_effect=execute)
        ops = CronTaskOperations.__new__(CronTaskOperations)
        ops.session = session

        await ops.get_due_tasks()

        assert captured
        assert "agents_agents" in captured[0]


def test_models_are_importable() -> None:
    """Guards the fan-out imports the operations module now carries."""
    assert AgentCronTask.__tablename__ == "agents_cron_tasks"
    assert AgentMemory.__tablename__ == "agents_memories"
