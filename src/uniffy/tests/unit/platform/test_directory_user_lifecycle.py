"""Operator-side account lifecycle: activation, identity edits, member caps."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from uniffy.core.audit.actions import Action
from uniffy.core.audit.writer import email_hash
from uniffy.core.errors import PermissionDeniedError, ValidationError
from uniffy.core.models.login.user import User
from uniffy.core.types import generate_id
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.domains.platform.directory.operations import PlatformDirectoryOperations

_OLD_EMAIL = "old@example.com"
_NEW_EMAIL = "new@example.com"


def _make_user(**overrides) -> User:
    defaults = {
        "id": generate_id(),
        "email": "target@example.com",
        "username": "target",
        "full_name": "Target User",
        "hashed_password": "hashed",
        "is_active": True,
        "is_system_admin": False,
        "email_verified": True,
        "token_version": 1,
    }
    defaults.update(overrides)
    return User(**defaults)


def _audited_actions(session: MagicMock) -> list[str]:
    return [
        call.args[0].action for call in session.add.call_args_list if hasattr(call.args[0], "action")
    ]


class TestUpdateUserRequiresAReason:
    async def test_blank_reason_rejected(self) -> None:
        ops = PlatformDirectoryOperations(MagicMock())
        ops._user_ops.require_system_admin = AsyncMock(return_value=_make_user())

        with (
            patch(
                "uniffy.domains.platform.directory.operations.check_rate_limit",
                AsyncMock(),
            ),
            pytest.raises(ValidationError),
        ):
            await ops.update_user(
                user_id=generate_id(),
                target_user_id=generate_id(),
                reason="   ",
                is_active=False,
            )


class TestDeactivationGuards:
    async def test_cannot_deactivate_self(self) -> None:
        actor = _make_user(is_system_admin=True)
        ops = PlatformDirectoryOperations(MagicMock())
        ops._user_ops.require_system_admin = AsyncMock(return_value=actor)
        ops._require_user = AsyncMock(return_value=actor)

        with (
            patch(
                "uniffy.domains.platform.directory.operations.check_rate_limit",
                AsyncMock(),
            ),
            pytest.raises(PermissionDeniedError),
        ):
            await ops.update_user(
                user_id=actor.id,
                target_user_id=actor.id,
                reason="offboarding",
                is_active=False,
            )

    async def test_cannot_deactivate_the_last_active_sysadmin(self) -> None:
        actor = _make_user(is_system_admin=True)
        target = _make_user(is_system_admin=True, email="peer@example.com")
        session = MagicMock()
        session.execute = AsyncMock(return_value=MagicMock(scalar_one=lambda: 0))

        ops = PlatformDirectoryOperations(session)
        ops._user_ops.require_system_admin = AsyncMock(return_value=actor)
        ops._require_user = AsyncMock(return_value=target)

        with (
            patch(
                "uniffy.domains.platform.directory.operations.check_rate_limit",
                AsyncMock(),
            ),
            pytest.raises(PermissionDeniedError),
        ):
            await ops.update_user(
                user_id=actor.id,
                target_user_id=target.id,
                reason="offboarding",
                is_active=False,
            )


class TestUpdateUserAuditAndRevocation:
    async def test_deactivation_revokes_tokens_and_audits(self) -> None:
        actor = _make_user(is_system_admin=True)
        target = _make_user()
        session = MagicMock()
        session.execute = AsyncMock(return_value=MagicMock(scalar_one=lambda: 3))
        session.add = MagicMock()
        session.commit = AsyncMock()

        ops = PlatformDirectoryOperations(session)
        ops._user_ops.require_system_admin = AsyncMock(return_value=actor)
        ops._require_user = AsyncMock(return_value=target)
        ops.get_user = AsyncMock(return_value="detail")

        revoked = AsyncMock()
        with (
            patch(
                "uniffy.domains.platform.directory.operations.check_rate_limit",
                AsyncMock(),
            ),
            patch(
                "uniffy.domains.platform.directory.operations.mark_token_version_revoked",
                revoked,
            ),
            patch(
                "uniffy.domains.platform.directory.operations._safe_publish_token_revoke",
                AsyncMock(),
            ),
            patch(
                "uniffy.domains.platform.directory.operations.invalidate_user_profile",
                AsyncMock(),
            ),
        ):
            await ops.update_user(
                user_id=actor.id,
                target_user_id=target.id,
                reason="compromised credentials",
                is_active=False,
            )

        assert target.is_active is False
        assert target.token_version == 2
        revoked.assert_awaited_once_with(target.id, 2)
        actions = _audited_actions(session)
        assert Action.USER_UPDATED in actions
        assert Action.USER_DEACTIVATED in actions

    async def test_email_change_hashes_both_addresses(self) -> None:
        actor = _make_user(is_system_admin=True)
        target = _make_user(email=_OLD_EMAIL)
        session = MagicMock()
        session.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=lambda: None))
        session.add = MagicMock()
        session.commit = AsyncMock()

        ops = PlatformDirectoryOperations(session)
        ops._user_ops.require_system_admin = AsyncMock(return_value=actor)
        ops._require_user = AsyncMock(return_value=target)
        ops.get_user = AsyncMock(return_value="detail")

        with (
            patch(
                "uniffy.domains.platform.directory.operations.check_rate_limit",
                AsyncMock(),
            ),
            patch(
                "uniffy.domains.platform.directory.operations.mark_token_version_revoked",
                AsyncMock(),
            ),
            patch(
                "uniffy.domains.platform.directory.operations._safe_publish_token_revoke",
                AsyncMock(),
            ),
            patch(
                "uniffy.domains.platform.directory.operations.invalidate_user_profile",
                AsyncMock(),
            ),
        ):
            await ops.update_user(
                user_id=actor.id,
                target_user_id=target.id,
                reason="typo in address",
                email="New@Example.com",
            )

        assert target.email == _NEW_EMAIL
        # A new address is unproven, so verification resets.
        assert target.email_verified is False
        rows = [
            call.args[0]
            for call in session.add.call_args_list
            if getattr(call.args[0], "action", None) == Action.USER_EMAIL_CHANGED
        ]
        assert len(rows) == 1
        assert rows[0].details["previous_email_hash"] == email_hash(_OLD_EMAIL)
        assert rows[0].details["new_email_hash"] == email_hash(_NEW_EMAIL)
        assert _OLD_EMAIL not in str(rows[0].details)

    async def test_no_changes_skips_the_write_entirely(self) -> None:
        actor = _make_user(is_system_admin=True)
        target = _make_user(full_name="Target User")
        session = MagicMock()
        session.add = MagicMock()
        session.commit = AsyncMock()

        ops = PlatformDirectoryOperations(session)
        ops._user_ops.require_system_admin = AsyncMock(return_value=actor)
        ops._require_user = AsyncMock(return_value=target)
        ops.get_user = AsyncMock(return_value="detail")

        with patch(
            "uniffy.domains.platform.directory.operations.check_rate_limit",
            AsyncMock(),
        ):
            await ops.update_user(
                user_id=actor.id,
                target_user_id=target.id,
                reason="no-op",
                full_name="Target User",
            )

        assert _audited_actions(session) == []
        session.commit.assert_not_awaited()


class TestCreateUserTransaction:
    async def test_membership_failure_rolls_back_the_account(self) -> None:
        actor = _make_user(is_system_admin=True)
        session = MagicMock()
        session.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=lambda: None))
        session.add = MagicMock()
        session.flush = AsyncMock()
        session.commit = AsyncMock()
        session.rollback = AsyncMock()

        ops = PlatformDirectoryOperations(session)
        ops._user_ops.require_system_admin = AsyncMock(return_value=actor)
        ops._require_org = AsyncMock(return_value=MagicMock(id=generate_id(), deleted_at=None))

        failing = MagicMock()
        failing.stage_member = AsyncMock(side_effect=RuntimeError("membership write failed"))

        with (
            patch(
                "uniffy.domains.platform.directory.operations.check_rate_limit",
                AsyncMock(),
            ),
            patch(
                "uniffy.domains.platform.directory.operations.OrganizationOperations",
                MagicMock(return_value=failing),
            ),
            patch(
                "uniffy.domains.platform.directory.operations.hash_password",
                MagicMock(return_value="hashed"),
            ),
            patch(
                "uniffy.domains.platform.directory.operations.validate_password",
                MagicMock(),
            ),
            pytest.raises(RuntimeError),
        ):
            await ops.create_user(
                user_id=actor.id,
                email="new@example.com",
                username="",
                full_name="New User",
                password="Sufficiently-Long-1",
                email_verified=True,
                is_system_admin=False,
                organization_id=generate_id(),
                reason="new hire",
            )

        session.rollback.assert_awaited_once()
        assert Action.USER_CREATED not in _audited_actions(session)

    async def test_reason_is_required(self) -> None:
        ops = PlatformDirectoryOperations(MagicMock())
        ops._user_ops.require_system_admin = AsyncMock(return_value=_make_user())

        with (
            patch(
                "uniffy.domains.platform.directory.operations.check_rate_limit",
                AsyncMock(),
            ),
            pytest.raises(ValidationError),
        ):
            await ops.create_user(
                user_id=generate_id(),
                email="new@example.com",
                username="",
                full_name="",
                password="Sufficiently-Long-1",
                email_verified=True,
                is_system_admin=False,
                reason="",
            )


class TestMemberCapIsEnforced:
    async def test_add_member_refuses_at_the_cap(self) -> None:
        org_id = generate_id()
        org = MagicMock(id=org_id, max_members=5, slug="capped")
        session = MagicMock()
        session.execute = AsyncMock(
            side_effect=[
                MagicMock(scalar_one_or_none=lambda: org),
                MagicMock(scalar_one=lambda: 5),
            ]
        )

        ops = OrganizationOperations(session)
        ops.get_membership = AsyncMock(return_value=None)

        with pytest.raises(ValidationError):
            await ops.add_member(user_id=generate_id(), org_id=org_id)

    async def test_uncapped_org_passes(self) -> None:
        ops = OrganizationOperations(MagicMock())
        await ops._require_member_capacity(MagicMock(max_members=None))

    async def test_below_the_cap_passes(self) -> None:
        session = MagicMock()
        session.execute = AsyncMock(return_value=MagicMock(scalar_one=lambda: 4))

        ops = OrganizationOperations(session)
        await ops._require_member_capacity(MagicMock(id=generate_id(), max_members=10))
