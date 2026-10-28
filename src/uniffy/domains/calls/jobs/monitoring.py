"""Periodic operator snapshots keep scrape handlers free of database and network I/O."""

import asyncio
import time
from collections.abc import Awaitable, Callable
from typing import Any

from loguru import logger
from sqlalchemy import func, select

from uniffy.core.models.calls import Call, CallParticipant
from uniffy.domains.calls.config import LiveKitConfigError
from uniffy.domains.calls.metrics import (
    LIVE_CALLS,
    LIVE_PARTICIPANTS,
    PROBE_DURATION,
    PROBE_TIME,
    PROBE_UP,
    SNAPSHOT_TIME,
)
from uniffy.domains.calls.probes import ProbeTarget, probe_media, probe_relay
from uniffy.infrastructure.database.session import open_session

logger = logger.bind(component="calls.jobs.monitoring")
CALLS_MONITORING_TIMEOUT_SECONDS = 30


async def _snapshot() -> None:
    calls = select(func.count()).select_from(Call).where(Call.ended_at.is_(None)).scalar_subquery()
    participants = (
        select(func.count())
        .select_from(CallParticipant)
        .join(Call, Call.id == CallParticipant.call_id)
        .where(Call.ended_at.is_(None), CallParticipant.left_at.is_(None))
        .scalar_subquery()
    )
    async with open_session() as session:
        count_calls, count_participants = (await session.execute(select(calls, participants))).one()
    LIVE_CALLS.set(count_calls)
    LIVE_PARTICIPANTS.set(count_participants)
    SNAPSHOT_TIME.set_to_current_time()


async def _probe(target: ProbeTarget, check: Callable[[], Awaitable[int]]) -> int:
    started = time.monotonic()
    try:
        result = await check()
    except LiveKitConfigError:
        result = 0
        logger.bind(target=target).warning("Call probe configuration failed")
    except Exception as exc:
        result = 0
        logger.bind(target=target, error_type=type(exc).__name__).warning(
            "Call dependency probe failed"
        )
    PROBE_UP.labels(target).set(result)
    PROBE_TIME.labels(target).set_to_current_time()
    PROBE_DURATION.labels(target).observe(time.monotonic() - started)
    return result


async def monitor_calls(ctx: dict[str, Any]) -> dict[str, Any]:
    del ctx
    try:
        async with asyncio.timeout(10):
            await _snapshot()
    except Exception:
        logger.exception("Call metrics snapshot failed")
    results = await asyncio.gather(
        _probe(ProbeTarget.LIVEKIT, probe_media),
        _probe(ProbeTarget.TURN_ALLOCATION, lambda: probe_relay(allocation=True)),
        _probe(ProbeTarget.TURN_LISTENER, lambda: probe_relay(allocation=False)),
    )
    return {target.value: result for target, result in zip(ProbeTarget, results, strict=True)}
