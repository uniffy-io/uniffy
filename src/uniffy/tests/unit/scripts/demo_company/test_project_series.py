import random

from uniffy.core.models.projects.task import TaskType
from uniffy.scripts.demo_company.project_series import (
    DONE,
    IN_PROGRESS,
    MAX_MINUTES_PER_DAY,
    TODO,
    WORKLOG_WINDOW_DAYS,
    SeriesBuilder,
    _Draft,
)

ALICE = "alice@example.com"
BOB = "bob@example.com"


def _builder(seed: str = "series") -> SeriesBuilder:
    builder = SeriesBuilder.__new__(SeriesBuilder)
    builder.rng = random.Random(seed)
    return builder


def _draft(**overrides) -> _Draft:
    base = {
        "key": "T1",
        "title": "Ship it",
        "task_type": TaskType.TASK,
        "start": -10,
        "due": -3,
        "epic": "Launch",
        "status": DONE,
        "completed": -3,
        "assignees": (ALICE,),
        "estimate": 480,
    }
    base.update(overrides)
    return _Draft(**base)


def test_done_work_lands_between_start_and_completion_in_quarter_hour_chunks() -> None:
    entries = _builder()._worklogs(_draft())

    assert entries
    assert {entry.assignee for entry in entries} == {ALICE}
    assert all(-10 <= entry.day_in_days <= -3 for entry in entries)
    assert all(entry.minutes % 15 == 0 and entry.minutes > 0 for entry in entries)
    assert [entry.day_in_days for entry in entries] == sorted(entry.day_in_days for entry in entries)
    total = sum(entry.minutes for entry in entries)
    assert 480 * 0.6 <= total <= 480 * 1.5


def test_in_progress_work_stops_today_and_stays_below_the_estimate() -> None:
    entries = _builder()._worklogs(_draft(status=IN_PROGRESS, completed=None, due=4))

    assert entries
    assert max(entry.day_in_days for entry in entries) <= 0
    assert sum(entry.minutes for entry in entries) <= 480 * 0.8


def test_old_work_folds_into_the_recent_window() -> None:
    entries = _builder()._worklogs(_draft(start=-200, completed=-150))

    assert entries
    assert min(entry.day_in_days for entry in entries) >= -150 - (WORKLOG_WINDOW_DAYS - 1)
    assert max(entry.day_in_days for entry in entries) <= -150


def test_nothing_to_log_without_an_estimate_an_assignee_or_a_start() -> None:
    builder = _builder()

    assert builder._worklogs(_draft(estimate=None)) == ()
    assert builder._worklogs(_draft(assignees=())) == ()
    assert builder._worklogs(_draft(status=TODO)) == ()


def test_entries_spread_over_every_assignee_and_never_exceed_a_day() -> None:
    entries = _builder("pair")._worklogs(
        _draft(assignees=(ALICE, BOB), estimate=1440 * 3, start=-1, completed=0)
    )

    assert {entry.assignee for entry in entries} == {ALICE, BOB}
    assert all(entry.minutes <= MAX_MINUTES_PER_DAY for entry in entries)
    assert len({(entry.assignee, entry.day_in_days) for entry in entries}) == len(entries)


def test_the_same_slug_renders_the_same_entries() -> None:
    first = _builder("MOB")._worklogs(_draft())
    second = _builder("MOB")._worklogs(_draft())

    assert first == second
