"""``evaluate_mfa_requirement`` scans every active org membership.

The login UI does not ask for an org slug, so ``authenticate`` calls
the evaluator with no specific organization in hand. MFA secrets are
per user (one secret protects every membership), so the right
semantics are: any membership whose policy requires MFA for the
caller's role in that org makes the requirement fire globally.

These tests pin the behaviour against three regressions:

* The old shape returned ``NOT_REQUIRED`` when no org slug was
  passed, letting admins of MFA-required orgs skate through every
  login.
* The platform-admin branch must still trigger independently of any
  org membership state.
* A user with no active memberships and no platform-admin flag is
  not required.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import pytest

from uniffy.core.models.login.organization_member import OrganizationRole
from uniffy.domains.auth.mfa import enforcement as enf
from uniffy.domains.auth.mfa.enforcement import (
    MfaRequirement,
    evaluate_mfa_requirement,
)


def _run(coro):
    return asyncio.run(coro)


@dataclass
class _User:
    id: UUID
    is_system_admin: bool = False


@dataclass
class _Settings:
    mfa_required_for_admins: bool = False
    mfa_required_for_members: bool = False
    password_reset_enabled: bool = True


def _membership_rows(rows):
    """Build a SQLAlchemy-style row result yielding ``(org_id, role)``."""
    result = MagicMock()
    result.all = lambda: rows
    session = MagicMock()
    session.execute = AsyncMock(return_value=result)
    return session


def _patch_security(settings_by_org):
    """Stub ``SecurityOperations(session).get(org_id)`` per-org."""
    instance = MagicMock()

    async def _get(org_id):
        return settings_by_org[org_id]

    instance.get = AsyncMock(side_effect=_get)
    return patch.object(enf, "SecurityOperations", return_value=instance)


def _patch_policy(required_for_system_admins):
    instance = MagicMock()
    instance.get = AsyncMock(
        return_value=MagicMock(
            required_for_system_admins=required_for_system_admins
        )
    )
    return patch.object(enf, "MfaPolicyOperations", return_value=instance)


class TestEnforcementScansAllMemberships:
    """The login flow no longer needs an org slug to trigger enrollment."""

    def test_admin_of_one_org_with_required_for_admins(self) -> None:
        """Regression: admin of org X (requires MFA) was being let in."""
        user = _User(id=uuid4())
        org_x = uuid4()
        session = _membership_rows([(org_x, OrganizationRole.ADMIN)])

        with _patch_policy(False), _patch_security({
            org_x: _Settings(mfa_required_for_admins=True),
        }):
            result = _run(
                evaluate_mfa_requirement(session, user=user, user_mfa=None)
            )

        assert result.requirement == MfaRequirement.HARD_REQUIRED

    def test_member_of_org_with_required_for_members(self) -> None:
        user = _User(id=uuid4())
        org_y = uuid4()
        session = _membership_rows([(org_y, OrganizationRole.MEMBER)])

        with _patch_policy(False), _patch_security({
            org_y: _Settings(mfa_required_for_members=True),
        }):
            result = _run(
                evaluate_mfa_requirement(session, user=user, user_mfa=None)
            )

        assert result.requirement == MfaRequirement.HARD_REQUIRED

    def test_member_of_admin_only_required_org_is_skipped(self) -> None:
        """A plain MEMBER of an admins-only-required org is not forced."""
        user = _User(id=uuid4())
        org_y = uuid4()
        session = _membership_rows([(org_y, OrganizationRole.MEMBER)])

        with _patch_policy(False), _patch_security({
            org_y: _Settings(mfa_required_for_admins=True),
        }):
            result = _run(
                evaluate_mfa_requirement(session, user=user, user_mfa=None)
            )

        assert result.requirement == MfaRequirement.NOT_REQUIRED

    def test_any_membership_triggering_wins(self) -> None:
        """Multi-org user: one requires, the other does not, still required."""
        user = _User(id=uuid4())
        org_a = uuid4()
        org_b = uuid4()
        session = _membership_rows([
            (org_a, OrganizationRole.MEMBER),
            (org_b, OrganizationRole.OWNER),
        ])

        with _patch_policy(False), _patch_security({
            org_a: _Settings(),  # no requirement
            org_b: _Settings(mfa_required_for_admins=True),
        }):
            result = _run(
                evaluate_mfa_requirement(session, user=user, user_mfa=None)
            )

        assert result.requirement == MfaRequirement.HARD_REQUIRED

    def test_user_with_no_memberships_not_required(self) -> None:
        user = _User(id=uuid4())
        session = _membership_rows([])

        with _patch_policy(False), _patch_security({}):
            result = _run(
                evaluate_mfa_requirement(session, user=user, user_mfa=None)
            )

        assert result.requirement == MfaRequirement.NOT_REQUIRED

    def test_system_admin_with_platform_policy(self) -> None:
        """Platform-admin branch fires before membership scan."""
        user = _User(id=uuid4(), is_system_admin=True)
        session = _membership_rows([])

        with _patch_policy(True), _patch_security({}):
            result = _run(
                evaluate_mfa_requirement(session, user=user, user_mfa=None)
            )

        assert result.requirement == MfaRequirement.HARD_REQUIRED

    def test_enabled_user_skips_evaluation(self) -> None:
        """Users with MFA already enabled never hit this branch."""
        user = _User(id=uuid4())
        session = MagicMock()
        session.execute = AsyncMock(
            side_effect=AssertionError("must not be called"),
        )

        with _patch_policy(True), _patch_security({}):
            result = _run(
                evaluate_mfa_requirement(
                    session,
                    user=user,
                    user_mfa=MagicMock(enabled=True),
                )
            )

        assert result.requirement == MfaRequirement.NOT_REQUIRED

    def test_failed_lookup_is_fail_closed(self) -> None:
        """A backend hiccup must NOT silently disable MFA enforcement.

        The evaluator re-raises so the login surfaces a typed error
        and oncall gets paged instead of issuing tokens to users that
        policy would otherwise have funnelled into the enrollment path.
        """
        user = _User(id=uuid4())
        session = MagicMock()
        session.execute = AsyncMock(side_effect=RuntimeError("db down"))

        with _patch_policy(False), pytest.raises(RuntimeError, match="db down"):
            _run(
                evaluate_mfa_requirement(session, user=user, user_mfa=None)
            )
