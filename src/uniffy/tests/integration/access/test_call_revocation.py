from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select, text, update

from uniffy.core.auth.tokens import create_refresh_token
from uniffy.core.models.calls.call import Call, CallEndReason, CallParticipant
from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.login.password_reset_token import PasswordResetToken
from uniffy.core.models.login.user import User
from uniffy.core.models.login.user_session import UserSession
from uniffy.domains.auth.contracts import hash_refresh_token
from uniffy.domains.auth.errors import TokenError
from uniffy.domains.auth.operations import AuthOperations
from uniffy.domains.auth.passwords.reset import PasswordResetOperations, _hash_token
from uniffy.domains.calls import operations as calls_operations
from uniffy.domains.calls.channels import CallsLifecycle
from uniffy.domains.calls.jobs import jobs as calls_jobs
from uniffy.domains.calls.lifecycle import CallEvictionReason
from uniffy.domains.calls.operations import CallOperations
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.domains.platform.directory.operations import PlatformDirectoryOperations
from uniffy.infrastructure.database import open_session
from uniffy.tests.integration.access.calls import (
    _auth_session,
    _call,
    _evictions,
    _left_at,
    _make_system_admin,
    _participant,
)
from uniffy.tests.integration.access.calls import (
    livekit as livekit,
)

pytestmark = pytest.mark.asyncio(loop_scope="session")


class TestEvictUser:
    async def test_profile_failure_cannot_lose_eviction_audit_or_skip_media_removal(
        self, session, access, livekit, monkeypatch
    ) -> None:
        call = await _call(session, access)
        row = await _participant(session, call, access.ghost_id)
        monkeypatch.setattr(
            CallOperations, "resolve_profiles", AsyncMock(side_effect=ConnectionError("unavailable"))
        )

        await CallsLifecycle(open_session).evict_user(
            session, access.ghost_id, reason=CallEvictionReason.MEMBERSHIP_REVOKED
        )

        assert await _left_at(session, row.id) is not None
        [audit] = await _evictions(session, call.id)
        assert audit.details["target_identity"] == row.identity
        livekit.remove_participant.assert_awaited_once_with(call.livekit_room_name, row.identity)

    async def test_audit_failure_rolls_back_participant_closure(
        self, session, access, livekit, monkeypatch
    ) -> None:
        call = await _call(session, access)
        row = await _participant(session, call, access.ghost_id)
        monkeypatch.setattr(
            calls_operations, "write_audit_event", AsyncMock(side_effect=RuntimeError("unavailable"))
        )

        await CallsLifecycle(open_session).evict_user(
            session, access.ghost_id, reason=CallEvictionReason.MEMBERSHIP_REVOKED
        )

        assert await _left_at(session, row.id) is None
        assert await _evictions(session, call.id) == []
        livekit.remove_participant.assert_not_awaited()

    async def test_a_deactivated_member_is_dropped_and_audited(
        self, session, access, livekit
    ) -> None:
        call = await _call(session, access)
        row = await _participant(session, call, access.ghost_id)

        evicted = await CallOperations(session).evict_user(
            access.ghost_id,
            reason=CallEvictionReason.MEMBERSHIP_REVOKED,
            organization_id=access.org_id,
            actor_user_id=access.owner_id,
        )

        assert evicted == 1
        assert await _left_at(session, row.id) is not None
        livekit.remove_participant.assert_awaited_once_with(call.livekit_room_name, row.identity)
        [audit] = await _evictions(session, call.id)
        assert audit.actor_user_id == access.owner_id
        assert audit.details["reason"] == CallEvictionReason.MEMBERSHIP_REVOKED.value
        assert audit.details["target_identity"] == row.identity

    async def test_an_active_member_in_the_same_call_is_untouched(self, session, access) -> None:
        call = await _call(session, access, host_id=access.member_id)
        host_row = (
            await session.execute(
                select(CallParticipant).where(
                    CallParticipant.call_id == call.id,
                    CallParticipant.user_id == access.member_id,
                )
            )
        ).scalar_one()
        await _participant(session, call, access.ghost_id)

        await CallOperations(session).evict_user(
            access.ghost_id, reason=CallEvictionReason.USER_DEACTIVATED
        )

        assert await _left_at(session, host_row.id) is None

    async def test_revoking_one_session_spares_the_other_device(self, session, access) -> None:
        call = await _call(session, access)
        revoked = await _auth_session(session, access.member_id, access.org_id)
        kept = await _auth_session(session, access.member_id, access.org_id)
        phone = await _participant(
            session, call, access.member_id, device="phone", auth_session_id=revoked.id
        )
        laptop = await _participant(
            session, call, access.member_id, device="laptop", auth_session_id=kept.id
        )

        evicted = await CallOperations(session).evict_user(
            access.member_id,
            reason=CallEvictionReason.SESSION_REVOKED,
            session_ids=[revoked.id],
        )

        assert evicted == 1
        assert await _left_at(session, phone.id) is not None
        assert await _left_at(session, laptop.id) is None

    async def test_session_scoped_eviction_skips_a_row_without_a_session(
        self, session, access
    ) -> None:
        call = await _call(session, access)
        unstamped = await _participant(session, call, access.member_id)
        other = await _auth_session(session, access.member_id, access.org_id)

        evicted = await CallOperations(session).evict_user(
            access.member_id,
            reason=CallEvictionReason.SESSION_REVOKED,
            session_ids=[other.id],
        )

        assert evicted == 0
        assert await _left_at(session, unstamped.id) is None

    async def test_org_scoped_eviction_stops_at_the_organization_boundary(
        self, session, access
    ) -> None:
        call = await _call(session, access)
        row = await _participant(session, call, access.member_id)

        evicted = await CallOperations(session).evict_user(
            access.member_id,
            reason=CallEvictionReason.MEMBERSHIP_REVOKED,
            organization_id=access.other_org_id,
        )

        assert evicted == 0
        assert await _left_at(session, row.id) is None

    async def test_a_participant_who_already_left_gets_no_eviction_audit(
        self, session, access
    ) -> None:
        call = await _call(session, access)
        row = await _participant(session, call, access.member_id)
        await session.execute(
            update(CallParticipant)
            .where(CallParticipant.id == row.id)
            .values(left_at=datetime.now(UTC))
        )
        await session.commit()

        assert not await CallOperations(session)._force_leave(call, row)
        assert await _evictions(session, call.id) == []

    async def test_a_public_channel_joiner_without_a_member_row_is_evicted(
        self, session, access
    ) -> None:
        call = await _call(session, access)
        await session.execute(
            update(ChatChannel)
            .where(ChatChannel.id == call.channel_id)
            .values(channel_type=ChannelType.PUBLIC)
        )
        await session.commit()
        joiner = await _participant(session, call, access.peer_id)

        evicted = await CallOperations(session).evict_user(
            access.peer_id,
            reason=CallEvictionReason.MEMBERSHIP_REVOKED,
            organization_id=access.org_id,
        )

        assert evicted == 1
        assert await _left_at(session, joiner.id) is not None


