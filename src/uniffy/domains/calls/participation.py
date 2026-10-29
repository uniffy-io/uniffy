from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uniffy_proto.calls.v1.calls_pb import CallReaction

from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.calls import Call, CallParticipant
from uniffy.core.models.login.user_session import UserSession
from uniffy.core.rate_limit import check_rate_limit
from uniffy.core.types import generate_id
from uniffy.domains.calls.operations import CallOperations
from uniffy.domains.calls.tokens import participant_identity
from uniffy.domains.chat.calls import CALL_REACTION

REACTIONS = frozenset({
    CallReaction.AGREE,
    CallReaction.APPLAUSE,
    CallReaction.LOVE,
    CallReaction.CELEBRATE,
})


class CallParticipation:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.calls = CallOperations(session)

    async def _participant(
        self,
        user_id: UUID,
        organization_id: UUID,
        call_id: UUID,
        device_id: str,
        auth_session_id: UUID | None,
    ) -> tuple[Call, CallParticipant]:
        if auth_session_id is None:
            raise PermissionDeniedError("participate", "An active session is required")
        # The call lock serializes participation with admission and termination.
        call = await self.session.scalar(
            select(Call)
            .where(Call.id == call_id, Call.organization_id == organization_id)
            .with_for_update()
        )
        if call is None:
            raise NotFoundError("call", call_id)
        channel = await self.calls.access.get_channel(call.channel_id, organization_id)
        await self.calls.access.check_access(user_id, organization_id, channel)
        if call.ended_at is not None:
            raise ValidationError("call", "Call has ended")
        participant = await self.session.scalar(
            select(CallParticipant)
            .join(UserSession, UserSession.id == CallParticipant.auth_session_id)
            .where(
                UserSession.is_revoked.is_(False),
                CallParticipant.call_id == call.id,
                CallParticipant.identity == participant_identity(user_id, device_id),
                CallParticipant.auth_session_id == auth_session_id,
                CallParticipant.left_at.is_(None),
            )
            .with_for_update(of=CallParticipant)
        )
        if participant is None:
            raise PermissionDeniedError("participate", "Join this call first")
        return call, participant

    async def set_hand(
        self,
        user_id: UUID,
        organization_id: UUID,
        call_id: UUID,
        device_id: str,
        auth_session_id: UUID | None,
        *,
        raised: bool,
        identity: str | None = None,
    ) -> CallParticipant:
        call, participant = await self._participant(
            user_id,
            organization_id,
            call_id,
            device_id,
            auth_session_id,
        )
        if identity and identity != participant.identity:
            if raised:
                raise PermissionDeniedError("raise hand", "You can only raise your own hand")
            await self.calls._require_moderation(user_id, call, "lower hand")
            target = await self.session.scalar(
                select(CallParticipant)
                .where(
                    CallParticipant.call_id == call.id,
                    CallParticipant.identity == identity,
                    CallParticipant.left_at.is_(None),
                )
                .with_for_update()
            )
            if target is None:
                raise NotFoundError("participant", identity)
            participant = target
        changed = (participant.hand_raised_at is not None) != raised
        if changed:
            participant.hand_raised_at = datetime.now(UTC) if raised else None
            participant.hand_revision += 1
            self.session.add(participant)
        await self.session.commit()
        if changed:
            await self.calls.publish_participant_state(call, participant)
        return participant

    async def react(
        self,
        user_id: UUID,
        organization_id: UUID,
        call_id: UUID,
        device_id: str,
        auth_session_id: UUID | None,
        *,
        reaction: CallReaction,
    ) -> None:
        if reaction not in REACTIONS:
            raise ValidationError("reaction", "Choose a supported reaction")
        call, _ = await self._participant(
            user_id, organization_id, call_id, device_id, auth_session_id
        )
        await check_rate_limit(
            key=f"call-reaction:{organization_id}:{call_id}:{user_id}",
            limit=5,
            window_seconds=10,
            resource="call reaction",
        )
        active = await self.calls.list_active_participants(call_id)
        recipients = list({p.user_id for p in active})
        profile = await self.calls.chat.resolve_profile(user_id)
        await self.session.commit()
        await self.calls.chat.publish(
            recipients,
            CALL_REACTION,
            {
                "call_id": str(call_id),
                "id": str(generate_id()),
                "user_id": str(user_id),
                "display_name": profile.display_name,
                "reaction": int(reaction),
                "expires_at": (datetime.now(UTC) + timedelta(seconds=5)).isoformat(),
            },
            channel_id=call.channel_id,
        )
