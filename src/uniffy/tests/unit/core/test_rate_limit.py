from unittest.mock import AsyncMock

import pytest

from uniffy.core import rate_limit
from uniffy.core.errors import RateLimitExceededError


async def test_unavailable_counter_fails_open(monkeypatch) -> None:
    monkeypatch.setattr(rate_limit, "increment_window", AsyncMock(return_value=None))

    await rate_limit.check_rate_limit(key="rl:test", limit=1, window_seconds=60)


async def test_counter_within_limit_is_allowed(monkeypatch) -> None:
    monkeypatch.setattr(rate_limit, "increment_window", AsyncMock(return_value=(1, 42)))

    await rate_limit.check_rate_limit(key="rl:test", limit=1, window_seconds=60)


async def test_counter_over_limit_raises_with_retry_after(monkeypatch) -> None:
    monkeypatch.setattr(rate_limit, "increment_window", AsyncMock(return_value=(2, 42)))

    with pytest.raises(RateLimitExceededError) as exc_info:
        await rate_limit.check_rate_limit(
            key="rl:test",
            limit=1,
            window_seconds=60,
            resource="test requests",
        )

    assert exc_info.value.resource == "test requests"
    assert exc_info.value.retry_after == 42
