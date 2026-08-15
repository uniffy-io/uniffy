"""Roll-forward provisioning for the ``audit_events`` monthly partitions."""

from datetime import date
from types import SimpleNamespace

from uniffy.core.audit import partitions
from uniffy.core.audit.partitions import (
    ensure_audit_partitions,
    next_month,
    partition_name,
    required_bounds,
)


class _RecordingSession:
    """Captures the DDL text ``ensure_audit_partitions`` emits."""

    def __init__(self) -> None:
        self.statements: list[str] = []

    async def execute(self, statement, params=None):
        del params
        self.statements.append(str(statement))
        return SimpleNamespace(rowcount=0)


def test_next_month_rolls_over_december() -> None:
    assert next_month(date(2026, 12, 1)) == date(2027, 1, 1)


def test_partition_name_is_zero_padded() -> None:
    assert partition_name(date(2026, 8, 1)) == "audit_events_2026_08"


def test_required_bounds_covers_current_month_plus_lookahead() -> None:
    bounds = required_bounds(date(2026, 11, 17), months_ahead=3)
    assert bounds == [
        (date(2026, 11, 1), date(2026, 12, 1)),
        (date(2026, 12, 1), date(2027, 1, 1)),
        (date(2027, 1, 1), date(2027, 2, 1)),
        (date(2027, 2, 1), date(2027, 3, 1)),
    ]


def test_required_bounds_are_contiguous() -> None:
    bounds = required_bounds(date(2026, 8, 2))
    for (_, ends), (next_starts, _) in zip(bounds, bounds[1:], strict=False):
        assert ends == next_starts


async def test_ensure_creates_only_the_missing_months(monkeypatch) -> None:
    monkeypatch.setattr(
        partitions,
        "_existing_partitions",
        lambda session: _async({"audit_events_2026_08", "audit_events_2026_09"}),
    )
    monkeypatch.setattr(
        partitions, "_default_holds_rows", lambda session, starts, ends: _async(False)
    )

    session = _RecordingSession()
    created = await ensure_audit_partitions(session, today=date(2026, 8, 2), months_ahead=3)

    assert created == ["audit_events_2026_10", "audit_events_2026_11"]
    assert len(session.statements) == 2
    assert "PARTITION OF audit_events" in session.statements[0]
    assert "FROM ('2026-10-01') TO ('2026-11-01')" in session.statements[0]


async def test_ensure_drains_the_default_partition_when_it_holds_rows(
    monkeypatch,
) -> None:
    monkeypatch.setattr(partitions, "_existing_partitions", lambda session: _async(set()))
    monkeypatch.setattr(
        partitions,
        "_default_holds_rows",
        lambda session, starts, ends: _async(starts == date(2026, 8, 1)),
    )

    session = _RecordingSession()
    created = await ensure_audit_partitions(session, today=date(2026, 8, 2), months_ahead=1)

    assert created == ["audit_events_2026_08", "audit_events_2026_09"]
    august = session.statements[:4]
    assert "LIKE audit_events" in august[0]
    # The move must opt out of the append-only trigger before it deletes.
    assert "SET LOCAL uniffy.audit_maintenance = 'on'" in august[1]
    assert "DELETE FROM audit_events_default" in august[2]
    assert "ATTACH PARTITION audit_events_2026_08" in august[3]
    assert "PARTITION OF audit_events" in session.statements[4]


def _async(value):
    async def _run():
        return value

    return _run()
