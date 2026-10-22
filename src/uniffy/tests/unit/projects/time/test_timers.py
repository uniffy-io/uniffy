import pytest

from uniffy.domains.projects.time.timers import round_minutes

ONE_HOUR_33_MINUTES_40_SECONDS = 1 * 3600 + 33 * 60 + 40


@pytest.mark.parametrize(
    ("seconds", "increment", "expected"),
    [
        (ONE_HOUR_33_MINUTES_40_SECONDS, 5, 95),
        (ONE_HOUR_33_MINUTES_40_SECONDS, 1, 94),
        (ONE_HOUR_33_MINUTES_40_SECONDS, 6, 96),
        (ONE_HOUR_33_MINUTES_40_SECONDS, 10, 90),
        (ONE_HOUR_33_MINUTES_40_SECONDS, 15, 90),
        # Under one increment produces one increment.
        (20, 5, 5),
        (0, 1, 1),
        (0, 15, 15),
        # Exactly half an increment rounds up.
        (150, 5, 5),
        (30, 1, 1),
        (29, 1, 1),
        (90, 1, 2),
        # Whole increments stay put.
        (600, 10, 10),
        (3600, 15, 60),
    ],
)
def test_round_minutes_rounds_half_up_with_a_floor_of_one_increment(
    seconds: int, increment: int, expected: int
) -> None:
    assert round_minutes(seconds, increment) == expected


def test_round_minutes_rejects_a_non_positive_increment() -> None:
    with pytest.raises(ValueError, match="increment"):
        round_minutes(60, 0)


from contextlib import ExitStack  # noqa: E402
from datetime import UTC, date, datetime, timedelta  # noqa: E402
from types import SimpleNamespace  # noqa: E402
from unittest.mock import AsyncMock, MagicMock, patch  # noqa: E402
from uuid import uuid4  # noqa: E402

from uniffy.core.errors import NotFoundError, ValidationError  # noqa: E402
from uniffy.core.events.realtime import NotificationPayloadType  # noqa: E402
from uniffy.core.models.projects.timer import Timer, TimerPauseReason  # noqa: E402
from uniffy.core.models.projects.worklog import WorklogSource  # noqa: E402
from uniffy.core.types import NotificationType  # noqa: E402
from uniffy.domains.projects.time.policy import ResolvedTimePolicy  # noqa: E402
from uniffy.domains.projects.time.timers import (  # noqa: E402
    TimerOperations,
    elapsed_seconds,
    pause_timers_past_limit,
)
from uniffy.domains.projects.time.worklogs import WorklogRow  # noqa: E402

ORG = uuid4()
ACTOR = uuid4()
TASK_ID = uuid4()
OTHER_TASK_ID = uuid4()
PROJECT_ID = uuid4()
TODAY = datetime.now(UTC).date()
NOW = datetime(2026, 10, 22, 12, 0, tzinfo=UTC)
MODULE = "uniffy.domains.projects.time.timers"


def _timer(
    *,
    task_id=TASK_ID,  # noqa: ANN001
    started_at: datetime | None = NOW - timedelta(seconds=90),
    accumulated: int = 0,
    pause_reason: TimerPauseReason | None = None,
    organization_id=ORG,  # noqa: ANN001
) -> Timer:
    return Timer(
        id=uuid4(),
        organization_id=organization_id,
        user_id=ACTOR,
        task_id=task_id,
        description="Pairing",
        started_at=started_at,
        accumulated_seconds=accumulated,
        pause_reason=pause_reason,
        created_at=NOW - timedelta(hours=2),
        updated_at=NOW - timedelta(hours=2),
    )


def _row(timer: Timer) -> tuple:
    return (timer, PROJECT_ID, "mob", "Home feed", 169)


class _Session:
    """Answers the timer lookup from a queue of rows and the rollup read with a fixed value."""

    def __init__(self, rows: list, rollup: int = 105) -> None:
        self.rows = list(rows)
        self.rollup = rollup
        self.added: list = []
        self.deleted: list = []
        self.events: list[str] = []
        self.statements: list = []

    async def execute(self, stmt):  # noqa: ANN001 - SQLAlchemy statement
        self.statements.append(stmt)
        sql = str(stmt.compile(compile_kwargs={"literal_binds": True})).lower()
        result = MagicMock()
        if "projects_tasks.time_spent_minutes" in sql and "projects_timers" not in sql:
            result.scalar_one.return_value = self.rollup
        elif self.rows:
            current = self.rows.pop(0)
            result.first.return_value = current[0] if isinstance(current, list) else current
            result.all.return_value = current if isinstance(current, list) else [current]
        else:
            result.first.return_value = None
            result.all.return_value = []
        return result

    def add(self, obj) -> None:  # noqa: ANN001
        self.added.append(obj)

    async def delete(self, obj) -> None:  # noqa: ANN001
        self.deleted.append(obj)

    async def flush(self) -> None:
        return None

    async def commit(self) -> None:
        self.events.append("commit")


