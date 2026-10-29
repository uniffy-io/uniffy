from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import exists, func, or_, select, tuple_, union
from sqlalchemy.ext.asyncio import AsyncSession
from uniffy_proto.calls.v1.calls_pb import CallAttendance, CallRecord
from uniffy_proto.calls.v1.calls_pb import CallInvitationOutcome as ProtoOutcome

from uniffy.core.content.base_operations import BaseContentOperations
from uniffy.core.converters.proto import datetime_to_timestamp
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.calls import Call, CallInvitation, CallInvitationOutcome, CallParticipant
from uniffy.core.pagination import decode_time_cursor, encode_time_cursor
from uniffy.core.types import ContentRole, ContentType
from uniffy.domains.calls.activity import populate_activity
from uniffy.domains.calls.converters import call_to_proto
from uniffy.domains.chat.access import ChatAccessChecker
from uniffy.domains.chat.calls import CallChat


def invitation_outcome(invitation: CallInvitation | None) -> ProtoOutcome:
    if invitation is None:
        return ProtoOutcome.UNSPECIFIED
    outcome = invitation.outcome
    if outcome == CallInvitationOutcome.RINGING and invitation.expires_at <= datetime.now(UTC):
        outcome = CallInvitationOutcome.MISSED
    return ProtoOutcome[outcome.name]


def page_limit(size: int) -> int:
    if size < 0 or size > 500:
        raise ValidationError("page_size", "Must be between 1 and 500")
    return size or 200


