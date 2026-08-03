"""Monthly RANGE partition maintenance for ``audit_events``.

An INSERT whose ``created_at`` falls outside every partition raises a check
violation that kills the writing transaction, so a missing month takes down
whatever business operation wrote the audit row (login, share, upload). Two
mechanisms keep that from happening: a DEFAULT partition absorbs any write
that outruns provisioning, and this module provisions months ahead of now,
draining anything the default caught into the real partition.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import TYPE_CHECKING

from loguru import logger
from sqlalchemy import text

logger = logger.bind(component="audit.partitions")

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

PARENT_TABLE = "audit_events"
DEFAULT_PARTITION = "audit_events_default"
MONTHS_AHEAD = 3


def month_floor(value: date) -> date:
    return value.replace(day=1)


def next_month(value: date) -> date:
    year = value.year + (1 if value.month == 12 else 0)
    month = 1 if value.month == 12 else value.month + 1
    return date(year, month, 1)


def partition_name(starts: date) -> str:
    return f"{PARENT_TABLE}_{starts.year:04d}_{starts.month:02d}"


def required_bounds(
    today: date, months_ahead: int = MONTHS_AHEAD
) -> list[tuple[date, date]]:
    """``[(from_inclusive, to_exclusive), ...]`` for this month and the next ``months_ahead``."""
    starts = month_floor(today)
    bounds: list[tuple[date, date]] = []
    for _ in range(months_ahead + 1):
        ends = next_month(starts)
        bounds.append((starts, ends))
        starts = ends
    return bounds


async def ensure_audit_partitions(
    session: AsyncSession,
    *,
    today: date | None = None,
    months_ahead: int = MONTHS_AHEAD,
) -> list[str]:
    """Create every missing monthly partition through ``months_ahead``; return the new names."""
    today = today or datetime.now(UTC).date()
    existing = await _existing_partitions(session)

    created: list[str] = []
    for starts, ends in required_bounds(today, months_ahead):
        name = partition_name(starts)
        if name in existing:
            continue
        await _create_partition(session, name, starts, ends)
        created.append(name)
    return created


async def _existing_partitions(session: AsyncSession) -> set[str]:
    result = await session.execute(
        text(
            """
            SELECT child.relname
            FROM pg_inherits
            JOIN pg_class child ON child.oid = pg_inherits.inhrelid
            JOIN pg_class parent ON parent.oid = pg_inherits.inhparent
            WHERE parent.relname = :parent
            """
        ),
        {"parent": PARENT_TABLE},
    )
    return set(result.scalars().all())


async def _create_partition(
    session: AsyncSession, name: str, starts: date, ends: date
) -> None:
    """Attach a partition for ``[starts, ends)``, moving any rows the default caught.

    ``CREATE TABLE ... PARTITION OF`` fails outright when the default partition
    holds rows in the new range, so that case takes the create-move-attach path
    instead. Both run inside the caller's transaction: the rows are never
    outside a partition mid-flight.
    """
    if not await _default_holds_rows(session, starts, ends):
        await session.execute(
            text(
                f"CREATE TABLE {name} PARTITION OF {PARENT_TABLE} "
                f"FOR VALUES FROM ('{starts.isoformat()}') TO ('{ends.isoformat()}')"
            )
        )
        return

    await session.execute(
        text(
            f"CREATE TABLE {name} (LIKE {PARENT_TABLE} "
            "INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)"
        )
    )
    # The append-only trigger rejects the DELETE half of the move otherwise.
    await session.execute(text("SET LOCAL uniffy.audit_maintenance = 'on'"))
    moved = await session.execute(
        text(
            f"""
            WITH drained AS (
                DELETE FROM {DEFAULT_PARTITION}
                WHERE created_at >= '{starts.isoformat()}'
                  AND created_at < '{ends.isoformat()}'
                RETURNING *
            )
            INSERT INTO {name} SELECT * FROM drained
            """
        )
    )
    await session.execute(
        text(
            f"ALTER TABLE {PARENT_TABLE} ATTACH PARTITION {name} "
            f"FOR VALUES FROM ('{starts.isoformat()}') TO ('{ends.isoformat()}')"
        )
    )
    logger.warning(
        f"Drained {moved.rowcount} audit row(s) from {DEFAULT_PARTITION} into {name}"
    )


async def _default_holds_rows(
    session: AsyncSession, starts: date, ends: date
) -> bool:
    exists = await session.execute(
        text("SELECT to_regclass(:name) IS NOT NULL"), {"name": DEFAULT_PARTITION}
    )
    if not exists.scalar():
        return False

    result = await session.execute(
        text(
            f"""
            SELECT EXISTS (
                SELECT 1 FROM {DEFAULT_PARTITION}
                WHERE created_at >= :starts AND created_at < :ends
            )
            """
        ),
        {"starts": starts, "ends": ends},
    )
    return bool(result.scalar())
