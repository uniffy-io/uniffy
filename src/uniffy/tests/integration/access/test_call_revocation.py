"""Revoking access reaches a call the person is already sitting in, proven on real rows.

Every revocation owner (auth, password reset, platform directory, organizations)
runs its real operation here with the real calls lifecycle, and the assertion is
on the participant row the SFU eviction keys on. Only the LiveKit client is faked.
"""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import select, update

from uniffy.core.audit.actions import Action
from uniffy.core.auth.tokens import create_refresh_token
from uniffy.core.errors import PermissionDeniedError
from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.calls.call import Call, CallEndReason, CallParticipant, CallType
from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.models.chat.channel_member import ChatChannelMember
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.login.password_reset_token import PasswordResetToken
from uniffy.core.models.login.user import User
from uniffy.core.models.login.user_session import UserSession
from uniffy.core.types import SubjectType, generate_id
from uniffy.domains.auth.contracts import hash_refresh_token
from uniffy.domains.auth.errors import TokenError
from uniffy.domains.auth.operations import AuthOperations
from uniffy.domains.auth.passwords.reset import PasswordResetOperations, _hash_token
from uniffy.domains.calls import config as calls_config
from uniffy.domains.calls import operations as calls_operations
from uniffy.domains.calls.channels import CallsLifecycle
from uniffy.domains.calls.jobs import jobs as calls_jobs
from uniffy.domains.calls.lifecycle import CallEvictionReason
from uniffy.domains.calls.operations import CallOperations
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.domains.platform.directory.operations import PlatformDirectoryOperations

pytestmark = pytest.mark.asyncio(loop_scope="session")


@pytest.fixture(autouse=True)
def livekit(monkeypatch):
    monkeypatch.setattr(calls_config, "_config", None)
    monkeypatch.setenv("LIVEKIT_HOST", "http://livekit:7880")
    monkeypatch.setenv("LIVEKIT_API_KEY", "devkey")
    monkeypatch.setenv("LIVEKIT_API_SECRET", "e" * 48)
    client = MagicMock()
    client.remove_participant = AsyncMock()
    client.delete_room = AsyncMock()
    monkeypatch.setattr(calls_operations, "get_livekit_admin_client", MagicMock(return_value=client))
    return client


async def _channel(session, org_id, owner_id, channel_type=ChannelType.PRIVATE) -> ChatChannel:
    suffix = generate_id().hex[-12:]
    channel = ChatChannel(
        organization_id=org_id,
        owner_id=owner_id,
        name=f"room-{suffix}",
        slug=f"room-{suffix}",
        channel_type=channel_type,
    )
    session.add(channel)
    await session.flush()
    session.add(
        ChatChannelMember(
            channel_id=channel.id,
            subject_type=SubjectType.USER,
            subject_id=owner_id,
            user_id=owner_id,
        )
    )
    await session.commit()
    return channel


async def _call(session, access, *, org_id=None, host_id=None) -> Call:
    org_id = org_id or access.org_id
    host_id = host_id or access.owner_id
    channel = await _channel(session, org_id, host_id)
    call = Call(
        organization_id=org_id,
        channel_id=channel.id,
        call_type=CallType.CHANNEL,
        initiator_user_id=host_id,
        host_user_id=host_id,
        livekit_room_name=f"org_{org_id}:call_{generate_id().hex[-12:]}",
    )
    session.add(call)
    await session.flush()
    session.add(
        CallParticipant(
            call_id=call.id,
            organization_id=org_id,
            user_id=host_id,
            device_id="host",
            identity=f"{host_id}:host",
        )
    )
    await session.commit()
    return call


async def _participant(
    session, call, user_id, *, device="d1", auth_session_id=None
) -> CallParticipant:
    row = CallParticipant(
        call_id=call.id,
        organization_id=call.organization_id,
        user_id=user_id,
        device_id=device,
        identity=f"{user_id}:{device}",
        auth_session_id=auth_session_id,
    )
    session.add(row)
    await session.commit()
    return row


async def _auth_session(session, user_id, org_id, *, revoked=False) -> UserSession:
    row = UserSession(user_id=user_id, organization_id=org_id, is_revoked=revoked)
    session.add(row)
    await session.commit()
    return row


async def _left_at(session, participant_id) -> datetime | None:
    return (
        await session.execute(
            select(CallParticipant.left_at).where(CallParticipant.id == participant_id)
        )
    ).scalar_one()


async def _evictions(session, call_id) -> list[AuditEvent]:
    rows = await session.execute(
        select(AuditEvent).where(
            AuditEvent.action == Action.CALL_PARTICIPANT_EVICTED,
            AuditEvent.resource_id == call_id,
        )
    )
    return list(rows.scalars().all())


async def _make_system_admin(session, user_id) -> None:
    await session.execute(update(User).where(User.id == user_id).values(is_system_admin=True))
    await session.commit()


class TestEvictUser:
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


class TestOrganizationTeardown:
    async def test_every_live_call_in_the_organization_ends_with_the_reason(
        self, session, access
    ) -> None:
        first = await _call(session, access)
        second = await _call(session, access, host_id=access.member_id)
        elsewhere = await _call(
            session, access, org_id=access.other_org_id, host_id=access.outsider_id
        )

        ended = await CallOperations(session).end_calls_for_organization(
            access.org_id, CallEndReason.ORG_DELETED, actor_user_id=access.owner_id
        )

        assert ended == 2
        reasons = (
            await session.execute(
                select(Call.id, Call.end_reason).where(
                    Call.id.in_([first.id, second.id, elsewhere.id])
                )
            )
        ).all()
        assert dict(reasons) == {
            first.id: CallEndReason.ORG_DELETED,
            second.id: CallEndReason.ORG_DELETED,
            elsewhere.id: None,
        }


