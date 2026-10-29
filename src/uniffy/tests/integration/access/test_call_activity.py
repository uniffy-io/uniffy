from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import delete, select, update
from uniffy_proto.calls.v1.calls_pb import CallActivityChunk

from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.calls import CallActivity, CallParticipant
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.domains.calls.activity import CallActivityOperations
from uniffy.domains.calls.history import CallHistoryReader
from uniffy.tests.integration.access.call_contention import contend
from uniffy.tests.integration.access.calls import _auth_session, _call, _participant

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def setup_activity(session, access):
    call = await _call(session, access)
    auth = await _auth_session(session, access.owner_id, access.org_id)
    person = await _participant(session, call, access.owner_id, auth_session_id=auth.id)
    call.started_at = datetime.now(UTC) - timedelta(seconds=60)
    person.joined_at = call.started_at
    await session.commit()
    return call, auth, person


async def report(session, access, call, auth, person, chunks):
    return await CallActivityOperations(session).report(
        access.owner_id, access.org_id, call.id, auth.id, person.device_id, person.id, chunks
    )


async def test_activity_retries_merge_devices_and_preserve_unknown_gaps(session, access):
    call, auth, person = await setup_activity(session, access)
    first = CallActivityChunk(offset_seconds=0, observed_mask=0b1111, speaking_mask=0b0011)
    await report(session, access, call, auth, person, [first])
    await report(session, access, call, auth, person, [first])
    await report(
        session,
        access,
        call,
        auth,
        person,
        [CallActivityChunk(offset_seconds=0, observed_mask=0b111100, speaking_mask=0b100100)],
    )
    second = await _participant(
        session, call, access.owner_id, device="second", auth_session_id=auth.id
    )
    second.joined_at = call.started_at
    await session.commit()
    await report(session, access, call, auth, second, [first])
    _, people, _ = await CallHistoryReader(session).get_record(
        access.owner_id, access.org_id, call.id
    )
    owner = next(item for item in people if item.user_id == str(access.owner_id))
    assert owner.observed_seconds == 6
    assert owner.speaking_seconds == 4
    assert owner.present_seconds >= 60
    assert owner.activity[3].observed_seconds == 1
    assert owner.activity[3].speaking_seconds == 0
    assert owner.activity[10].observed_seconds == 0
    assert owner.activity[10].present_seconds == 1
    assert (
        len(
            list(
                await session.scalars(
                    select(CallActivity).where(CallActivity.participant_id == person.id)
                )
            )
        )
        == 1
    )


async def test_activity_requires_matching_session_user_org_and_current_access(session, access):
    call, auth, person = await setup_activity(session, access)
    ops = CallActivityOperations(session)
    with pytest.raises(PermissionDeniedError):
        await ops.report(
            access.owner_id, access.org_id, call.id, None, person.device_id, person.id, []
        )
    with pytest.raises(PermissionDeniedError):
        await ops.report(access.owner_id, access.org_id, call.id, auth.id, "other", person.id, [])
    with pytest.raises(PermissionDeniedError):
        await ops.report(
            access.member_id, access.org_id, call.id, auth.id, person.device_id, person.id, []
        )
    with pytest.raises(NotFoundError):
        await ops.report(
            access.owner_id, access.other_org_id, call.id, auth.id, person.device_id, person.id, []
        )
    await session.execute(
        update(OrganizationMember)
        .where(
            OrganizationMember.organization_id == access.org_id,
            OrganizationMember.user_id == access.owner_id,
        )
        .values(is_active=False)
    )
    await session.commit()
    with pytest.raises(PermissionDeniedError):
        await report(session, access, call, auth, person, [])
    with pytest.raises(PermissionDeniedError):
        await CallHistoryReader(session).get_record(access.owner_id, access.org_id, call.id)


@pytest.mark.parametrize(
    "chunk",
    [
        CallActivityChunk(offset_seconds=1, observed_mask=1),
        CallActivityChunk(offset_seconds=0, observed_mask=1, speaking_mask=2),
        CallActivityChunk(offset_seconds=0, observed_mask=1 << 30),
        CallActivityChunk(offset_seconds=90, observed_mask=1),
    ],
)
async def test_activity_rejects_invalid_masks_and_future_data(session, access, chunk):
    call, auth, person = await setup_activity(session, access)
    with pytest.raises(ValidationError):
        await report(session, access, call, auth, person, [chunk])


async def test_activity_clips_to_attendance_and_accepts_final_batch(session, access):
    call, auth, person = await setup_activity(session, access)
    person.joined_at = call.started_at + timedelta(seconds=5)
    person.left_at = call.started_at + timedelta(seconds=10)
    call.ended_at = person.left_at
    await session.commit()
    await report(
        session,
        access,
        call,
        auth,
        person,
        [
            CallActivityChunk(
                offset_seconds=0, observed_mask=(1 << 30) - 1, speaking_mask=(1 << 30) - 1
            )
        ],
    )
    _, people, _ = await CallHistoryReader(session).get_record(
        access.owner_id, access.org_id, call.id
    )
    owner = next(item for item in people if item.user_id == str(access.owner_id))
    assert owner.observed_seconds == owner.speaking_seconds == 5
    assert all(bucket.observed_seconds == 0 for bucket in owner.activity[:5])
    person.left_at = datetime.now(UTC) - timedelta(seconds=121)
    call.ended_at = person.left_at
    await session.commit()
    with pytest.raises(ValidationError):
        await report(session, access, call, auth, person, [])


