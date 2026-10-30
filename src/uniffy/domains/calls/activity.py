from datetime import UTC, datetime
from math import ceil, floor
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from uniffy_proto.calls.v1.calls_pb import (
    CallActivityBucket,
    CallActivityChunk,
    CallAttendance,
    ReportCallActivityResponse,
)

from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.calls import Call, CallActivity, CallParticipant
from uniffy.core.models.login.user_session import UserSession
from uniffy.domains.chat.access import ChatAccessChecker

CHUNK_SECONDS = 30
FULL_MASK = (1 << CHUNK_SECONDS) - 1
MAX_CHUNKS = 8
REPORT_GRACE_SECONDS = 120
MAX_BUCKETS = 240


class CallActivityOperations:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def report(
        self,
        user_id: UUID,
        organization_id: UUID,
        call_id: UUID,
        auth_session_id: UUID | None,
        device_id: str,
        participant_id: UUID | None,
        chunks: list[CallActivityChunk],
    ) -> ReportCallActivityResponse:
        if len(chunks) > MAX_CHUNKS or (chunks and participant_id is None):
            raise ValidationError("chunks", "Invalid activity batch")
        call = await self.session.get(Call, call_id)
        if call is None or call.organization_id != organization_id:
            raise NotFoundError("Call", str(call_id))
        access = ChatAccessChecker(self.session)
        channel = await access.get_channel(call.channel_id, organization_id)
        await access.check_access(user_id, organization_id, channel)
        query = (
            select(CallParticipant)
            .join(UserSession, UserSession.id == CallParticipant.auth_session_id)
            .where(
                UserSession.is_revoked.is_(False),
                CallParticipant.call_id == call_id,
                CallParticipant.organization_id == organization_id,
                CallParticipant.user_id == user_id,
                CallParticipant.device_id == device_id,
                CallParticipant.auth_session_id == auth_session_id,
            )
        )
        query = query.where(
            CallParticipant.id == participant_id
            if participant_id
            else CallParticipant.left_at.is_(None)
        )
        participant = await self.session.scalar(query.with_for_update(of=CallParticipant))
        if participant is None or auth_session_id is None:
            raise PermissionDeniedError("report activity", "Call attendance required")
        now = datetime.now(UTC)
        ended = min(participant.left_at or now, call.ended_at or now)
        if (now - ended).total_seconds() > REPORT_GRACE_SECONDS:
            raise ValidationError("chunks", "Activity reporting window expired")
        elapsed = max(0, (now - call.started_at).total_seconds())
        lower = max(
            0,
            floor((participant.joined_at - call.started_at).total_seconds()),
            floor(elapsed) - REPORT_GRACE_SECONDS,
        )
        upper = min(ceil(elapsed), ceil((ended - call.started_at).total_seconds()))
        merged: dict[int, tuple[int, int]] = {}
        for chunk in chunks:
            offset = chunk.offset_seconds
            observed, speaking = chunk.observed_mask, chunk.speaking_mask
            if offset % CHUNK_SECONDS or observed > FULL_MASK or speaking & observed != speaking:
                raise ValidationError("chunks", "Invalid activity masks")
            if offset > ceil(elapsed) or (observed >> max(0, ceil(elapsed) - offset)):
                raise ValidationError("chunks", "Activity cannot be in the future")
            valid = sum(1 << bit for bit in range(CHUNK_SECONDS) if lower <= offset + bit < upper)
            old_observed, old_speaking = merged.get(offset, (0, 0))
            merged[offset] = (old_observed | (observed & valid), old_speaking | (speaking & valid))
        values = [
            dict(
                participant_id=participant.id,
                offset_seconds=offset,
                observed_mask=observed,
                speaking_mask=speaking,
            )
            for offset, (observed, speaking) in sorted(merged.items())
            if observed
        ]
        if values:
            statement = insert(CallActivity).values(values)
            await self.session.execute(
                statement.on_conflict_do_update(
                    index_elements=[CallActivity.participant_id, CallActivity.offset_seconds],
                    set_={
                        "observed_mask": CallActivity.observed_mask.bitwise_or(
                            statement.excluded.observed_mask
                        ),
                        "speaking_mask": CallActivity.speaking_mask.bitwise_or(
                            statement.excluded.speaking_mask
                        ),
                    },
                )
            )
        await self.session.commit()
        return ReportCallActivityResponse(
            participant_id=str(participant.id), elapsed_seconds=elapsed
        )


async def populate_activity(session: AsyncSession, call: Call, people: list[CallAttendance]) -> None:
    """Union device samples before counting; response size stays bounded for long calls."""
    duration = max(1, ceil(((call.ended_at or datetime.now(UTC)) - call.started_at).total_seconds()))
    resolution = max(1, ceil(duration / MAX_BUCKETS))
    by_user = {UUID(person.user_id): person for person in people}
    if not by_user:
        return
    buckets = {
        uid: [CallActivityBucket(offset_seconds=offset) for offset in range(0, duration, resolution)]
        for uid in by_user
    }
    rows = await session.stream(
        select(CallParticipant.user_id, CallParticipant.joined_at, CallParticipant.left_at)
        .where(CallParticipant.call_id == call.id, CallParticipant.user_id.in_(by_user))
        .order_by(CallParticipant.user_id, CallParticipant.joined_at)
        .execution_options(yield_per=500)
    )
    previous_end: dict[UUID, int] = {}
    async for uid, joined, left in rows:
        start = max(0, floor((joined - call.started_at).total_seconds()), previous_end.get(uid, 0))
        end = min(
            duration,
            ceil(((left or call.ended_at or datetime.now(UTC)) - call.started_at).total_seconds()),
        )
        previous_end[uid] = max(previous_end.get(uid, 0), end)
        if end <= start:
            continue
        for index in range(start // resolution, (end - 1) // resolution + 1):
            bucket = buckets[uid][index]
            bucket.present_seconds += min(end, bucket.offset_seconds + resolution) - max(
                start, bucket.offset_seconds
            )
    rows = await session.stream(
        select(
            CallParticipant.user_id,
            CallActivity.offset_seconds,
            func.bit_or(CallActivity.observed_mask),
            func.bit_or(CallActivity.speaking_mask),
        )
        .join(CallActivity, CallActivity.participant_id == CallParticipant.id)
        .where(CallParticipant.call_id == call.id, CallParticipant.user_id.in_(by_user))
        .group_by(CallParticipant.user_id, CallActivity.offset_seconds)
        .execution_options(yield_per=500)
    )
    async for uid, offset, observed, speaking in rows:
        end = min(duration, offset + CHUNK_SECONDS)
        if end <= offset:
            continue
        for index in range(offset // resolution, (end - 1) // resolution + 1):
            bucket = buckets[uid][index]
            start_bit = max(offset, bucket.offset_seconds) - offset
            width = min(end, bucket.offset_seconds + resolution) - offset - start_bit
            mask = ((1 << width) - 1) << start_bit
            bucket.observed_seconds += (observed & mask).bit_count()
            bucket.speaking_seconds += (speaking & mask).bit_count()
    for uid, person in by_user.items():
        person.activity_resolution_seconds = resolution
        person.activity_duration_seconds = duration
        person.activity = buckets[uid]
        person.speaking_seconds = sum(bucket.speaking_seconds for bucket in buckets[uid])
        person.observed_seconds = sum(bucket.observed_seconds for bucket in buckets[uid])
        person.present_seconds = sum(bucket.present_seconds for bucket in buckets[uid])
