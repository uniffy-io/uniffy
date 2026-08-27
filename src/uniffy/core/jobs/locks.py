"""Ownership-safe Valkey locks for idempotent background jobs."""

from typing import Any, Protocol
from uuid import uuid4


class JobLockClient(Protocol):
    async def set(
        self,
        key: str,
        value: str,
        *,
        ex: int,
        nx: bool,
    ) -> Any: ...

    async def eval(self, script: str, numkeys: int, *args: str) -> Any: ...


_RELEASE_SCRIPT = """
if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
end
return 0
"""


async def acquire_owned_job_lock(
    client: JobLockClient,
    key: str,
    ttl_seconds: int,
) -> str | None:
    token = uuid4().hex
    acquired = await client.set(key, token, ex=ttl_seconds, nx=True)
    return token if acquired else None


async def release_owned_job_lock(
    client: JobLockClient,
    key: str,
    token: str,
) -> bool:
    return bool(await client.eval(_RELEASE_SCRIPT, 1, key, token))
