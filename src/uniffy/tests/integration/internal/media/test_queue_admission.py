import pytest

from uniffy.core.types import generate_id
from uniffy.infrastructure.valkey.config import ValkeyConfig
from uniffy.vendor.arq import Retry, create_pool
from uniffy.vendor.arq.constants import in_progress_key_prefix, job_key_prefix, retry_key_prefix
from uniffy.vendor.arq.utils import timestamp_ms
from uniffy.vendor.arq.worker import Worker, func


@pytest.mark.parametrize("count_attempt", [False, True])
async def test_admission_deferrals_preserve_job_until_work_can_start(count_attempt):
    queue = f"test:media-admission:{generate_id()}"
    job_id = str(generate_id())
    attempts = []

    async def handler(ctx):
        attempts.append(ctx["job_try"])
        if len(attempts) <= 6:
            raise Retry(defer=5, count_attempt=count_attempt)

    pool = await create_pool(ValkeyConfig.from_env().to_arq_valkey_settings())
    worker = Worker(
        [func(handler, name="admission")],
        queue_name=queue,
        valkey_pool=pool,
        max_tries=3,
        keep_result=0,
        handle_signals=False,
    )
    try:
        await pool.enqueue_job("admission", _job_id=job_id, _queue_name=queue)
        for _ in range(7 if not count_attempt else 4):
            score = await pool.zscore(queue, job_id)
            assert score is not None
            await worker.run_job(job_id, int(score))
            if await pool.exists(job_key_prefix + job_id):
                assert await pool.zscore(queue, job_id) >= timestamp_ms() + 4500
                assert not await pool.exists(in_progress_key_prefix + job_id)
        assert attempts == ([1] * 7 if not count_attempt else [1, 2, 3])
        assert worker.jobs_complete == (0 if count_attempt else 1)
        assert worker.jobs_failed == (1 if count_attempt else 0)
        assert await pool.zcard(queue) == 0
        assert not await pool.exists(retry_key_prefix + job_id)
    finally:
        await pool.delete(
            queue,
            job_key_prefix + job_id,
            retry_key_prefix + job_id,
            in_progress_key_prefix + job_id,
        )
        await pool.aclose()
