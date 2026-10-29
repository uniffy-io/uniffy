"""Invitation outcomes belong to users, independent of connected devices."""

from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import case, cast, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.calls import Call, CallInvitation, CallInvitationOutcome, CallType
from uniffy.core.models.chat.channel import ChatChannel
from uniffy.core.models.chat.channel_member import ChatChannelMember
from uniffy.core.types import SubjectType
from uniffy.domains.chat.access import ChatAccessChecker

RING_TIMEOUT_SECONDS = 30
SILENT_JOIN_MEMBER_THRESHOLD = 10


class CallInvitations:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.access = ChatAccessChecker(session)

    async def stage_recipients(self, call: Call, channel: ChatChannel) -> None:
        members = list(
            await self.session.scalars(
                select(ChatChannelMember.user_id)
                .where(
                    ChatChannelMember.channel_id == channel.id,
                    ChatChannelMember.subject_type == SubjectType.USER,
                    ChatChannelMember.user_id.is_not(None),
                )
                .limit(SILENT_JOIN_MEMBER_THRESHOLD if call.call_type == CallType.CHANNEL else 500)
            )
        )
        if call.call_type == CallType.CHANNEL and len(members) >= SILENT_JOIN_MEMBER_THRESHOLD:
            return
        recipients = await self.access.filter_viewers(
            call.organization_id, channel, [uid for uid in members if uid != call.initiator_user_id]
        )
        if not recipients:
            return
        now = datetime.now(UTC)
        await self.session.execute(
            insert(CallInvitation)
            .values([
                dict(
                    call_id=call.id,
                    user_id=uid,
                    organization_id=call.organization_id,
                    outcome=CallInvitationOutcome.RINGING,
                    created_at=now,
                    expires_at=now + timedelta(seconds=RING_TIMEOUT_SECONDS),
                )
                for uid in recipients
            ])
            .on_conflict_do_nothing(index_elements=["call_id", "user_id"])
        )

    async def stage_answer(self, call_id: UUID, user_id: UUID) -> None:
        now = datetime.now(UTC)
        await self.session.execute(
            update(CallInvitation)
            .where(
                CallInvitation.call_id == call_id,
                CallInvitation.user_id == user_id,
                CallInvitation.outcome == CallInvitationOutcome.RINGING,
            )
            .values(
                outcome=cast(
                    case(
                        (CallInvitation.expires_at > now, CallInvitationOutcome.ANSWERED.value),
                        else_=CallInvitationOutcome.MISSED.value,
                    ),
                    CallInvitation.__table__.c.outcome.type,
                ),
                responded_at=now,
            )
        )

    async def stage_end(self, call_id: UUID, ended_at: datetime) -> None:
        await self.session.execute(
            update(CallInvitation)
            .where(
                CallInvitation.call_id == call_id,
                CallInvitation.outcome == CallInvitationOutcome.RINGING,
            )
            .values(outcome=CallInvitationOutcome.MISSED, responded_at=ended_at)
        )

    async def decline(self, user_id: UUID, organization_id: UUID, call_id: UUID) -> None:
        call = await self.session.scalar(
            select(Call)
            .where(Call.id == call_id, Call.organization_id == organization_id)
            .with_for_update()
        )
        if call is None:
            raise NotFoundError("call", call_id)
        channel = await self.access.get_channel(call.channel_id, organization_id)
        await self.access.check_access(user_id, organization_id, channel)
        invitation = await self.session.get(
            CallInvitation, (call_id, user_id), populate_existing=True, with_for_update=True
        )
        if invitation is None:
            raise PermissionDeniedError("decline", "You were not invited to this call")
        if invitation.outcome == CallInvitationOutcome.RINGING:
            now = datetime.now(UTC)
            invitation.outcome = (
                CallInvitationOutcome.DECLINED
                if call.ended_at is None and invitation.expires_at > now
                else CallInvitationOutcome.MISSED
            )
            invitation.responded_at = now
            await write_audit_event(
                self.session,
                organization_id=organization_id,
                actor_user_id=user_id,
                action=Action.CALL_INVITATION_RESPONDED,
                resource_type=AuditResourceType.CALL,
                resource_id=call_id,
                details={"outcome": invitation.outcome.value},
            )
        await self.session.commit()

    async def expire(self, limit: int = 500) -> int:
        now = datetime.now(UTC)
        rows = list(
            await self.session.scalars(
                select(CallInvitation)
                .where(
                    CallInvitation.outcome == CallInvitationOutcome.RINGING,
                    CallInvitation.expires_at <= now,
                )
                .order_by(CallInvitation.expires_at)
                .limit(limit)
                .with_for_update(skip_locked=True)
            )
        )
        for row in rows:
            row.outcome = CallInvitationOutcome.MISSED
            row.responded_at = row.expires_at
        await self.session.commit()
        return len(rows)
