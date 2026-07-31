"""Per-call-type screen-share ceiling resolution and org-policy management gating."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from uniffy.core.errors import PermissionDeniedError, ValidationError
from uniffy.core.models.calls import CallType, ScreenShareQuality
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


def _resolve(ops, policy, call_type):
    with patch.object(type(ops), "get_org_policy", AsyncMock(return_value=policy)):
        return asyncio.run(ops.resolve_screen_share_ceiling(uuid4(), call_type))


def test_direct_call_defaults_to_max_without_policy() -> None:
    ops = _build_ops()
    assert _resolve(ops, None, CallType.DIRECT) == ScreenShareQuality.MAX


def test_channel_call_defaults_to_env_default_without_policy() -> None:
    ops = _build_ops()
    with patch(
        "uniffy.domains.calls.operations.default_screen_share_quality",
        return_value=ScreenShareQuality.BALANCED,
    ):
        assert _resolve(ops, None, CallType.CHANNEL) == ScreenShareQuality.BALANCED


def test_direct_cap_applies_to_direct() -> None:
    ops = _build_ops()
    policy = ResolvedCallPolicy(
        organization_id=uuid4(),
        max_screen_share_quality_direct=int(ScreenShareQuality.HIGH),
    )
    assert _resolve(ops, policy, CallType.DIRECT) == ScreenShareQuality.HIGH


def test_channel_cap_does_not_leak_into_direct() -> None:
    ops = _build_ops()
    policy = ResolvedCallPolicy(
        organization_id=uuid4(),
        max_screen_share_quality_channel=int(ScreenShareQuality.BALANCED),
    )
    assert _resolve(ops, policy, CallType.CHANNEL) == ScreenShareQuality.BALANCED
    # direct is UNSPECIFIED, so it still resolves to its built-in MAX default.
    assert _resolve(ops, policy, CallType.DIRECT) == ScreenShareQuality.MAX


def test_group_cap_applies_to_group() -> None:
    ops = _build_ops()
    policy = ResolvedCallPolicy(
        organization_id=uuid4(),
        max_screen_share_quality_group=int(ScreenShareQuality.HIGH),
    )
    assert _resolve(ops, policy, CallType.GROUP_DM) == ScreenShareQuality.HIGH


def test_unspecified_per_type_falls_through_to_type_default() -> None:
    ops = _build_ops()
    policy = ResolvedCallPolicy(
        organization_id=uuid4(),
        max_screen_share_quality_direct=int(ScreenShareQuality.UNSPECIFIED),
    )
    assert _resolve(ops, policy, CallType.DIRECT) == ScreenShareQuality.MAX


def _update(ops, **overrides):
    kwargs = dict(
        calls_enabled=True,
        max_participants=25,
        max_duration_minutes=120,
        max_screen_share_quality_direct=ScreenShareQuality.MAX,
        max_screen_share_quality_group=ScreenShareQuality.UNSPECIFIED,
        max_screen_share_quality_channel=ScreenShareQuality.BALANCED,
    )
    kwargs.update(overrides)
    return asyncio.run(ops.update_org_policy(uuid4(), uuid4(), **kwargs))


def test_update_org_policy_rejects_non_admin() -> None:
    ops = _build_ops()
    with _patch_admin(False), pytest.raises(PermissionDeniedError):
        _update(ops)


def test_update_org_policy_admin_upserts_per_type_caps_when_absent() -> None:
    ops = _build_ops()
    with _patch_admin(True), patch.object(
        type(ops), "get_org_policy", AsyncMock(return_value=None)
    ):
        policy = _update(ops, calls_enabled=False)
    assert policy.calls_enabled is False
    assert policy.max_participants == 25
    assert policy.max_screen_share_quality_direct == int(ScreenShareQuality.MAX)
    assert policy.max_screen_share_quality_group == int(ScreenShareQuality.UNSPECIFIED)
    assert policy.max_screen_share_quality_channel == int(ScreenShareQuality.BALANCED)
    ops.session.commit.assert_awaited()


def test_update_org_policy_validates_bounds() -> None:
    ops = _build_ops()
    with _patch_admin(True), pytest.raises(ValidationError):
        _update(ops, max_participants=0)


def test_get_org_policy_view_returns_defaults_when_absent() -> None:
    ops = _build_ops()
    org_id = uuid4()
    with _patch_admin(True), patch.object(
        type(ops), "get_org_policy", AsyncMock(return_value=None)
    ):
        policy = asyncio.run(ops.get_org_policy_view(uuid4(), org_id))
    assert policy.organization_id == org_id
    assert policy.calls_enabled is True
    assert policy.max_screen_share_quality_direct == int(ScreenShareQuality.UNSPECIFIED)
    assert policy.max_screen_share_quality_group == int(ScreenShareQuality.UNSPECIFIED)
    assert policy.max_screen_share_quality_channel == int(ScreenShareQuality.UNSPECIFIED)


def test_get_org_policy_view_rejects_non_admin() -> None:
    ops = _build_ops()
    with _patch_admin(False), pytest.raises(PermissionDeniedError):
        asyncio.run(ops.get_org_policy_view(uuid4(), uuid4()))
