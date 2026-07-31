"""Per-call-type screen-share ceiling resolution and org-policy management gating."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from uniffy.core.errors import PermissionDeniedError, ValidationError
from uniffy.core.models.calls import CallType, ScreenShareQuality
from uniffy.core.types import generate_id
from uniffy.domains.calls.policy import ResolvedCallPolicy


def _build_ops():
    from uniffy.domains.calls.config import LiveKitConfig
    from uniffy.domains.calls.operations import CallOperations

    with patch(
        "uniffy.domains.calls.operations.get_livekit_config",
        return_value=LiveKitConfig(
            host="http://livekit:7880", api_key="k", api_secret="s" * 32, ws_url="/livekit"
        ),
    ):
        session = MagicMock()
        session.add = MagicMock()
        session.execute = AsyncMock()
        session.commit = AsyncMock()
        session.refresh = AsyncMock()
        return CallOperations(session)


def _patch_admin(is_admin: bool):
    checker = MagicMock()
    checker.return_value.is_org_admin = AsyncMock(return_value=is_admin)
    return patch("uniffy.domains.calls.operations.PermissionChecker", checker)


async def _resolve(ops, policy, call_type):
    with patch.object(type(ops), "get_org_policy", AsyncMock(return_value=policy)):
        return await ops.resolve_screen_share_ceiling(generate_id(), call_type)


async def test_direct_call_defaults_to_max_without_policy() -> None:
    ops = _build_ops()
    assert await _resolve(ops, None, CallType.DIRECT) == ScreenShareQuality.MAX


async def test_channel_call_defaults_to_env_default_without_policy() -> None:
    ops = _build_ops()
    with patch(
        "uniffy.domains.calls.operations.default_screen_share_quality",
        return_value=ScreenShareQuality.BALANCED,
    ):
        assert await _resolve(ops, None, CallType.CHANNEL) == ScreenShareQuality.BALANCED


async def test_direct_cap_applies_to_direct() -> None:
    ops = _build_ops()
    policy = ResolvedCallPolicy(
        organization_id=generate_id(),
        max_screen_share_quality_direct=int(ScreenShareQuality.HIGH),
    )
    assert await _resolve(ops, policy, CallType.DIRECT) == ScreenShareQuality.HIGH


async def test_channel_cap_does_not_leak_into_direct() -> None:
    ops = _build_ops()
    policy = ResolvedCallPolicy(
        organization_id=generate_id(),
        max_screen_share_quality_channel=int(ScreenShareQuality.BALANCED),
    )
    assert await _resolve(ops, policy, CallType.CHANNEL) == ScreenShareQuality.BALANCED
    # direct is UNSPECIFIED, so it still resolves to its built-in MAX default.
    assert await _resolve(ops, policy, CallType.DIRECT) == ScreenShareQuality.MAX


async def test_group_cap_applies_to_group() -> None:
    ops = _build_ops()
    policy = ResolvedCallPolicy(
        organization_id=generate_id(),
        max_screen_share_quality_group=int(ScreenShareQuality.HIGH),
    )
    assert await _resolve(ops, policy, CallType.GROUP_DM) == ScreenShareQuality.HIGH


async def test_unspecified_per_type_falls_through_to_type_default() -> None:
    ops = _build_ops()
    policy = ResolvedCallPolicy(
        organization_id=generate_id(),
        max_screen_share_quality_direct=int(ScreenShareQuality.UNSPECIFIED),
    )
    assert await _resolve(ops, policy, CallType.DIRECT) == ScreenShareQuality.MAX


async def _update(ops, **overrides):
    kwargs = dict(
        calls_enabled=True,
        max_participants=25,
        max_duration_minutes=120,
        max_screen_share_quality_direct=ScreenShareQuality.MAX,
        max_screen_share_quality_group=ScreenShareQuality.UNSPECIFIED,
        max_screen_share_quality_channel=ScreenShareQuality.BALANCED,
    )
    kwargs.update(overrides)
    return await ops.update_org_policy(generate_id(), generate_id(), **kwargs)


async def test_update_org_policy_rejects_non_admin() -> None:
    ops = _build_ops()
    with _patch_admin(False), pytest.raises(PermissionDeniedError):
        await _update(ops)


async def test_update_org_policy_admin_upserts_per_type_caps_when_absent() -> None:
    ops = _build_ops()
    with _patch_admin(True), patch.object(
        type(ops), "get_org_policy", AsyncMock(return_value=None)
    ):
        policy = await _update(ops, calls_enabled=False)
    assert policy.calls_enabled is False
    assert policy.max_participants == 25
    assert policy.max_screen_share_quality_direct == int(ScreenShareQuality.MAX)
    assert policy.max_screen_share_quality_group == int(ScreenShareQuality.UNSPECIFIED)
    assert policy.max_screen_share_quality_channel == int(ScreenShareQuality.BALANCED)
    ops.session.commit.assert_awaited()


async def test_update_org_policy_validates_bounds() -> None:
    ops = _build_ops()
    with _patch_admin(True), pytest.raises(ValidationError):
        await _update(ops, max_participants=0)


async def test_get_org_policy_view_returns_defaults_when_absent() -> None:
    ops = _build_ops()
    org_id = generate_id()
    with _patch_admin(True), patch.object(
        type(ops), "get_org_policy", AsyncMock(return_value=None)
    ):
        policy = await ops.get_org_policy_view(generate_id(), org_id)
    assert policy.organization_id == org_id
    assert policy.calls_enabled is True
    assert policy.max_screen_share_quality_direct == int(ScreenShareQuality.UNSPECIFIED)
    assert policy.max_screen_share_quality_group == int(ScreenShareQuality.UNSPECIFIED)
    assert policy.max_screen_share_quality_channel == int(ScreenShareQuality.UNSPECIFIED)


async def test_get_org_policy_view_rejects_non_admin() -> None:
    ops = _build_ops()
    with _patch_admin(False), pytest.raises(PermissionDeniedError):
        await ops.get_org_policy_view(generate_id(), generate_id())