def _env(rows: list, *, policy: ResolvedTimePolicy | None = None, rollup: int = 105) -> ExitStack:
    stack = ExitStack()
    session = _Session(rows, rollup=rollup)
    access = MagicMock()
    access.require_active_actor = AsyncMock()
    access.require_task_view = AsyncMock(
        return_value=SimpleNamespace(id=TASK_ID, project_id=PROJECT_ID)
    )
    worklogs = MagicMock()
    staged = WorklogRow(worklog=SimpleNamespace(task_id=TASK_ID), project_id=PROJECT_ID)
    worklogs.stage_create = AsyncMock(return_value=(staged, 150))
    notify = AsyncMock(side_effect=lambda *_: session.events.append("timer_changed"))
    content = AsyncMock(side_effect=lambda *_: session.events.append("content_changed"))
    emitted = AsyncMock()
    stack.enter_context(
        patch(
            f"{MODULE}.load_time_policy",
            new=AsyncMock(return_value=policy or ResolvedTimePolicy(organization_id=ORG)),
        )
    )
    stack.enter_context(patch(f"{MODULE}.TimeAccess", return_value=access))
    stack.enter_context(patch(f"{MODULE}.WorklogOperations", return_value=worklogs))
    stack.enter_context(patch(f"{MODULE}.publish_notification", new=notify))
    stack.enter_context(patch(f"{MODULE}.publish_content_changed", new=content))
    stack.enter_context(patch(f"{MODULE}.emit_notification", new=emitted))
    stack.env = SimpleNamespace(  # type: ignore[attr-defined]
        session=session,
        access=access,
        worklogs=worklogs,
        notify=notify,
        content=content,
        emitted=emitted,
        ops=TimerOperations(session),  # type: ignore[arg-type]
    )
    return stack


def test_elapsed_adds_the_running_segment_to_the_finished_ones() -> None:
    running = _timer(accumulated=30)
    assert elapsed_seconds(running, NOW) == 120
    paused = _timer(started_at=None, accumulated=30)
    assert elapsed_seconds(paused, NOW) == 30


async def test_start_without_a_timer_adds_one_commits_and_tells_the_owner() -> None:
    fresh = _timer()
    with _env([None, _row(fresh)]) as stack:
        env = stack.env
        row, replaced = await env.ops.start(ACTOR, ORG, TASK_ID, work_date=TODAY, description="x")
    assert replaced is None
    assert row.timer is fresh
    added = env.session.added[0]
    assert (added.task_id, added.description, added.accumulated_seconds) == (TASK_ID, "x", 0)
    assert added.started_at is not None
    env.worklogs.stage_create.assert_not_awaited()
    assert env.session.events == ["commit", "timer_changed"]
    assert env.notify.await_args.args[1]["_type"] == NotificationPayloadType.TIMER_CHANGED


async def test_start_stops_the_running_timer_into_a_timer_worklog_in_the_same_transaction() -> None:
    running = _timer(
        task_id=OTHER_TASK_ID, accumulated=600, started_at=datetime.now(UTC) - timedelta(seconds=90)
    )
    fresh = _timer()
    policy = ResolvedTimePolicy(organization_id=ORG, timer_rounding_minutes=5)
    with _env([_row(running), _row(fresh)], policy=policy) as stack:
        env = stack.env
        row, replaced = await env.ops.start(ACTOR, ORG, TASK_ID, work_date=TODAY)
    assert replaced is not None and replaced.task_id == OTHER_TASK_ID
    assert replaced.task_time_spent_minutes == 150
    assert env.session.deleted == [running]
    kwargs = env.worklogs.stage_create.await_args.kwargs
    assert kwargs["source"] is WorklogSource.TIMER
    assert kwargs["started_at"] == running.created_at
    assert kwargs["work_date"] == TODAY
    assert kwargs["description"] == "Pairing"
    # 600s plus a running segment of roughly 90s is about 11.5 minutes: 10 at a 5-minute rounding.
    assert kwargs["duration_minutes"] in (10, 15)
    assert env.session.events == ["commit", "timer_changed", "content_changed"]
    assert row.timer is fresh


async def test_pause_folds_the_running_segment_and_refuses_a_second_pause() -> None:
    running = _timer(accumulated=30, started_at=datetime.now(UTC) - timedelta(seconds=90))
    with _env([_row(running)]) as stack:
        row = await stack.env.ops.pause(ACTOR, ORG)
    assert row.timer.started_at is None
    assert row.timer.paused_at is not None
    assert row.timer.pause_reason is None
    assert 115 <= row.timer.accumulated_seconds <= 130  # noqa: PLR2004

    paused = _timer(started_at=None, accumulated=120)
    with _env([_row(paused)]) as stack, pytest.raises(ValidationError, match="already paused"):
        await stack.env.ops.pause(ACTOR, ORG)


