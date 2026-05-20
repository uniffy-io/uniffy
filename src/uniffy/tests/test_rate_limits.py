"""Tests for the agents rate-limit buckets and override plumbing."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from uniffy.core.errors import RateLimitExceededError, ValidationError
from uniffy.core.valkey.rate_limit import (
    AGENT_MSG_AGENT,
    AGENT_MSG_ORG,
    AGENT_MSG_USER,
    ALL_LIMIT_KINDS,
    DEFAULT_LIMITS,
    IMAGE_GEN_ORG,
    IMAGE_GEN_USER,
    LimitConfig,
    check_agent_message_limits,
    check_image_generation_limits,
    check_rate_limit,
    invalidate_overrides_cache,
    resolve_limit,
)


def _counting_client(
    counters: dict[str, int],
    ttl_seconds: int = 30,
) -> MagicMock:
    """Build a MagicMock Valkey client that simulates INCR/EXPIRE/TTL."""
    client = MagicMock()

    async def incr(key: str) -> int:
        counters[key] = counters.get(key, 0) + 1
        return counters[key]

    async def expire(key: str, seconds: int) -> None:
        return None

    async def ttl(key: str) -> int:
        return ttl_seconds

    client.incr = incr
    client.expire = expire
    client.ttl = ttl
    return client


class TestDefaultsAndResolve:
    """Every bucket kind is defined and overrides win over defaults."""

    def test_all_kinds_have_defaults(self) -> None:
        for kind in ALL_LIMIT_KINDS:
            assert kind in DEFAULT_LIMITS
            assert DEFAULT_LIMITS[kind].limit > 0
            assert DEFAULT_LIMITS[kind].window_seconds > 0

    def test_resolve_limit_override_wins(self) -> None:
        overrides = {AGENT_MSG_USER: LimitConfig(limit=5, window_seconds=10)}
        cfg = resolve_limit(AGENT_MSG_USER, overrides)
        assert cfg.limit == 5
        assert cfg.window_seconds == 10

    def test_resolve_limit_falls_back_to_default(self) -> None:
        cfg = resolve_limit(AGENT_MSG_AGENT, {})
        assert cfg == DEFAULT_LIMITS[AGENT_MSG_AGENT]


class TestValkeyUnavailable:
    """Rate limiting degrades gracefully when Valkey is not connected."""

    def test_check_rate_limit_noop_when_client_none(self) -> None:
        with patch("uniffy.core.valkey.rate_limit._get_client", return_value=None):
            asyncio.run(
                check_rate_limit(
                    key="rl:test",
                    limit=1,
                    window_seconds=60,
                    resource="test",
                )
            )

    def test_check_rate_limit_swallows_valkey_errors(self) -> None:
        client = MagicMock()
        client.incr = AsyncMock(side_effect=RuntimeError("valkey oops"))
        with patch("uniffy.core.valkey.rate_limit._get_client", return_value=client):
            asyncio.run(
                check_rate_limit(
                    key="rl:test",
                    limit=1,
                    window_seconds=60,
                    resource="test",
                )
            )


class TestBucketIsolation:
    """Text and image buckets use distinct Valkey keys."""

    def test_agent_message_uses_three_separate_buckets(self) -> None:
        counters: dict[str, int] = {}
        client = _counting_client(counters)
        session = MagicMock()
        user_id = uuid4()
        org_id = uuid4()
        agent_id = uuid4()

        async def run() -> None:
            with (
                patch(
                    "uniffy.core.valkey.rate_limit._get_client", return_value=client
                ),
                patch(
                    "uniffy.core.valkey.rate_limit.load_org_overrides",
                    AsyncMock(return_value={}),
                ),
            ):
                await check_agent_message_limits(
                    session,
                    user_id=user_id,
                    organization_id=org_id,
                    agent_id=agent_id,
                )

        asyncio.run(run())
        assert f"rl:agent_msg:user:{user_id}" in counters
        assert f"rl:agent_msg:org:{org_id}" in counters
        assert f"rl:agent_msg:agent:{user_id}:{agent_id}" in counters

    def test_image_generation_does_not_touch_text_buckets(self) -> None:
        counters: dict[str, int] = {}
        client = _counting_client(counters)
        session = MagicMock()
        user_id = uuid4()
        org_id = uuid4()

        async def run() -> None:
            with (
                patch(
                    "uniffy.core.valkey.rate_limit._get_client", return_value=client
                ),
                patch(
                    "uniffy.core.valkey.rate_limit.load_org_overrides",
                    AsyncMock(return_value={}),
                ),
            ):
                await check_image_generation_limits(
                    session,
                    user_id=user_id,
                    organization_id=org_id,
                )

        asyncio.run(run())
        assert f"rl:image_gen:user:{user_id}" in counters
        assert f"rl:image_gen:org:{org_id}" in counters
        assert not any(k.startswith("rl:agent_msg") for k in counters)


class TestOverrideApplied:
    """Per-org overrides win over module defaults when present."""

    def test_override_shrinks_limit(self) -> None:
        counters: dict[str, int] = {}
        client = _counting_client(counters)
        session = MagicMock()
        user_id = uuid4()
        org_id = uuid4()
        agent_id = uuid4()

        # Tight override: 1 message per 60s per user.
        override = {AGENT_MSG_USER: LimitConfig(limit=1, window_seconds=60)}

        async def run() -> None:
            with (
                patch(
                    "uniffy.core.valkey.rate_limit._get_client", return_value=client
                ),
                patch(
                    "uniffy.core.valkey.rate_limit.load_org_overrides",
                    AsyncMock(return_value=override),
                ),
            ):
                # First call OK
                await check_agent_message_limits(
                    session,
                    user_id=user_id,
                    organization_id=org_id,
                    agent_id=agent_id,
                )
                # Second call on the same user bucket trips immediately.
                with pytest.raises(RateLimitExceededError) as excinfo:
                    await check_agent_message_limits(
                        session,
                        user_id=user_id,
                        organization_id=org_id,
                        agent_id=agent_id,
                    )
                assert "per user" in excinfo.value.resource
                assert excinfo.value.limit == 1

        asyncio.run(run())


class TestRetryAfter:
    """RateLimitExceededError carries the window TTL so callers can back off."""

    def test_retry_after_populated_from_ttl(self) -> None:
        client = _counting_client({}, ttl_seconds=42)

        async def run() -> None:
            with patch(
                "uniffy.core.valkey.rate_limit._get_client", return_value=client
            ):
                await check_rate_limit(
                    key="rl:retry_test",
                    limit=1,
                    window_seconds=60,
                    resource="test",
                )
                with pytest.raises(RateLimitExceededError) as excinfo:
                    await check_rate_limit(
                        key="rl:retry_test",
                        limit=1,
                        window_seconds=60,
                        resource="test",
                    )
                assert excinfo.value.retry_after == 42

        asyncio.run(run())


class TestCacheInvalidation:
    def test_invalidate_all(self) -> None:
        invalidate_overrides_cache()  # no orgs, no-op

    def test_invalidate_single_org(self) -> None:
        invalidate_overrides_cache(uuid4())  # non-existent, no-op


class TestRateLimitsOperationsValidation:
    """Input validation on RateLimitsOperations.upsert."""

    def _make_ops(self):
        from uniffy.domains.agents.rate_limits.operations import RateLimitsOperations

        session = MagicMock()
        ops = RateLimitsOperations(session)
        ops._org_ops = MagicMock()
        ops._org_ops.require_org_admin = AsyncMock(return_value=None)
        return ops

    def test_unknown_kind_rejected(self) -> None:
        ops = self._make_ops()

        async def run() -> None:
            with pytest.raises(ValidationError):
                await ops.upsert(
                    user_id=uuid4(),
                    organization_id=uuid4(),
                    kind="NOT_A_KIND",
                    limit=10,
                    window_seconds=60,
                )

        asyncio.run(run())

    def test_limit_zero_rejected(self) -> None:
        ops = self._make_ops()

        async def run() -> None:
            with pytest.raises(ValidationError):
                await ops.upsert(
                    user_id=uuid4(),
                    organization_id=uuid4(),
                    kind=AGENT_MSG_USER,
                    limit=0,
                    window_seconds=60,
                )

        asyncio.run(run())

    def test_window_too_large_rejected(self) -> None:
        ops = self._make_ops()

        async def run() -> None:
            with pytest.raises(ValidationError):
                await ops.upsert(
                    user_id=uuid4(),
                    organization_id=uuid4(),
                    kind=AGENT_MSG_USER,
                    limit=10,
                    window_seconds=999_999,
                )

        asyncio.run(run())


class TestConverters:
    """Proto round-trip for RateLimitKind and RateLimitRow."""

    def test_kind_round_trip_all_values(self) -> None:
        from uniffy.domains.agents.rate_limits.converters import (
            rate_limit_kind_from_proto,
            rate_limit_kind_to_proto,
        )

        for kind in (
            AGENT_MSG_USER,
            AGENT_MSG_ORG,
            AGENT_MSG_AGENT,
            IMAGE_GEN_USER,
            IMAGE_GEN_ORG,
        ):
            proto = rate_limit_kind_to_proto(kind)
            assert rate_limit_kind_from_proto(proto) == kind

    def test_unspecified_returns_none(self) -> None:
        from uniffy_proto.common.v1.common_pb2 import RATE_LIMIT_KIND_UNSPECIFIED

        from uniffy.domains.agents.rate_limits.converters import (
            rate_limit_kind_from_proto,
        )

        assert rate_limit_kind_from_proto(RATE_LIMIT_KIND_UNSPECIFIED) is None

    def test_row_to_proto_default_row(self) -> None:
        from uniffy.domains.agents.rate_limits.converters import rate_limit_row_to_proto
        from uniffy.domains.agents.rate_limits.operations import RateLimitRow

        row = RateLimitRow(
            kind=AGENT_MSG_USER,
            limit=30,
            window_seconds=60,
            is_override=False,
        )
        msg = rate_limit_row_to_proto(row)
        assert msg.limit == 30
        assert msg.window_seconds == 60
        assert msg.is_override is False
