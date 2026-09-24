import asyncio
from datetime import UTC, datetime
from unittest.mock import AsyncMock

import pyotp
import pytest
from sqlalchemy import delete, select, update

from uniffy.core.models.calls.call import CallParticipant
from uniffy.core.models.login.user_mfa import UserMfa
from uniffy.core.models.login.user_recovery_code import UserRecoveryCode
from uniffy.core.models.login.user_session import UserSession
from uniffy.domains.auth.mfa import operations as mfa_module
from uniffy.domains.auth.mfa.operations import MfaOperations
from uniffy.domains.auth.operations import AuthOperations
from uniffy.domains.calls.channels import CallsLifecycle
from uniffy.domains.calls.operations import CallOperations
from uniffy.infrastructure.database import open_session
from uniffy.tests.integration.access.calls import (
    _auth_session,
    _call,
    _participant,
)
from uniffy.tests.integration.access.calls import (
    livekit as livekit,
)

pytestmark = pytest.mark.asyncio(loop_scope="session")


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

        await CallsLifecycle(open_session).stage_transfer_session(session, old.id, new.id)
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


async def test_session_revoke_preserves_call_transferred_by_mfa(
    session, access, livekit, monkeypatch
):
    call = await _call(session, access)
    old = await _auth_session(session, access.member_id, access.org_id)
    participant = await _participant(session, call, access.member_id, auth_session_id=old.id)
    session.add(UserMfa(user_id=access.member_id, totp_secret_encrypted="test-secret"))
    await session.commit()
    secret = pyotp.random_base32()
    monkeypatch.setattr(mfa_module, "decrypt_totp_secret", AsyncMock(return_value=secret))
    verified = asyncio.Event()
    eviction_selected = asyncio.Event()
    force_leave = CallOperations._force_leave
    confirmation = None

    try:
        async with open_session() as mfa_session:
            mfa = MfaOperations(mfa_session, CallsLifecycle(open_session))
            verify_totp = mfa._verify_totp

            async def verify_then_wait(mfa_row, code):
                valid = await verify_totp(mfa_row, code)
                assert valid
                verified.set()
                await asyncio.wait_for(eviction_selected.wait(), timeout=10)
                return valid

            monkeypatch.setattr(mfa, "_verify_totp", verify_then_wait)

            async def finish_enrollment_then_leave(operations, call_row, row, **kwargs):
                assert row.auth_session_id == old.id
                eviction_selected.set()
                result = await asyncio.wait_for(confirmation, timeout=10)
                async with open_session() as read_session:
                    stamp, left_at = (
                        await read_session.execute(
                            select(
                                CallParticipant.auth_session_id,
                                CallParticipant.left_at,
                            ).where(CallParticipant.id == participant.id)
                        )
                    ).one()
                    assert stamp == result.session_id
                    assert left_at is None
                    assert (
                        await read_session.execute(
                            select(UserSession.is_revoked).where(UserSession.id == old.id)
                        )
                    ).scalar_one()
                return await force_leave(operations, call_row, row, **kwargs)

            monkeypatch.setattr(CallOperations, "_force_leave", finish_enrollment_then_leave)
            confirmation = asyncio.create_task(
                mfa.confirm_enrollment(
                    access.member_id,
                    pyotp.TOTP(secret).now(),
                    pending_organization_id=access.org_id,
                    replaced_session_id=old.id,
                )
            )
            await asyncio.wait_for(verified.wait(), timeout=10)
            async with open_session() as revoke_session:
                revoked = await AuthOperations(
                    revoke_session, CallsLifecycle(open_session)
                ).revoke_session(access.member_id, old.id)
            assert revoked
            result = await confirmation

        stamp, left_at, replacement_revoked = (
            await session.execute(
                select(
                    CallParticipant.auth_session_id,
                    CallParticipant.left_at,
                    UserSession.is_revoked,
                )
                .join(UserSession, UserSession.id == CallParticipant.auth_session_id)
                .where(CallParticipant.id == participant.id)
            )
        ).one()
        assert stamp == result.session_id
        assert replacement_revoked is False
        assert left_at is None
        livekit.remove_participant.assert_not_awaited()
    finally:
        if confirmation is not None and not confirmation.done():
            confirmation.cancel()
            await asyncio.gather(confirmation, return_exceptions=True)
        await session.rollback()
        await session.execute(
            delete(UserRecoveryCode).where(UserRecoveryCode.user_id == access.member_id)
        )
        await session.execute(delete(UserMfa).where(UserMfa.user_id == access.member_id))
        await session.commit()