async def test_resume_restarts_the_segment_and_keeps_the_limit_mark() -> None:
    paused = _timer(started_at=None, accumulated=120, pause_reason=TimerPauseReason.LIMIT)
    with _env([_row(paused)]) as stack:
        row = await stack.env.ops.resume(ACTOR, ORG)
    assert row.timer.started_at is not None
    assert row.timer.paused_at is None
    assert row.timer.accumulated_seconds == 120  # noqa: PLR2004
    assert row.timer.pause_reason is TimerPauseReason.LIMIT

    running = _timer()
    with _env([_row(running)]) as stack, pytest.raises(ValidationError, match="already running"):
        await stack.env.ops.resume(ACTOR, ORG)


async def test_stop_rounds_the_elapsed_time_by_the_policy_unless_corrected() -> None:
    paused = _timer(started_at=None, accumulated=5600)
    policy = ResolvedTimePolicy(organization_id=ORG, timer_rounding_minutes=5)
    with _env([_row(paused)], policy=policy) as stack:
        env = stack.env
        result = await env.ops.stop(ACTOR, ORG, work_date=TODAY)
    assert result.worklog is not None
    assert result.task_time_spent_minutes == 150  # noqa: PLR2004
    kwargs = env.worklogs.stage_create.await_args.kwargs
    assert kwargs["duration_minutes"] == 95  # noqa: PLR2004
    assert kwargs["description"] == "Pairing"
    assert env.session.deleted == [paused]
    assert env.session.events == ["commit", "timer_changed", "content_changed"]

    with _env([_row(_timer(started_at=None, accumulated=5600))], policy=policy) as stack:
        env = stack.env
        await env.ops.stop(ACTOR, ORG, work_date=TODAY, duration_minutes=30, description="Fixed")
    kwargs = env.worklogs.stage_create.await_args.kwargs
    assert (kwargs["duration_minutes"], kwargs["description"]) == (30, "Fixed")


async def test_stop_with_discard_drops_the_timer_and_writes_nothing() -> None:
    running = _timer()
    with _env([_row(running)], rollup=105) as stack:
        env = stack.env
        result = await env.ops.stop(ACTOR, ORG, work_date=None, discard=True)
    assert result.worklog is None
    assert result.task_time_spent_minutes == 105  # noqa: PLR2004
    env.worklogs.stage_create.assert_not_awaited()
    assert env.session.deleted == [running]
    assert env.session.events == ["commit", "timer_changed"]


async def test_stop_needs_a_day_unless_discarding_and_a_timer_to_stop() -> None:
    with _env([_row(_timer())]) as stack, pytest.raises(ValidationError, match="day"):
        await stack.env.ops.stop(ACTOR, ORG, work_date=None)
    with _env([None]) as stack, pytest.raises(NotFoundError):
        await stack.env.ops.stop(ACTOR, ORG, work_date=TODAY)


async def test_get_active_checks_the_actor_and_reads_nothing_when_absent() -> None:
    with _env([None]) as stack:
        env = stack.env
        assert await env.ops.get_active(ACTOR, ORG) is None
    env.access.require_active_actor.assert_awaited_once_with(ACTOR, ORG)


async def test_limit_pause_applies_once_and_notifies_the_owner() -> None:
    over = _timer(started_at=NOW - timedelta(hours=13), task_id=TASK_ID)
    under = _timer(started_at=NOW - timedelta(hours=1), task_id=OTHER_TASK_ID)
    rows = [[(over, "Home feed"), (under, "Other")]]
    with _env(rows) as stack:
        env = stack.env
        count = await pause_timers_past_limit(env.session, now=NOW)  # type: ignore[arg-type]
    assert count == 1
    assert over.started_at is None
    assert over.pause_reason is TimerPauseReason.LIMIT
    assert over.accumulated_seconds == 13 * 3600  # noqa: PLR2004
    assert under.started_at is not None
    assert env.session.events == ["commit", "timer_changed"]
    event = env.emitted.await_args.args[0]
    assert event.notification_type is NotificationType.TIMER_LIMIT_REACHED
    assert event.target_user_ids == [ACTOR]
    assert "12h" in event.title and "Home feed" in event.title
    lookup = str(env.session.statements[0].compile()).lower()
    assert "projects_timers.started_at is not null" in lookup
    assert "projects_timers.pause_reason is null" in lookup

    # The same rows again: the paused timer is skipped, nothing is sent twice.
    with _env([[(over, "Home feed"), (under, "Other")]]) as stack:
        env = stack.env
        assert await pause_timers_past_limit(env.session, now=NOW) == 0  # type: ignore[arg-type]
    env.emitted.assert_not_awaited()
    assert env.session.events == []
