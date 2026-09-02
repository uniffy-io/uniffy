from unittest.mock import AsyncMock, MagicMock

from uniffy.core.jobs import QueueName
from uniffy.vendor.arq.typing import JobRejectionReason
from uniffy.vendor.arq.utils import timestamp_ms
from uniffy.vendor.arq.worker import Worker, func


async def test_expired_job_reports_rejection_without_running_handler() -> None:
    handler_call = AsyncMock()

    async def handler(ctx) -> None:
        await handler_call(ctx)

    pipeline = MagicMock()
    pipeline.__aenter__ = AsyncMock(return_value=pipeline)
    pipeline.__aexit__ = AsyncMock(return_value=None)
    pipeline.execute = AsyncMock(return_value=(None, 1, None))
    pool = MagicMock()
    pool.pipeline.return_value = pipeline
    rejected = AsyncMock()
    worker = Worker(
        [func(handler, name="expired_job")],
        queue_name=QueueName.CORE.valkey_name,
        valkey_pool=pool,
        on_job_rejected=rejected,
        handle_signals=False,
    )
    worker.finish_failed_job = AsyncMock()

    await worker.run_job("expired-job-id", timestamp_ms())

    rejected.assert_awaited_once()
    assert rejected.await_args.kwargs["reason"] is JobRejectionReason.EXPIRED
    handler_call.assert_not_awaited()
    worker.finish_failed_job.assert_awaited_once()
