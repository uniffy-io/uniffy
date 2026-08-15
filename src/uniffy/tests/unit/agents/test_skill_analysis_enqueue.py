"""Job-id salting and worker-side quietness debounce for skill analysis."""

from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from typing import Any

from uniffy.core.types import generate_id
from uniffy.domains.agents.sessions.operations import (
    SKILL_ANALYSIS_DEBOUNCE_SECONDS,
    _skill_analysis_job_id,
)
from uniffy.workers.tasks import agent_skill_analysis as task_mod


class TestJobIdSalt:
    def test_job_id_contains_salt(self) -> None:
        dest = generate_id()
        job_id = _skill_analysis_job_id("session", dest, "deadbeef")
        assert job_id == f"analyze_skills:session:{dest}:deadbeef"
        assert "deadbeef" in job_id

    def test_distinct_triggers_produce_distinct_ids(self) -> None:
        dest = generate_id()
        first = _skill_analysis_job_id("session", dest, generate_id().hex)
        second = _skill_analysis_job_id("session", dest, generate_id().hex)
        # Same destination, different trigger -> different job id, so ARQ does
        # not dedupe the second enqueue against the first.
        assert first != second

    def test_kind_and_destination_partition_the_id(self) -> None:
        salt = "abc123"
        dest = generate_id()
        assert _skill_analysis_job_id("session", dest, salt) != _skill_analysis_job_id(
            "channel", dest, salt
        )
        assert _skill_analysis_job_id("session", dest, salt) != _skill_analysis_job_id(
            "session", generate_id(), salt
        )


class TestConversationIsQuiet:
    def test_recent_message_is_not_quiet(self) -> None:
        now = datetime.now(UTC)
        recent = now - timedelta(seconds=SKILL_ANALYSIS_DEBOUNCE_SECONDS - 5)
        assert task_mod._conversation_is_quiet(recent, now, SKILL_ANALYSIS_DEBOUNCE_SECONDS) is False

    def test_old_message_is_quiet(self) -> None:
        now = datetime.now(UTC)
        old = now - timedelta(seconds=SKILL_ANALYSIS_DEBOUNCE_SECONDS + 5)
        assert task_mod._conversation_is_quiet(old, now, SKILL_ANALYSIS_DEBOUNCE_SECONDS) is True

    def test_boundary_is_quiet(self) -> None:
        now = datetime.now(UTC)
        edge = now - timedelta(seconds=SKILL_ANALYSIS_DEBOUNCE_SECONDS)
        assert task_mod._conversation_is_quiet(edge, now, SKILL_ANALYSIS_DEBOUNCE_SECONDS) is True

    def test_no_activity_is_quiet(self) -> None:
        assert (
            task_mod._conversation_is_quiet(None, datetime.now(UTC), SKILL_ANALYSIS_DEBOUNCE_SECONDS)
            is True
        )


class _FakeResult:
    def __init__(self, value: Any) -> None:
        self._value = value

    def scalar(self) -> Any:
        return self._value


class _FakeSession:
    def __init__(self, value: Any) -> None:
        self._value = value
        self.statements: list[Any] = []

    async def execute(self, stmt: Any) -> _FakeResult:
        self.statements.append(stmt)
        return _FakeResult(self._value)


class TestLatestActivityAt:
    async def test_session_destination_returns_scalar(self) -> None:
        ts = datetime.now(UTC)
        session = _FakeSession(ts)
        result = await task_mod._latest_activity_at(session, "session", generate_id())
        assert result is ts
        assert session.statements, "a query must be issued"

    async def test_channel_destination_returns_scalar(self) -> None:
        ts = datetime.now(UTC)
        session = _FakeSession(ts)
        result = await task_mod._latest_activity_at(session, "channel", generate_id())
        assert result is ts


class _FakeOpsClient:
    def __init__(self, *, lock_acquired: bool = True) -> None:
        self._lock_acquired = lock_acquired
        self.delete_calls: list[str] = []

    async def set(self, key: str, value: str, **kwargs: Any) -> bool:
        return self._lock_acquired

    async def delete(self, key: str) -> int:
        self.delete_calls.append(key)
        return 1


def _install_ops_client(monkeypatch) -> _FakeOpsClient:
    client = _FakeOpsClient()
    monkeypatch.setattr(task_mod, "_get_ops_client", lambda: client)
    return client


def _install_open_session(monkeypatch) -> None:
    @asynccontextmanager
    async def fake_open_session():
        yield object()

    monkeypatch.setattr(task_mod, "open_session", fake_open_session)


def _install_latest_activity(monkeypatch, value: datetime | None) -> None:
    async def fake(session: Any, kind: str, dest: Any) -> datetime | None:
        return value

    monkeypatch.setattr(task_mod, "_latest_activity_at", fake)


def _install_enabled_probe(monkeypatch) -> list[bool]:
    calls: list[bool] = []

    async def fake(session: Any, org_id: Any) -> bool:
        calls.append(True)
        return False

    monkeypatch.setattr(task_mod, "is_skill_evolution_enabled", fake)
    return calls


def _ids() -> dict[str, str]:
    return {
        "destination_id": str(generate_id()),
        "user_id": str(generate_id()),
        "agent_id": str(generate_id()),
        "organization_id": str(generate_id()),
    }


class TestTaskQuietnessGate:
    async def test_recent_activity_exits_before_opt_in(self, monkeypatch) -> None:
        _install_ops_client(monkeypatch)
        _install_open_session(monkeypatch)
        _install_latest_activity(monkeypatch, datetime.now(UTC))
        enabled_calls = _install_enabled_probe(monkeypatch)

        result = await task_mod.analyze_session_for_skills(
            ctx={}, destination_kind="session", **_ids()
        )
        assert result == {"status": "skipped", "reason": "still_active"}
        assert enabled_calls == [], "opt-in must not be consulted while still active"

    async def test_quiet_conversation_proceeds_past_the_gate(self, monkeypatch) -> None:
        _install_ops_client(monkeypatch)
        _install_open_session(monkeypatch)
        quiet_ts = datetime.now(UTC) - timedelta(seconds=SKILL_ANALYSIS_DEBOUNCE_SECONDS + 30)
        _install_latest_activity(monkeypatch, quiet_ts)
        enabled_calls = _install_enabled_probe(monkeypatch)

        result = await task_mod.analyze_session_for_skills(
            ctx={}, destination_kind="session", **_ids()
        )
        # Past the quietness gate the task reaches the opt-in probe (stubbed off
        # here), so it stops at "disabled" rather than "still_active".
        assert result == {"status": "skipped", "reason": "disabled"}
        assert enabled_calls == [True], "opt-in probe reached once conversation is quiet"
