import pytest

from uniffy.core.realtime.buffer_keys import BufferScope
from uniffy.core.realtime.jobs import (
    CHECKPOINT_SLOTS,
    checkpoint_realtime_document,
    dispatch_realtime_checkpoints,
    maintain_realtime_buffer,
)
from uniffy.core.types import ContentType, generate_id
from uniffy.vendor.arq import Retry


async def test_checkpoint_job_requeues_without_spending_a_try_while_both_slots_are_busy() -> None:
    scope = BufferScope(generate_id(), ContentType.NOTE, generate_id(), "generation", "epoch")

    async with CHECKPOINT_SLOTS, CHECKPOINT_SLOTS:
        with pytest.raises(Retry) as deferred:
            await checkpoint_realtime_document({}, scope.member, "claim")

    assert deferred.value.count_attempt is False
    assert (deferred.value.defer_score or 0) > 0
    assert not CHECKPOINT_SLOTS.locked()


async def test_schedules_skip_while_valkey_is_unreachable(monkeypatch: pytest.MonkeyPatch) -> None:
    # Port 1 refuses at once, so neither schedule can reach a live server.
    monkeypatch.setenv("VALKEY_HOST", "127.0.0.1")
    monkeypatch.setenv("VALKEY_PORT", "1")

    assert await dispatch_realtime_checkpoints({}) == {"enqueued": 0}
    assert await dispatch_realtime_checkpoints({}) == {"enqueued": 0}
    assert await maintain_realtime_buffer({}) == {"documents": 0}
