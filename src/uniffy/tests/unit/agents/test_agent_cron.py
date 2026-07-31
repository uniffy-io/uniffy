"""Cron tests: task listing access filters, the run-history tool, the worker's
run-log stamping window, and the stale-pending sweep.

Vanilla pytest + ``asyncio.run`` with mocked sessions, matching the repo's
other agents tests. The worker tests capture the UPDATE statement and run its
WHERE clause against in-memory rows via SQLAlchemy's criteria evaluator (the
engine behind ``synchronize_session="evaluate"``), so the filters are asserted
behaviorally without a database.
"""

import asyncio
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from sqlalchemy.orm.evaluator import _EvaluatorCompiler

from uniffy.core.models.agents.run_log import AgentRunLog


def _run(coro):
    return asyncio.run(coro)


def _log(**overrides) -> AgentRunLog:
    defaults = dict(
        session_id=uuid4(),
        agent_id=uuid4(),
        user_id=uuid4(),
        organization_id=uuid4(),
        model="claude",
        kind="cron",
        cron_task_id=uuid4(),
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
    def _list(self, *, agent_id):
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

        agent_ops = MagicMock()
        agent_ops.get_by_id = AsyncMock()
        with patch(
            "uniffy.domains.agents.cron.operations.AgentOperations",
            return_value=agent_ops,
        ):
            _run(
                ops.list_cron_tasks(
                    user_id=uuid4(),
                    organization_id=uuid4(),
                    agent_id=agent_id,
                )
            )
        return captured[-1], agent_ops

    def test_per_agent_listing_applies_the_task_access_filter(self) -> None:
        from uniffy.core.types import ContentType

        agent_id = uuid4()
        stmt, agent_ops = self._list(agent_id=agent_id)
        compiled = stmt.compile()
        sql = str(compiled)

        # The task's own policy gates the row, not merely view access to the agent.
        assert "agents_cron_tasks.owner_id" in sql
        assert "permissions_content_members" in sql
        assert ContentType.AGENT_CRON_TASK in compiled.params.values()
        # The agent narrowing layers on top and is still view-gated.
        assert "agents_cron_tasks.agent_id = " in sql
        assert agent_id in compiled.params.values()
        agent_ops.get_by_id.assert_awaited_once()

    def test_unscoped_listing_filters_tasks_and_agents(self) -> None:
        from uniffy.core.types import ContentType

        stmt, _ = self._list(agent_id=None)
        compiled = stmt.compile()
        sql = str(compiled)

        assert "agents_cron_tasks.owner_id" in sql
        assert "agents_agents.owner_id" in sql
        values = list(compiled.params.values())
        assert ContentType.AGENT_CRON_TASK in values
        assert ContentType.AGENT in values


class TestCronGetRunsTool:
    def _execute(self, logs, total=None):
        from uniffy.domains.agents.tools.builtin.cron import _execute_cron_get_runs

        ctx = NS(
            session=MagicMock(),
            user_id=uuid4(),
            organization_id=uuid4(),
            agent_id=uuid4(),
        )
        ops = MagicMock()
        ops.get_run_logs = AsyncMock(
            return_value=(logs, total if total is not None else len(logs))
        )
        with patch(
            "uniffy.domains.agents.cron.operations.CronTaskOperations",
            return_value=ops,
        ):
            return _run(_execute_cron_get_runs(ctx, {"task_id": str(uuid4())}))

    def test_non_empty_history_renders(self) -> None:
        completed = datetime(2026, 7, 24, 12, 0, tzinfo=UTC)
        logs = [
            _log(status="success", duration_ms=120_000, created_at=completed),
            _log(status="error", error="boom", created_at=completed),
        ]

        result = self._execute(logs)

        assert result.success
        assert "Showing 2 of 2 executions:" in result.data
        # The row is written at completion; the start is completion - duration.
        assert "[success] 2026-07-24 11:58 UTC (10 in / 20 out)" in result.data
        assert "[error] 2026-07-24 12:00 UTC" in result.data
        assert "Error: boom" in result.data

    def test_pending_row_uses_creation_time(self) -> None:
        created = datetime(2026, 7, 24, 12, 0, tzinfo=UTC)
        log = _log(
            status="pending",
            duration_ms=0,
            input_tokens=0,
            output_tokens=0,
            created_at=created,
        )

        result = self._execute([log])

        assert result.success
        assert "[pending] 2026-07-24 12:00 UTC (0 in / 0 out)" in result.data

    def test_empty_history(self) -> None:
        result = self._execute([])
        assert result.success
        assert result.data == "No execution history found."


class TestStampRunLogs:
    def _stamp(self):
        from uniffy.workers.tasks.agent_cron import _stamp_run_logs

        session, captured = _capture_session()
        session_id = uuid4()
        task = NS(id=uuid4(), execution_user_id=uuid4())
        since = datetime.now(UTC)
        stamped = _run(_stamp_run_logs(session, task, session_id, since))
        return captured[0], task, session_id, since, stamped

    def test_interactive_row_before_window_is_not_stamped(self) -> None:
        stmt, task, session_id, since, stamped = self._stamp()
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

    def test_stamp_scoped_to_execution_identity_and_session(self) -> None:
        stmt, task, session_id, since, _ = self._stamp()
        matches = _criteria_matcher(stmt)
        base = dict(
            session_id=session_id,
            user_id=task.execution_user_id,
            cron_task_id=None,
            kind="chat",
            created_at=since + timedelta(seconds=2),
        )

        assert matches(_log(**base))
        assert not matches(_log(**{**base, "user_id": uuid4()}))
        assert not matches(_log(**{**base, "session_id": uuid4()}))
        assert not matches(_log(**{**base, "cron_task_id": uuid4()}))

    def test_stamp_sets_cron_task_and_kind(self) -> None:
        stmt, task, _, _, _ = self._stamp()
        params = stmt.compile().params
        assert params["cron_task_id"] == task.id
        assert params["kind"] == "cron"


class TestSweepStalePendingRuns:
    def test_only_old_pending_cron_rows_are_swept(self) -> None:
        from uniffy.workers.tasks.agent_cron import (
            STALE_PENDING_CUTOFF,
            _sweep_stale_pending_runs,
        )

        session, captured = _capture_session()
        swept = _run(_sweep_stale_pending_runs(session))

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

    def test_sweep_marks_rows_as_error(self) -> None:
        from uniffy.workers.tasks.agent_cron import _sweep_stale_pending_runs

        session, captured = _capture_session()
        _run(_sweep_stale_pending_runs(session))

        params = captured[0].compile().params
        assert params["status"] == "error"
        assert params["error"]