class TestReconcilerBackstop:
    async def _sweep(self, session, call) -> int:
        return await calls_jobs._evict_revoked_participants(session, CallOperations(session), call)

    async def test_an_inactive_membership_is_evicted_as_membership_revoked(
        self, session, access
    ) -> None:
        call = await _call(session, access)
        row = await _participant(session, call, access.ghost_id)

        assert await self._sweep(session, call) == 1
        assert await _left_at(session, row.id) is not None
        [audit] = await _evictions(session, call.id)
        assert audit.details["reason"] == CallEvictionReason.MEMBERSHIP_REVOKED.value

    async def test_a_deactivated_user_is_evicted_as_user_deactivated(self, session, access) -> None:
        call = await _call(session, access)
        row = await _participant(session, call, access.member_id)
        await session.execute(
            update(User).where(User.id == access.member_id).values(is_active=False)
        )
        await session.commit()

        assert await self._sweep(session, call) == 1
        assert await _left_at(session, row.id) is not None
        [audit] = await _evictions(session, call.id)
        assert audit.details["reason"] == CallEvictionReason.USER_DEACTIVATED.value

    async def test_a_revoked_session_drops_only_that_device(self, session, access) -> None:
        call = await _call(session, access)
        revoked = await _auth_session(session, access.member_id, access.org_id, revoked=True)
        live = await _auth_session(session, access.member_id, access.org_id)
        laptop = await _participant(
            session, call, access.member_id, device="laptop", auth_session_id=revoked.id
        )
        phone = await _participant(
            session, call, access.member_id, device="phone", auth_session_id=live.id
        )

        assert await self._sweep(session, call) == 1
        assert await _left_at(session, laptop.id) is not None
        assert await _left_at(session, phone.id) is None
        [audit] = await _evictions(session, call.id)
        assert audit.details["reason"] == CallEvictionReason.SESSION_REVOKED.value

    async def test_a_legitimate_participant_is_left_alone(self, session, access, livekit) -> None:
        call = await _call(session, access)
        live = await _auth_session(session, access.member_id, access.org_id)
        row = await _participant(session, call, access.member_id, auth_session_id=live.id)

        assert await self._sweep(session, call) == 0
        assert await _left_at(session, row.id) is None
        livekit.remove_participant.assert_not_awaited()

    async def test_the_last_eviction_ends_the_call(self, session, access) -> None:
        call = await _call(session, access, host_id=access.ghost_id)

        assert await self._sweep(session, call) == 1
        assert call.ended_at is not None

    @pytest.mark.parametrize(
        ("column", "value", "reason"),
        [
            ("is_suspended", True, CallEndReason.ORG_SUSPENDED),
            ("deleted_at", datetime.now(UTC), CallEndReason.ORG_DELETED),
        ],
    )
    async def test_a_revoked_organization_resolves_its_end_reason(
        self, session, access, column, value, reason
    ) -> None:
        call = await _call(session, access)
        assert await calls_jobs._organization_end_reason(session, call) is None

        await session.execute(
            update(Organization).where(Organization.id == access.org_id).values({column: value})
        )
        await session.commit()

        assert await calls_jobs._organization_end_reason(session, call) == reason


