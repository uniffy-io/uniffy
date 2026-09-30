from unittest.mock import AsyncMock, patch

import pytest

from uniffy.core.realtime.adapter import RealtimeRenderConflict
from uniffy.core.realtime.jobs import save_realtime_snapshot
from uniffy.core.types import generate_id
from uniffy.vendor.arq import Retry


async def test_snapshot_job_retries_render_contention() -> None:
    with (
        patch(
            "uniffy.core.realtime.jobs.persist_snapshot",
            new_callable=AsyncMock,
            side_effect=RealtimeRenderConflict("contended"),
        ),
        pytest.raises(Retry),
    ):
        await save_realtime_snapshot(
            {"job_try": 2}, "TASK", str(generate_id()), str(generate_id()), "", ""
        )