class TestRevokedSessionCannotJoin:
    async def test_join_refuses_a_revoked_session(self, session, access) -> None:
        call = await _call(session, access)
        revoked = await _auth_session(session, access.admin_id, access.org_id, revoked=True)

        with pytest.raises(PermissionDeniedError):
            await CallOperations(session).join_call(
                access.admin_id, access.org_id, call.id, "d1", None, revoked.id
            )

        rows = await session.execute(
            select(CallParticipant.id).where(
                CallParticipant.call_id == call.id,
                CallParticipant.user_id == access.admin_id,
            )
        )
        assert rows.first() is None

    async def test_refresh_refuses_a_revoked_session(self, session, access) -> None:
        call = await _call(session, access)
        revoked = await _auth_session(session, access.owner_id, access.org_id, revoked=True)

        with pytest.raises(PermissionDeniedError):
            await CallOperations(session).refresh_token(
                access.owner_id, access.org_id, call.id, "host", revoked.id
            )

    async def test_refresh_refuses_another_users_session(self, session, access) -> None:
        call = await _call(session, access)
        foreign = await _auth_session(session, access.member_id, access.org_id)

        with pytest.raises(PermissionDeniedError):
            await CallOperations(session).refresh_token(
                access.owner_id, access.org_id, call.id, "host", foreign.id
            )


class TestSessionTransfer:
    async def test_live_rows_move_to_the_new_session(self, session, access) -> None:
        call = await _call(session, access)
        old = await _auth_session(session, access.member_id, access.org_id)
        new = await _auth_session(session, access.member_id, access.org_id)
        live = await _participant(
            session, call, access.member_id, device="a", auth_session_id=old.id
        )
        gone = await _participant(
            session, call, access.member_id, device="b", auth_session_id=old.id
        )
        await session.execute(
            update(CallParticipant)
            .where(CallParticipant.id == gone.id)
            .values(left_at=datetime.now(UTC))
        )
        await session.commit()

        await CallsLifecycle().transfer_session(session, old.id, new.id)
        await session.commit()

        stamped = dict(
            (
                await session.execute(
                    select(CallParticipant.id, CallParticipant.auth_session_id).where(
                        CallParticipant.id.in_([live.id, gone.id])
                    )
                )
            ).all()
        )
        assert stamped == {live.id: new.id, gone.id: old.id}


class TestRevocationPathsEvict:
    """Each owner runs its real operation; the participant row is the proof."""

    async def test_logout_evicts_the_device_on_that_session(self, session, access) -> None:
        call = await _call(session, access)
        auth = await _auth_session(session, access.member_id, access.org_id)
        row = await _participant(session, call, access.member_id, auth_session_id=auth.id)

        await AuthOperations(session, CallsLifecycle()).logout_session(access.member_id, auth.id)

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

        await AuthOperations(session, CallsLifecycle()).revoke_session(access.member_id, revoked.id)

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

        await AuthOperations(session, CallsLifecycle()).revoke_other_sessions(
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

        await AuthOperations(session, CallsLifecycle()).switch_organization(refresh, other_slug)

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
            await AuthOperations(session, CallsLifecycle()).refresh_token(replayed)

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
            "raw-reset-token", "Correct-Horse-9-Battery", call_lifecycle=CallsLifecycle()
        )

        assert await _left_at(session, row.id) is not None
        assert (await session.get(UserSession, auth.id, populate_existing=True)).is_revoked

    async def test_platform_force_logout_revokes_sessions_and_evicts(self, session, access) -> None:
        await _make_system_admin(session, access.owner_id)
        call = await _call(session, access)
        auth = await _auth_session(session, access.member_id, access.org_id)
        row = await _participant(session, call, access.member_id, auth_session_id=auth.id)

        await PlatformDirectoryOperations(session, CallsLifecycle()).force_logout_user(
            user_id=access.owner_id, target_user_id=access.member_id, reason="offboarding"
        )

        assert await _left_at(session, row.id) is not None
        assert (await session.get(UserSession, auth.id, populate_existing=True)).is_revoked

    async def test_platform_password_change_leaves_the_reconciler_a_revoked_session(
        self, session, access
    ) -> None:
        await _make_system_admin(session, access.owner_id)
        auth = await _auth_session(session, access.member_id, access.org_id)

        await PlatformDirectoryOperations(session, CallsLifecycle()).update_user(
            user_id=access.owner_id,
            target_user_id=access.member_id,
            reason="compromised",
            password="Correct-Horse-9-Battery",
        )

        assert (await session.get(UserSession, auth.id, populate_existing=True)).is_revoked

    async def test_platform_suspension_ends_the_organizations_calls(self, session, access) -> None:
        await _make_system_admin(session, access.outsider_id)
        call = await _call(session, access)

        await PlatformDirectoryOperations(session, CallsLifecycle()).suspend_organization(
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
            call_lifecycle=CallsLifecycle(),
        )

        assert await _left_at(session, row.id) is not None
        [audit] = await _evictions(session, call.id)
        assert audit.actor_user_id == access.owner_id
