import asyncio

import pytest
from sqlalchemy import select, update

from uniffy.core.errors import PermissionDeniedError
from uniffy.core.json_codec import dumps_str
from uniffy.core.models.calls.call import CallParticipant
from uniffy.core.models.login.user_session import UserSession
from uniffy.domains.auth.operations import AuthOperations
from uniffy.domains.calls import webhook as calls_webhook
from uniffy.domains.calls.channels import CallsLifecycle
from uniffy.domains.calls.jobs import jobs as calls_jobs
from uniffy.domains.calls.operations import CallOperations
from uniffy.infrastructure.database import open_session
from uniffy.tests.integration.access.calls import (
    _auth_session,
    _call,
    _channel,
)
from uniffy.tests.integration.access.calls import (
    livekit as livekit,
)
from uniffy.tests.integration.access.calls import (
    scoped_reconciler as scoped_reconciler,
)

pytestmark = pytest.mark.asyncio(loop_scope="session")


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


@pytest.mark.parametrize("operation", ["join", "rejoin", "refresh", "initiate"])
async def test_call_session_write_orders_concurrent_revocation(
    session, access, livekit, monkeypatch, operation
):
    call = await _call(session, access)
    auth = await _auth_session(session, access.admin_id, access.org_id)
    ops = CallOperations(session)
    if operation in ("rejoin", "refresh"):
        await ops.join_call(access.admin_id, access.org_id, call.id, "device", None, auth.id)
    require_session = CallOperations._require_live_auth_session
    revoke_task = None

    async def revoke():
        async with open_session() as other:
            await AuthOperations(other, CallsLifecycle(open_session)).revoke_session(
                access.admin_id, auth.id
            )

    async def check_then_revoke(operations, user_id, session_id):
        nonlocal revoke_task
        await require_session(operations, user_id, session_id)
        revoke_task = asyncio.create_task(revoke())
        await asyncio.sleep(0.05)
        assert not revoke_task.done()

    monkeypatch.setattr(CallOperations, "_require_live_auth_session", check_then_revoke)
    try:
        if operation == "refresh":
            await ops.refresh_token(access.admin_id, access.org_id, call.id, "device", auth.id)
        elif operation == "initiate":
            channel = await _channel(session, access.org_id, access.admin_id)
            await ops.initiate_call(
                access.admin_id, access.org_id, channel.id, "device", None, auth.id
            )
        else:
            await ops.join_call(access.admin_id, access.org_id, call.id, "device", None, auth.id)
        await asyncio.wait_for(revoke_task, timeout=10)
        assert (
            await session.scalar(
                select(CallParticipant.id).where(
                    CallParticipant.user_id == access.admin_id,
                    CallParticipant.left_at.is_(None),
                )
            )
            is None
        )
        livekit.remove_participant.assert_awaited_once()
    finally:
        if revoke_task is not None and not revoke_task.done():
            revoke_task.cancel()
            await asyncio.gather(revoke_task, return_exceptions=True)


async def test_old_media_token_cannot_inherit_replacement_session(
    session, access, livekit, scoped_reconciler
):
    call = await _call(session, access)
    old_auth = await _auth_session(session, access.admin_id, access.org_id)
    _, _, old_token = await CallOperations(session).join_call(
        access.admin_id, access.org_id, call.id, "browser", None, old_auth.id
    )
    await AuthOperations(session, CallsLifecycle(open_session)).revoke_session(
        access.admin_id, old_auth.id
    )
    auth = await _auth_session(session, access.admin_id, access.org_id)
    _, _, token = await CallOperations(session).join_call(
        access.admin_id, access.org_id, call.id, "browser", None, auth.id
    )
    identity = f"{access.admin_id}:browser"
    stale = {
        "identity": identity,
        "sid": "stale-sfu-session",
        "metadata": dumps_str({"jti": old_token.jti}),
    }
    current = {
        "identity": identity,
        "sid": "current-sfu-session",
        "metadata": dumps_str({"jti": token.jti}),
    }
    livekit.remove_participant.reset_mock()
    livekit.get_participant.return_value = stale

    await calls_webhook.LiveKitWebhookProvider()._on_participant_joined(
        call.id, call.livekit_room_name, {"participant": stale}
    )
    livekit.remove_participant.assert_awaited_once_with(call.livekit_room_name, identity)
    assert await CallOperations(session).get_active_participant(call.id, identity) is not None

    livekit.remove_participant.reset_mock()
    livekit.list_rooms.return_value = [{"name": call.livekit_room_name}]
    livekit.list_participants.return_value = [stale]
    result = await calls_jobs.reconcile_calls({})
    assert result["status"] == "success"
    livekit.remove_participant.assert_awaited_once_with(call.livekit_room_name, identity)

    livekit.remove_participant.reset_mock()
    livekit.get_participant.return_value = current
    await calls_webhook.LiveKitWebhookProvider()._on_participant_joined(
        call.id, call.livekit_room_name, {"participant": stale}
    )
    livekit.remove_participant.assert_not_awaited()

    livekit.get_participant.side_effect = [stale, current]
    await calls_webhook.LiveKitWebhookProvider()._on_participant_joined(
        call.id, call.livekit_room_name, {"participant": stale}
    )
    livekit.remove_participant.assert_not_awaited()


async def test_join_webhook_refuses_revoked_session_even_before_row_eviction(
    session, access, livekit
):
    call = await _call(session, access)
    auth = await _auth_session(session, access.admin_id, access.org_id)
    _, _, token = await CallOperations(session).join_call(
        access.admin_id, access.org_id, call.id, "browser", None, auth.id
    )
    await session.execute(
        update(UserSession).where(UserSession.id == auth.id).values(is_revoked=True)
    )
    await session.commit()
    identity = f"{access.admin_id}:browser"
    live = {"identity": identity, "sid": "sfu-session", "metadata": dumps_str({"jti": token.jti})}
    livekit.get_participant.return_value = live

    await calls_webhook.LiveKitWebhookProvider()._on_participant_joined(
        call.id, call.livekit_room_name, {"participant": live}
    )

    livekit.remove_participant.assert_awaited_once_with(call.livekit_room_name, identity)
