from typing import Any

from uniffy.core.jobs.locks import acquire_owned_job_lock, release_owned_job_lock


class _ExpiringValkey:
    def __init__(self) -> None:
        self.now = 0
        self.values: dict[str, tuple[str, int]] = {}

    def advance(self, seconds: int) -> None:
        self.now += seconds

    def _current(self, key: str) -> str | None:
        entry = self.values.get(key)
        if entry is None:
            return None
        value, expires_at = entry
        if expires_at <= self.now:
            self.values.pop(key)
            return None
        return value

    async def set(
        self,
        key: str,
        value: str,
        *,
        ex: int,
        nx: bool,
    ) -> bool | None:
        if nx and self._current(key) is not None:
            return None
        self.values[key] = (value, self.now + ex)
        return True

    async def eval(self, _script: str, _numkeys: int, key: str, token: str) -> Any:
        if self._current(key) != token:
            return 0
        self.values.pop(key)
        return 1


async def test_lock_is_exclusive_until_its_owner_releases_it() -> None:
    client = _ExpiringValkey()
    owner = await acquire_owned_job_lock(client, "jobs:test", 30)

    assert owner is not None
    assert await acquire_owned_job_lock(client, "jobs:test", 30) is None
    assert await release_owned_job_lock(client, "jobs:test", owner)
    assert await acquire_owned_job_lock(client, "jobs:test", 30) is not None


async def test_expired_owner_cannot_release_its_replacement() -> None:
    client = _ExpiringValkey()
    expired_owner = await acquire_owned_job_lock(client, "jobs:test", 5)
    assert expired_owner is not None

    client.advance(6)
    replacement = await acquire_owned_job_lock(client, "jobs:test", 30)

    assert replacement is not None
    assert replacement != expired_owner
    assert not await release_owned_job_lock(client, "jobs:test", expired_owner)
    assert client._current("jobs:test") == replacement
    assert await release_owned_job_lock(client, "jobs:test", replacement)