async def test_activity_bootstrap_and_older_calls(session, access):
    call, auth, person = await setup_activity(session, access)
    reply = await CallActivityOperations(session).report(
        access.owner_id, access.org_id, call.id, auth.id, person.device_id, None, []
    )
    assert reply.participant_id == str(person.id)
    assert 60 <= reply.elapsed_seconds < 65
    call.started_at = datetime.now(UTC) - timedelta(hours=8)
    await session.commit()
    _, people, _ = await CallHistoryReader(session).get_record(
        access.owner_id, access.org_id, call.id
    )
    assert all(len(item.activity) <= 240 for item in people)
    assert all(item.observed_seconds == 0 for item in people)
    with pytest.raises(ValidationError):
        await report(session, access, call, auth, person, [CallActivityChunk()] * 9)
    elapsed = int((datetime.now(UTC) - call.started_at).total_seconds())
    await report(
        session,
        access,
        call,
        auth,
        person,
        [
            CallActivityChunk(
                offset_seconds=elapsed // 30 * 30,
                observed_mask=1 << (elapsed % 30),
                speaking_mask=0,
            )
        ],
    )
    assert (
        await session.scalar(select(CallActivity).where(CallActivity.participant_id == person.id))
        is not None
    )
    await session.execute(delete(CallParticipant).where(CallParticipant.id == person.id))
    await session.commit()
    assert not list(
        await session.scalars(select(CallActivity).where(CallActivity.participant_id == person.id))
    )


async def test_concurrent_activity_reports_keep_both_masks(session, access):
    call, auth, person = await setup_activity(session, access)
    outcomes = await contend(
        select(CallParticipant).where(CallParticipant.id == person.id).with_for_update(),
        [
            lambda worker: report(
                worker,
                access,
                call,
                auth,
                person,
                [CallActivityChunk(offset_seconds=0, observed_mask=1, speaking_mask=1)],
            ),
            lambda worker: report(
                worker,
                access,
                call,
                auth,
                person,
                [CallActivityChunk(offset_seconds=0, observed_mask=2, speaking_mask=2)],
            ),
        ],
    )
    assert not any(isinstance(item, Exception) for item in outcomes)
    row = await session.scalar(select(CallActivity).where(CallActivity.participant_id == person.id))
    assert row.observed_mask == row.speaking_mask == 3


async def test_rejoined_attendance_keeps_gap_and_expired_reports_do_not_backfill(session, access):
    call, auth, person = await setup_activity(session, access)
    await session.execute(
        delete(CallParticipant).where(
            CallParticipant.call_id == call.id, CallParticipant.id != person.id
        )
    )
    person.left_at = call.started_at + timedelta(seconds=10)
    await session.commit()
    second = await _participant(session, call, access.owner_id, auth_session_id=auth.id)
    second.joined_at = call.started_at + timedelta(seconds=30)
    await session.commit()
    await report(
        session,
        access,
        call,
        auth,
        person,
        [CallActivityChunk(offset_seconds=0, observed_mask=1023, speaking_mask=3)],
    )
    await report(
        session,
        access,
        call,
        auth,
        second,
        [CallActivityChunk(offset_seconds=30, observed_mask=7, speaking_mask=1)],
    )
    _, people, _ = await CallHistoryReader(session).get_record(
        access.owner_id, access.org_id, call.id
    )
    owner = people[0]
    assert owner.observed_seconds == 13
    assert owner.activity[15].present_seconds == 0
    assert owner.activity[35].present_seconds == 1
    assert owner.activity[35].observed_seconds == 0
    call.started_at = datetime.now(UTC) - timedelta(minutes=10)
    second.joined_at = call.started_at
    await session.commit()
    await report(
        session,
        access,
        call,
        auth,
        second,
        [CallActivityChunk(offset_seconds=90, observed_mask=7, speaking_mask=7)],
    )
    assert (
        await session.scalar(
            select(CallActivity).where(
                CallActivity.participant_id == second.id, CallActivity.offset_seconds == 90
            )
        )
        is None
    )


async def test_activity_rejects_foreign_or_revoked_auth_session(session, access):
    call, auth, person = await setup_activity(session, access)
    other = await _auth_session(session, access.owner_id, access.org_id)
    with pytest.raises(PermissionDeniedError):
        await report(session, access, call, other, person, [])
    auth.is_revoked = True
    await session.commit()
    with pytest.raises(PermissionDeniedError):
        await report(session, access, call, auth, person, [])


async def test_long_call_aggregation_preserves_counts_across_bucket_boundaries(session, access):
    call, auth, person = await setup_activity(session, access)
    call.started_at = datetime.now(UTC) - timedelta(seconds=28817)
    person.joined_at = call.started_at
    await session.commit()
    await report(
        session,
        access,
        call,
        auth,
        person,
        [
            CallActivityChunk(
                offset_seconds=28770, observed_mask=(1 << 30) - 1, speaking_mask=1 << 29
            )
        ],
    )
    _, people, _ = await CallHistoryReader(session).get_record(
        access.owner_id, access.org_id, call.id
    )
    owner = people[0]
    assert owner.activity_resolution_seconds == 121
    assert owner.observed_seconds == 30
    assert owner.speaking_seconds == 1
    last = next(bucket for bucket in owner.activity if bucket.offset_seconds == 28798)
    assert last.observed_seconds == 2
    assert last.speaking_seconds == 1
