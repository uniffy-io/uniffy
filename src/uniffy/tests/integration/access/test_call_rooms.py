import pytest
from sqlalchemy import select

from uniffy.core.models.calls.call import Call, CallEndReason
from uniffy.domains.calls.channels import CallsLifecycle
from uniffy.domains.calls.jobs import jobs as calls_jobs
from uniffy.domains.calls.livekit import LiveKitUnavailableError
from uniffy.domains.calls.operations import CallOperations
from uniffy.infrastructure.database import open_session
from uniffy.tests.integration.access.calls import (
    _call,
)
from uniffy.tests.integration.access.calls import (
    livekit as livekit,
)
from uniffy.tests.integration.access.calls import (
    scoped_reconciler as scoped_reconciler,
)

pytestmark = pytest.mark.asyncio(loop_scope="session")


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


@pytest.mark.parametrize("reason", [CallEndReason.ORG_SUSPENDED, CallEndReason.ORG_DELETED])
async def test_reconciler_retries_failed_organization_room_deletion(
    session, access, livekit, scoped_reconciler, reason
):
    call = await _call(session, access)
    livekit.delete_room.side_effect = LiveKitUnavailableError("control API unavailable")
    await CallsLifecycle(open_session).end_for_organization(session, access.org_id, reason)
    assert await session.scalar(select(Call.end_reason).where(Call.id == call.id)) == reason

    livekit.delete_room.side_effect = None
    livekit.list_rooms.return_value = [{"name": call.livekit_room_name}]
    result = await calls_jobs.reconcile_calls({})

    assert result["status"] == "success"
    assert result["closed_rooms"] == 1
    assert livekit.delete_room.await_count == 2
    livekit.delete_room.assert_awaited_with(call.livekit_room_name)


async def test_orphan_cleanup_preserves_call_created_after_reconciler_snapshot(
    session, access, livekit, scoped_reconciler
):
    created = []

    async def list_rooms():
        call = await _call(session, access)
        created.append(call.id)
        return [{"name": call.livekit_room_name}, {"name": "external-room"}]

    livekit.list_rooms.side_effect = list_rooms
    result = await calls_jobs.reconcile_calls({})

    assert result["status"] == "success"
    assert result["closed_rooms"] == 0
    assert len(created) == 1
    livekit.delete_room.assert_not_awaited()