class TestRevocationPathsEvict:
    """Each owner runs its real operation; the participant row is the proof."""

    async def test_eviction_database_failure_preserves_admin_update(
        self, session, access, monkeypatch
    ) -> None:
        await _make_system_admin(session, access.owner_id)

        async def fail_eviction(operations, *args, **kwargs):
            await operations.session.execute(text("SELECT 1 / 0"))

        monkeypatch.setattr(CallOperations, "evict_user", fail_eviction)
        result = await PlatformDirectoryOperations(
            session, CallsLifecycle(open_session)
        ).update_user(
            user_id=access.owner_id,
            target_user_id=access.member_id,
            reason="Disable account",
            is_active=False,
        )

        assert result.summary.is_active is False
        assert (
            await session.scalar(select(User.is_active).where(User.id == access.member_id)) is False
        )

    async def test_logout_evicts_the_device_on_that_session(self, session, access) -> None:
        call = await _call(session, access)
        auth = await _auth_session(session, access.member_id, access.org_id)
        row = await _participant(session, call, access.member_id, auth_session_id=auth.id)

        await AuthOperations(session, CallsLifecycle(open_session)).logout_session(
            access.member_id, auth.id
        )

        assert await _left_at(session, row.id) is not None

    async def test_revoke_session_evicts_only_that_device(self, session, access) -> None:
        call = await _call(session, access)
        revoked = await _auth_session(session, access.member_id, access.org_id)
        kept = await _auth_session(session, access.member_id, access.org_id)
        gone = await _participant(
            session, call, access.member_id, device="a", auth_session_id=revoked.id
        )
        stays = await _participant(
            session, call, access.member_id, device="b", auth_session_id=kept.id
        )

        await AuthOperations(session, CallsLifecycle(open_session)).revoke_session(
            access.member_id, revoked.id
        )

        assert await _left_at(session, gone.id) is not None
        assert await _left_at(session, stays.id) is None

    async def test_revoke_other_sessions_keeps_the_current_device(self, session, access) -> None:
        call = await _call(session, access)
        current = await _auth_session(session, access.member_id, access.org_id)
        other = await _auth_session(session, access.member_id, access.org_id)
        here = await _participant(
            session, call, access.member_id, device="here", auth_session_id=current.id
        )
        there = await _participant(
            session, call, access.member_id, device="there", auth_session_id=other.id
        )

        await AuthOperations(session, CallsLifecycle(open_session)).revoke_other_sessions(
            access.member_id, current.id
        )

        assert await _left_at(session, here.id) is None
        assert await _left_at(session, there.id) is not None

    async def test_switching_organization_evicts_the_old_sessions_device(
        self, session, access
    ) -> None:
        session.add(
            OrganizationMember(
                user_id=access.member_id,
                organization_id=access.other_org_id,
                role=OrganizationRole.MEMBER,
            )
        )
        await session.commit()
        call = await _call(session, access)
        old = await _auth_session(session, access.member_id, access.org_id)
        row = await _participant(session, call, access.member_id, auth_session_id=old.id)
        user = await session.get(User, access.member_id)
        refresh = create_refresh_token(
            access.member_id, token_version=user.token_version, session_id=old.id
        )
        other_slug = (
            await session.execute(
                select(Organization.slug).where(Organization.id == access.other_org_id)
            )
        ).scalar_one()

        await AuthOperations(session, CallsLifecycle(open_session)).switch_organization(
            refresh, other_slug
        )

        assert await _left_at(session, row.id) is not None

    async def test_refresh_reuse_evicts_every_device(self, session, access) -> None:
        call = await _call(session, access)
        auth = await _auth_session(session, access.member_id, access.org_id)
        row = await _participant(session, call, access.member_id, auth_session_id=auth.id)
        user = await session.get(User, access.member_id)
        current = create_refresh_token(
            access.member_id, token_version=user.token_version, session_id=auth.id
        )
        replayed = create_refresh_token(
            access.member_id,
            token_version=user.token_version,
            session_id=auth.id,
            expires_delta=timedelta(days=2),
        )
        await session.execute(
            update(UserSession)
            .where(UserSession.id == auth.id)
            .values(refresh_token_hash=hash_refresh_token(current))
        )
        await session.commit()

        with pytest.raises(TokenError):
            await AuthOperations(session, CallsLifecycle(open_session)).refresh_token(replayed)

        assert await _left_at(session, row.id) is not None

    async def test_password_reset_revokes_sessions_and_evicts(self, session, access) -> None:
        call = await _call(session, access)
        auth = await _auth_session(session, access.member_id, access.org_id)
        row = await _participant(session, call, access.member_id, auth_session_id=auth.id)
        session.add(
            PasswordResetToken(
                user_id=access.member_id,
                token_hash=_hash_token("raw-reset-token"),
                expires_at=datetime.now(UTC) + timedelta(minutes=10),
            )
        )
        await session.commit()

        await PasswordResetOperations(session).consume(
            "raw-reset-token", "Correct-Horse-9-Battery", call_lifecycle=CallsLifecycle(open_session)
        )

        assert await _left_at(session, row.id) is not None
        assert (await session.get(UserSession, auth.id, populate_existing=True)).is_revoked

    async def test_platform_force_logout_revokes_sessions_and_evicts(self, session, access) -> None:
        await _make_system_admin(session, access.owner_id)
        call = await _call(session, access)
        auth = await _auth_session(session, access.member_id, access.org_id)
        row = await _participant(session, call, access.member_id, auth_session_id=auth.id)

        await PlatformDirectoryOperations(session, CallsLifecycle(open_session)).force_logout_user(
            user_id=access.owner_id, target_user_id=access.member_id, reason="offboarding"
        )

        assert await _left_at(session, row.id) is not None
        assert (await session.get(UserSession, auth.id, populate_existing=True)).is_revoked

    async def test_platform_password_change_leaves_the_reconciler_a_revoked_session(
        self, session, access
    ) -> None:
        await _make_system_admin(session, access.owner_id)
        auth = await _auth_session(session, access.member_id, access.org_id)

        await PlatformDirectoryOperations(session, CallsLifecycle(open_session)).update_user(
            user_id=access.owner_id,
            target_user_id=access.member_id,
            reason="compromised",
            password="Correct-Horse-9-Battery",
        )

        assert (await session.get(UserSession, auth.id, populate_existing=True)).is_revoked

    async def test_platform_suspension_ends_the_organizations_calls(self, session, access) -> None:
        await _make_system_admin(session, access.outsider_id)
        call = await _call(session, access)

        await PlatformDirectoryOperations(
            session, CallsLifecycle(open_session)
        ).suspend_organization(
            user_id=access.outsider_id, organization_id=access.org_id, reason="abuse"
        )

        refreshed = await session.get(Call, call.id, populate_existing=True)
        assert refreshed.end_reason == CallEndReason.ORG_SUSPENDED

    async def test_org_removal_evicts_and_names_the_admin(self, session, access) -> None:
        call = await _call(session, access)
        row = await _participant(session, call, access.peer_id)

        await OrganizationOperations(session).remove_member(
            access.owner_id,
            access.org_id,
            access.peer_id,
            search_indexer=AsyncMock(),
            call_lifecycle=CallsLifecycle(open_session),
        )

        assert await _left_at(session, row.id) is not None
        [audit] = await _evictions(session, call.id)
        assert audit.actor_user_id == access.owner_id