class CallHistoryReader(BaseContentOperations[Call]):
    content_type = ContentType.CALL
    model_class = Call

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session)
        self.access = ChatAccessChecker(session)

    def _build_search_keywords(self, model: Call) -> str:
        return model.title

    def _get_search_title(self, model: Call) -> str:
        return model.title

    def _get_url_path(self, model: Call) -> str:
        return f"/calls/{model.id}"

    def _get_search_metadata(self, model: Call) -> dict[str, str]:
        return {
            "channel_id": str(model.channel_id),
            "started_at": model.started_at.isoformat(),
            "ended_at": model.ended_at.isoformat() if model.ended_at else "",
            "status": "ended" if model.ended_at else "active",
            "end_reason": model.end_reason.value if model.end_reason else "",
        }

    async def _require_view(self, user_id: UUID, organization_id: UUID, content: Call) -> None:
        channel = await self.access.get_channel(content.channel_id, organization_id)
        await self.access.check_access(user_id, organization_id, channel)

    async def _resolve_role(
        self, user_id: UUID, organization_id: UUID, content: Call
    ) -> ContentRole | None:
        try:
            await self._require_view(user_id, organization_id, content)
        except PermissionDeniedError, NotFoundError:
            return None
        return ContentRole.VIEWER

    async def list_history(
        self,
        user_id: UUID,
        organization_id: UUID,
        *,
        channel_id: UUID | None = None,
        cursor: str = "",
        page_size: int = 0,
    ) -> tuple[list[CallRecord], str]:
        limit = page_limit(page_size)
        await self.access.require_org_member(user_id, organization_id)
        visible = await self.access.accessible_channels_statement(user_id, organization_id)
        query = select(Call).where(
            Call.organization_id == organization_id, Call.channel_id.in_(visible)
        )
        if channel_id is not None:
            channel = await self.access.get_channel(channel_id, organization_id)
            await self.access.check_access(user_id, organization_id, channel)
            query = query.where(Call.channel_id == channel_id)
        else:
            query = query.where(
                or_(
                    Call.initiator_user_id == user_id,
                    exists(
                        select(CallParticipant.id).where(
                            CallParticipant.call_id == Call.id, CallParticipant.user_id == user_id
                        )
                    ),
                    exists(
                        select(CallInvitation.call_id).where(
                            CallInvitation.call_id == Call.id, CallInvitation.user_id == user_id
                        )
                    ),
                )
            )
        if cursor:
            moment, row_id = decode_time_cursor(cursor)
            if moment.tzinfo is None:
                raise ValidationError("cursor", "Invalid timestamp")
            query = query.where(tuple_(Call.started_at, Call.id) < tuple_(moment, row_id))
        rows = list(
            await self.session.scalars(
                query.order_by(Call.started_at.desc(), Call.id.desc()).limit(limit + 1)
            )
        )
        next_cursor = (
            encode_time_cursor(rows[limit - 1].started_at, rows[limit - 1].id)
            if len(rows) > limit
            else ""
        )
        return await self.records(rows[:limit], user_id), next_cursor

    async def records(self, calls: list[Call], user_id: UUID) -> list[CallRecord]:
        if not calls:
            return []
        ids = [call.id for call in calls]
        counts = dict(
            (
                await self.session.execute(
                    select(
                        CallParticipant.call_id, func.count(func.distinct(CallParticipant.user_id))
                    )
                    .where(CallParticipant.call_id.in_(ids))
                    .group_by(CallParticipant.call_id)
                )
            ).all()
        )
        attended = set(
            await self.session.scalars(
                select(CallParticipant.call_id).where(
                    CallParticipant.call_id.in_(ids), CallParticipant.user_id == user_id
                )
            )
        )
        invitations = {
            row.call_id: row
            for row in await self.session.scalars(
                select(CallInvitation).where(
                    CallInvitation.call_id.in_(ids), CallInvitation.user_id == user_id
                )
            )
        }
        return [
            CallRecord(
                call=call_to_proto(call, []),
                urn=call.urn,
                title=call.title,
                participant_count=counts.get(call.id, 0),
                attended=call.id in attended,
                invitation_outcome=invitation_outcome(invitations.get(call.id)),
            )
            for call in calls
        ]

    async def get_record(
        self,
        user_id: UUID,
        organization_id: UUID,
        call_id: UUID,
        *,
        cursor: str = "",
        page_size: int = 0,
    ) -> tuple[CallRecord, list[CallAttendance], str]:
        limit = page_limit(page_size)
        call = await self.get_by_id(user_id, organization_id, call_id)
        people = union(
            select(CallParticipant.user_id).where(CallParticipant.call_id == call_id),
            select(CallInvitation.user_id).where(CallInvitation.call_id == call_id),
        ).subquery()
        query = select(people.c.user_id).order_by(people.c.user_id).limit(limit + 1)
        if cursor:
            try:
                after = UUID(cursor)
            except ValueError as exc:
                raise ValidationError("participant_cursor", "Invalid cursor") from exc
            query = query.where(people.c.user_id > after)
        ids = list(await self.session.scalars(query))
        next_cursor = str(ids[limit - 1]) if len(ids) > limit else ""
        ids = ids[:limit]
        attendance = {
            row.user_id: row
            for row in (
                await self.session.execute(
                    select(
                        CallParticipant.user_id,
                        func.min(CallParticipant.joined_at).label("joined_at"),
                        func.max(CallParticipant.left_at).label("left_at"),
                        func.bool_or(CallParticipant.left_at.is_(None)).label("active"),
                    )
                    .where(CallParticipant.call_id == call_id, CallParticipant.user_id.in_(ids))
                    .group_by(CallParticipant.user_id)
                )
            ).all()
        }
        invitations = {
            row.user_id: row
            for row in await self.session.scalars(
                select(CallInvitation).where(
                    CallInvitation.call_id == call_id, CallInvitation.user_id.in_(ids)
                )
            )
        }
        profiles = await CallChat(self.session).resolve_profiles(ids)
        participants = []
        for uid in ids:
            profile = profiles.get(uid)
            row = attendance.get(uid)
            item = CallAttendance(
                user_id=str(uid),
                display_name=profile.display_name if profile else "Former member",
                avatar_url=profile.avatar_url or "" if profile else "",
                invitation_outcome=invitation_outcome(invitations.get(uid)),
            )
            if row is not None:
                item.joined_at = datetime_to_timestamp(row.joined_at)
                if not row.active and row.left_at:
                    item.left_at = datetime_to_timestamp(row.left_at)
            participants.append(item)
        await populate_activity(self.session, call, participants)
        return (await self.records([call], user_id))[0], participants, next_cursor
