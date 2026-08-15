"""Test-session isolation: hidden from listings, memory writes suppressed."""

from types import SimpleNamespace as NS
from unittest.mock import AsyncMock, MagicMock, patch

from uniffy.core.models.agents.memory import MemoryScope
from uniffy.core.types import generate_id
from uniffy.domains.agents.memories.scope import MemoryScopeRef
from uniffy.domains.agents.tools.builtin.memory import (
    TEST_SESSION_WRITE_ERROR,
    _execute_memory_forget,
    _execute_memory_read,
    _execute_memory_save,
)
from uniffy.domains.agents.tools.definitions import ToolContext


def _tool_ctx(*, is_test_session: bool) -> ToolContext:
    session = MagicMock()
    session.execute = AsyncMock()
    session.commit = AsyncMock()
    session.delete = AsyncMock()
    return ToolContext(
        session=session,
        user_id=generate_id(),
        organization_id=generate_id(),
        agent_id=generate_id(),
        memory_scope=MemoryScopeRef(MemoryScope.USER, generate_id()),
        is_test_session=is_test_session,
    )


class TestMemoryWriteSuppression:
    async def test_save_refuses_in_test_session(self) -> None:
        ctx = _tool_ctx(is_test_session=True)
        result = await _execute_memory_save(ctx, {"key": "k", "description": "d", "content": "c"})
        assert not result.success
        assert result.error == TEST_SESSION_WRITE_ERROR
        ctx.session.execute.assert_not_awaited()
        ctx.session.commit.assert_not_awaited()

    async def test_forget_refuses_in_test_session(self) -> None:
        ctx = _tool_ctx(is_test_session=True)
        result = await _execute_memory_forget(ctx, {"key": "k"})
        assert not result.success
        assert result.error == TEST_SESSION_WRITE_ERROR
        ctx.session.execute.assert_not_awaited()
        ctx.session.delete.assert_not_awaited()

    async def test_read_still_works_in_test_session(self) -> None:
        ctx = _tool_ctx(is_test_session=True)
        row = NS(
            id=generate_id(),
            key="deploy_steps",
            description="how we deploy",
            content="use blue-green",
            category="facts",
            scope=MemoryScope.USER.value,
            importance=0.5,
            updated_at=None,
        )
        search_result = MagicMock()
        search_result.scalars.return_value.all.return_value = [row]
        ctx.session.execute = AsyncMock(side_effect=[search_result, MagicMock()])

        result = await _execute_memory_read(ctx, {"query": "deploy"})

        assert result.success
        assert "deploy_steps" in result.data

    async def test_save_works_outside_test_session(self) -> None:
        ctx = _tool_ctx(is_test_session=False)
        captured = {}

        class FakeOps:
            def __init__(self, session):
                pass

            async def save_from_tool(self, **kwargs):
                captured.update(kwargs)
                return NS(key="k", category="facts"), True

        with patch("uniffy.domains.agents.memories.operations.MemoryOperations", FakeOps):
            result = await _execute_memory_save(
                ctx, {"key": "k", "description": "d", "content": "c"}
            )
        assert result.success
        assert captured["key"] == "k"


def _session_ops():
    from uniffy.domains.agents.sessions.operations import SessionOperations

    ops = SessionOperations.__new__(SessionOperations)
    ops._session = MagicMock()
    ops._session.add = MagicMock()
    ops._session.commit = AsyncMock()
    ops._session.refresh = AsyncMock()
    ops._org_ops = MagicMock()
    ops._org_ops.require_org_member = AsyncMock()
    return ops


class TestCreateTestSession:
    def _create(self, ops, **overrides):
        kwargs = dict(
            user_id=generate_id(),
            organization_id=generate_id(),
            agent_id=generate_id(),
            kind="group",
        )
        kwargs.update(overrides)
        return ops.create_session(**kwargs)

    async def test_is_test_flag_persisted(self) -> None:
        ops = _session_ops()
        agent_ops = MagicMock()
        agent_ops.get_by_id = AsyncMock()
        with patch(
            "uniffy.domains.agents.sessions.operations.AgentOperations",
            return_value=agent_ops,
        ):
            await self._create(ops, is_test=True)
        added = ops._session.add.call_args[0][0]
        assert added.is_test is True

    async def test_default_is_not_test(self) -> None:
        ops = _session_ops()
        agent_ops = MagicMock()
        agent_ops.get_by_id = AsyncMock()
        with patch(
            "uniffy.domains.agents.sessions.operations.AgentOperations",
            return_value=agent_ops,
        ):
            await self._create(ops)
        added = ops._session.add.call_args[0][0]
        assert added.is_test is False


class TestNoSessionListSurface:
    def test_session_operations_has_no_list_method(self) -> None:
        from uniffy.domains.agents.sessions.operations import SessionOperations

        assert not hasattr(SessionOperations, "list_sessions")
