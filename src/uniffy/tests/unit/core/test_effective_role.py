from dataclasses import replace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.auth.permissions.scalar import ScalarAuthorizationFacts
from uniffy.core.models.login.organization_member import OrganizationRole
from uniffy.core.models.platform.support_session import SupportSessionScope
from uniffy.core.types import AccessMode, ContentRole, ContentType, generate_id
from uniffy.domains.platform.support_session.context import active_support_session_var


def _facts(**changes) -> ScalarAuthorizationFacts:
    base = ScalarAuthorizationFacts(
        is_active_user=True,
        is_system_admin=False,
        organization_role=OrganizationRole.MEMBER,
        support_session_id=None,
        support_scope=None,
        default_access_mode=None,
        default_baseline_role=None,
        blocked=False,
        granted_role=None,
    )
    return replace(base, **changes)


async def _resolve(
    facts: ScalarAuthorizationFacts | None,
    *,
    user_id=None,
    owner_id=None,
    access_mode=AccessMode.EXPLICIT_MEMBERS,
    baseline_role=None,
    content_type=ContentType.NOTE,
) -> ContentRole | None:
    user_id = user_id or generate_id()
    owner_id = owner_id or generate_id()
    with patch(
        "uniffy.core.auth.permissions.checker.load_scalar_authorization_facts",
        AsyncMock(return_value=facts),
    ) as loader:
        role = await PermissionChecker(MagicMock()).effective_role(
            user_id=user_id,
            organization_id=generate_id(),
            content_type=content_type,
            content_id=generate_id(),
            owner_id=owner_id,
            access_mode=access_mode,
            baseline_role=baseline_role,
        )
    loader.assert_awaited_once()
    return role


@pytest.mark.parametrize(
    "facts",
    [
        None,
        _facts(is_active_user=False),
        _facts(organization_role=None),
    ],
)
async def test_inactive_or_non_member_actor_is_denied(facts) -> None:
    assert await _resolve(facts, access_mode=AccessMode.OPEN_TO_ORG) is None


async def test_admin_has_no_private_content_bypass() -> None:
    assert (
        await _resolve(
            _facts(organization_role=OrganizationRole.ADMIN),
            access_mode=AccessMode.OWNER_ONLY,
        )
        is None
    )


async def test_blocked_wins_over_ownership() -> None:
    user_id = generate_id()
    role = await _resolve(
        _facts(blocked=True, granted_role=ContentRole.ADMIN),
        user_id=user_id,
        owner_id=user_id,
    )
    assert role is None


async def test_owner_and_explicit_roles_resolve() -> None:
    user_id = generate_id()
    assert await _resolve(_facts(), user_id=user_id, owner_id=user_id) is ContentRole.OWNER
    assert await _resolve(_facts(granted_role=ContentRole.EDITOR)) is ContentRole.EDITOR


async def test_open_to_org_uses_row_then_database_default() -> None:
    assert (
        await _resolve(
            _facts(
                default_access_mode=AccessMode.OPEN_TO_ORG,
                default_baseline_role=ContentRole.COMMENTER,
            ),
            access_mode=AccessMode.OPEN_TO_ORG,
            baseline_role=None,
        )
        is ContentRole.COMMENTER
    )
    assert (
        await _resolve(
            _facts(
                default_access_mode=AccessMode.OPEN_TO_ORG,
                default_baseline_role=ContentRole.EDITOR,
            ),
            access_mode=None,
        )
        is ContentRole.EDITOR
    )


async def test_open_to_org_without_a_baseline_uses_viewer_floor() -> None:
    assert (
        await _resolve(
            _facts(),
            access_mode=AccessMode.OPEN_TO_ORG,
            baseline_role=None,
            content_type=ContentType.TEAM,
        )
        is ContentRole.VIEWER
    )


@pytest.mark.parametrize(
    ("scope", "expected"),
    [
        (SupportSessionScope.READ_ONLY, ContentRole.VIEWER),
        (SupportSessionScope.READ_WRITE, ContentRole.EDITOR),
    ],
)
async def test_non_member_system_admin_requires_active_support_session(scope, expected) -> None:
    session_id = generate_id()
    token = active_support_session_var.set(None)
    try:
        role = await _resolve(
            _facts(
                is_system_admin=True,
                organization_role=None,
                support_session_id=session_id,
                support_scope=scope,
            )
        )
        context = active_support_session_var.get()
    finally:
        active_support_session_var.reset(token)

    assert role is expected
    assert context is not None
    assert context.session_id == session_id


async def test_system_admin_without_support_session_is_denied() -> None:
    assert (
        await _resolve(_facts(is_system_admin=True, organization_role=None))
        is None
    )


async def test_system_admin_member_uses_ordinary_member_policy() -> None:
    assert (
        await _resolve(
            _facts(
                is_system_admin=True,
                organization_role=OrganizationRole.OWNER,
                support_session_id=generate_id(),
                support_scope=SupportSessionScope.READ_WRITE,
            ),
            access_mode=AccessMode.OWNER_ONLY,
        )
        is None
    )
