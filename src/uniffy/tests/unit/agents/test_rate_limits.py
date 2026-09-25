"""Tests for the agents rate-limit buckets and override plumbing."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from uniffy.core.errors import ValidationError
from uniffy.core.types import generate_id
from uniffy.domains.agents.limits.policy import (
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
    invalidate_overrides_cache,
    resolve_limit,
)


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


class TestBucketIsolation:
    """Text and image buckets use distinct Valkey keys."""

    async def test_agent_message_uses_three_separate_buckets(self) -> None:
        check = AsyncMock()
        session = MagicMock()
        user_id = generate_id()
        org_id = generate_id()
        agent_id = generate_id()

        async def run() -> None:
            with (
                patch("uniffy.domains.agents.limits.policy.check_rate_limit", check),
                patch(
                    "uniffy.domains.agents.limits.policy.load_org_overrides",
                    AsyncMock(return_value={}),
                ),
            ):
                await check_agent_message_limits(
                    session,
                    user_id=user_id,
                    organization_id=org_id,
                    agent_id=agent_id,
                )

        await run()
        keys = {call.kwargs["key"] for call in check.await_args_list}
        assert keys == {
            f"rl:agent_msg:user:{user_id}",
            f"rl:agent_msg:org:{org_id}",
            f"rl:agent_msg:agent:{user_id}:{agent_id}",
        }

    async def test_image_generation_does_not_touch_text_buckets(self) -> None:
        check = AsyncMock()
        session = MagicMock()
        user_id = generate_id()
        org_id = generate_id()

        async def run() -> None:
            with (
                patch("uniffy.domains.agents.limits.policy.check_rate_limit", check),
                patch(
                    "uniffy.domains.agents.limits.policy.load_org_overrides",
                    AsyncMock(return_value={}),
                ),
            ):
                await check_image_generation_limits(
                    session,
                    user_id=user_id,
                    organization_id=org_id,
                )

        await run()
        keys = {call.kwargs["key"] for call in check.await_args_list}
        assert keys == {
            f"rl:image_gen:user:{user_id}",
            f"rl:image_gen:org:{org_id}",
        }


class TestOverrideApplied:
    async def test_override_is_passed_to_shared_policy(self) -> None:
        check = AsyncMock()
        session = MagicMock()
        user_id = generate_id()
        org_id = generate_id()
        agent_id = generate_id()

        override = {AGENT_MSG_USER: LimitConfig(limit=1, window_seconds=60)}

        async def run() -> None:
            with (
                patch("uniffy.domains.agents.limits.policy.check_rate_limit", check),
                patch(
                    "uniffy.domains.agents.limits.policy.load_org_overrides",
                    AsyncMock(return_value=override),
                ),
            ):
                await check_agent_message_limits(
                    session,
                    user_id=user_id,
                    organization_id=org_id,
                    agent_id=agent_id,
                )

        await run()
        user_call = next(
            call
            for call in check.await_args_list
            if call.kwargs["key"].startswith("rl:agent_msg:user")
        )
        assert user_call.kwargs["limit"] == 1
        assert user_call.kwargs["window_seconds"] == 60


class TestCacheInvalidation:
    def test_invalidate_all(self) -> None:
        invalidate_overrides_cache()  # no orgs, no-op

    def test_invalidate_single_org(self) -> None:
        invalidate_overrides_cache(generate_id())  # non-existent, no-op


class TestRateLimitsOperationsValidation:
    """Input validation on RateLimitsOperations.upsert."""

    def _make_ops(self):
        from uniffy.domains.agents.limits.operations import RateLimitsOperations

        session = MagicMock()
        ops = RateLimitsOperations(session)
        ops._org_ops = MagicMock()
        ops._org_ops.require_org_admin = AsyncMock(return_value=None)
        return ops

    async def test_unknown_kind_rejected(self) -> None:
        ops = self._make_ops()

        async def run() -> None:
            with pytest.raises(ValidationError):
                await ops.upsert(
                    user_id=generate_id(),
                    organization_id=generate_id(),
                    kind="NOT_A_KIND",
                    limit=10,
                    window_seconds=60,
                )

        await run()

    async def test_limit_zero_rejected(self) -> None:
        ops = self._make_ops()

        async def run() -> None:
            with pytest.raises(ValidationError):
                await ops.upsert(
                    user_id=generate_id(),
                    organization_id=generate_id(),
                    kind=AGENT_MSG_USER,
                    limit=0,
                    window_seconds=60,
                )

        await run()

    async def test_window_too_large_rejected(self) -> None:
        ops = self._make_ops()

        async def run() -> None:
            with pytest.raises(ValidationError):
                await ops.upsert(
                    user_id=generate_id(),
                    organization_id=generate_id(),
                    kind=AGENT_MSG_USER,
                    limit=10,
                    window_seconds=999_999,
                )

        await run()


class TestConverters:
    """Proto round-trip for RateLimitKind and RateLimitRow."""

    def test_kind_round_trip_all_values(self) -> None:
        from uniffy.domains.agents.limits.converters import (
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
        from uniffy_proto.common.v1.common_pb import RateLimitKind as _ProtoRateLimitKind

        from uniffy.domains.agents.limits.converters import (
            rate_limit_kind_from_proto,
        )

        assert rate_limit_kind_from_proto(_ProtoRateLimitKind.UNSPECIFIED) is None

    def test_row_to_proto_default_row(self) -> None:
        from uniffy.domains.agents.limits.converters import rate_limit_row_to_proto
        from uniffy.domains.agents.limits.operations import RateLimitRow

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
