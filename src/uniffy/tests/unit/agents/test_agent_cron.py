"""Agent cron behavior tests."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock, MagicMock, patch

from sqlalchemy.orm.evaluator import _EvaluatorCompiler

from uniffy.core.models.agents.run_log import AgentRunLog
from uniffy.core.types import generate_id


def _log(**overrides) -> AgentRunLog:
    defaults = dict(
        session_id=generate_id(),
        agent_id=generate_id(),
        user_id=generate_id(),
        organization_id=generate_id(),
        model="claude",
        kind="cron",
        cron_task_id=generate_id(),
        status="success",
        input_tokens=10,
        output_tokens=20,
        duration_ms=0,
        created_at=datetime(2026, 7, 24, 12, 0, tzinfo=UTC),
    )
    defaults.update(overrides)
    return AgentRunLog(**defaults)


def _criteria_matcher(stmt):
    compiler = _EvaluatorCompiler(AgentRunLog)
    criteria = [compiler.process(c) for c in stmt._where_criteria]

    def matches(row: AgentRunLog) -> bool:
        return all(c(row) for c in criteria)

    return matches


def _capture_session():
    session = MagicMock()
    captured: list = []

    async def execute(stmt):
        captured.append(stmt)
        return NS(rowcount=1)

    session.execute = AsyncMock(side_effect=execute)
    session.commit = AsyncMock()
    return session, captured


class TestListCronTasksAccessFilter:
    async def _list(self, *, agent_id):
        from uniffy.core.auth.permissions.queries import ContentAccessQuery
        from uniffy.domains.agents.cron.operations import CronTaskOperations

        session = MagicMock()
        captured: list = []

        async def execute(stmt):
            captured.append(stmt)
            result = MagicMock()
            result.scalar = MagicMock(return_value=0)
            result.scalars = MagicMock(return_value=NS(all=lambda: []))
            return result

        session.execute = AsyncMock(side_effect=execute)

        ops = CronTaskOperations.__new__(CronTaskOperations)
        ops.session = session
        ops.access_query = ContentAccessQuery(session)
        ops._search_indexer = MagicMock()

        agent_ops = MagicMock()
        agent_ops.get_by_id = AsyncMock()
        with patch(
            "uniffy.domains.agents.cron.operations.AgentOperations",
            return_value=agent_ops,
        ):
            await ops.list_cron_tasks(
                user_id=generate_id(),
                organization_id=generate_id(),
                agent_id=agent_id,
            )
        return captured[-1], agent_ops

    async def test_per_agent_listing_is_view_gated_on_the_agent(self) -> None:
        agent_id = generate_id()
        stmt, agent_ops = await self._list(agent_id=agent_id)
        assert agent_id in stmt.compile().params.values()
        agent_ops.get_by_id.assert_awaited_once()

    async def test_both_content_types_are_bound_when_unscoped(self) -> None:
        from uniffy.core.types import ContentType

        stmt, _ = await self._list(agent_id=None)
        values = list(stmt.compile().params.values())
        assert ContentType.AGENT_CRON_TASK in values
        assert ContentType.AGENT in values


class TestCronGetRunsTool:
    async def _execute(self, logs, total=None):
        from uniffy.domains.agents.tools.builtin.cron import _execute_cron_get_runs

        ctx = NS(
            session=MagicMock(),
            user_id=generate_id(),
            organization_id=generate_id(),
            agent_id=generate_id(),
            search_indexer=MagicMock(),
        )
        ops = MagicMock()
        ops.get_run_logs = AsyncMock(return_value=(logs, total if total is not None else len(logs)))
        with patch(
            "uniffy.domains.agents.cron.operations.CronTaskOperations",
            return_value=ops,
        ):
            return await _execute_cron_get_runs(ctx, {"task_id": str(generate_id())})

    async def test_non_empty_history_renders(self) -> None:
        completed = datetime(2026, 7, 24, 12, 0, tzinfo=UTC)
        logs = [
            _log(status="success", duration_ms=120_000, created_at=completed),
            _log(status="error", error="boom", created_at=completed),
        ]

        result = await self._execute(logs)

        assert result.success
        assert "Showing 2 of 2 executions:" in result.data
        # The row is written at completion; the start is completion - duration.
        assert "[success] 2026-07-24 11:58 UTC (10 in / 20 out)" in result.data
        assert "[error] 2026-07-24 12:00 UTC" in result.data
        assert "Error: boom" in result.data

    async def test_pending_row_uses_creation_time(self) -> None:
        created = datetime(2026, 7, 24, 12, 0, tzinfo=UTC)
        log = _log(
            status="pending",
            duration_ms=0,
            input_tokens=0,
            output_tokens=0,
            created_at=created,
        )

        result = await self._execute([log])

        assert result.success
        assert "[pending] 2026-07-24 12:00 UTC (0 in / 0 out)" in result.data

    async def test_empty_history(self) -> None:
        result = await self._execute([])
        assert result.success
        assert result.data == "No execution history found."


class TestStampRunLogs:
    async def _stamp(self):
        from uniffy.domains.agents.cron.jobs.jobs import _stamp_run_logs

        session, captured = _capture_session()
        session_id = generate_id()
        task = NS(id=generate_id(), execution_user_id=generate_id())
        since = datetime.now(UTC)
        stamped = await _stamp_run_logs(session, task, session_id, since)
        return captured[0], task, session_id, since, stamped

    async def test_interactive_row_before_window_is_not_stamped(self) -> None:
        stmt, task, session_id, since, stamped = await self._stamp()
        matches = _criteria_matcher(stmt)
        base = dict(
            session_id=session_id,
            user_id=task.execution_user_id,
            cron_task_id=None,
            kind="chat",
        )
        in_window = since + timedelta(seconds=2)

        interactive_before = _log(**base, created_at=since - timedelta(minutes=3))
        runtime_row = _log(**base, created_at=in_window)

        assert not matches(interactive_before)
        assert matches(runtime_row)
        assert stamped == 1

    async def test_stamp_scoped_to_execution_identity_and_session(self) -> None:
        stmt, task, session_id, since, _ = await self._stamp()
        matches = _criteria_matcher(stmt)
        base = dict(
            session_id=session_id,
            user_id=task.execution_user_id,
            cron_task_id=None,
            kind="chat",
            created_at=since + timedelta(seconds=2),
        )

        assert matches(_log(**base))
        assert not matches(_log(**{**base, "user_id": generate_id()}))
        assert not matches(_log(**{**base, "session_id": generate_id()}))
        assert not matches(_log(**{**base, "cron_task_id": generate_id()}))

    async def test_stamp_sets_cron_task_and_kind(self) -> None:
        stmt, task, _, _, _ = await self._stamp()
        params = stmt.compile().params
        assert params["cron_task_id"] == task.id
        assert params["kind"] == "cron"


class TestSweepStalePendingRuns:
    async def test_only_old_pending_cron_rows_are_swept(self) -> None:
        from uniffy.domains.agents.cron.jobs.jobs import (
            STALE_PENDING_CUTOFF,
            _sweep_stale_pending_runs,
        )

        session, captured = _capture_session()
        swept = await _sweep_stale_pending_runs(session)

        stmt = captured[0]
        matches = _criteria_matcher(stmt)
        now = datetime.now(UTC)
        old = now - STALE_PENDING_CUTOFF - timedelta(minutes=1)

        assert matches(_log(status="pending", kind="cron", created_at=old))
        assert not matches(
            _log(status="pending", kind="cron", created_at=now - timedelta(minutes=1))
        )
        assert not matches(_log(status="success", kind="cron", created_at=old))
        assert not matches(_log(status="pending", kind="chat", created_at=old))
        assert swept == 1

    async def test_sweep_marks_rows_as_error(self) -> None:
        from uniffy.domains.agents.cron.jobs.jobs import _sweep_stale_pending_runs

        session, captured = _capture_session()
        await _sweep_stale_pending_runs(session)

        params = captured[0].compile().params
        assert params["status"] == "error"
        assert params["error"]
