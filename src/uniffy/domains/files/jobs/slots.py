"""Owned global encode leases release core capacity when busy."""

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress

from loguru import logger

from uniffy.core.jobs.locks import acquire_owned_job_lock, release_owned_job_lock
from uniffy.domains.files.jobs.settings import MEDIA_SETTINGS
from uniffy.infrastructure.valkey.ops import get_ops_client

logger = logger.bind(component="files.jobs.slots")

_LEASE_SECONDS = 90
_RENEW_SCRIPT = """
if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('expire', KEYS[1], ARGV[2])
end
return 0
"""


@asynccontextmanager
async def media_slot() -> AsyncIterator[bool]:
    client = get_ops_client()
    if client is None:
        yield False
        return
    token = None
    key = ""
    try:
        async with asyncio.timeout(2):
            for index in range(MEDIA_SETTINGS.max_concurrent):
                key = f"media:encode:slot:{index}"
                token = await acquire_owned_job_lock(client, key, _LEASE_SECONDS)
                if token:
                    break
    except Exception:
        logger.opt(exception=True).warning("Media slot acquisition unavailable")
    if not token:
        yield False
        return
    owner = asyncio.current_task()

    async def renew() -> None:
        try:
            while True:
                await asyncio.sleep(20)
                async with asyncio.timeout(2):
                    renewed = await client.eval(_RENEW_SCRIPT, 1, key, token, str(_LEASE_SECONDS))
                if not renewed:
                    raise RuntimeError("Media lease lost")
        except Exception:
            logger.opt(exception=True).warning("Stopping media work after lease loss")
            owner.cancel()

    heartbeat = asyncio.create_task(renew())
    try:
        yield True
    finally:
        heartbeat.cancel()
        with suppress(asyncio.CancelledError):
            await heartbeat
        try:
            async with asyncio.timeout(2):
                await release_owned_job_lock(client, key, token)
        except Exception:
            logger.opt(exception=True).warning("Media slot release failed")
