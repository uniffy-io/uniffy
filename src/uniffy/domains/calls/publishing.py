"""Persist speaker grants and reconcile media publishing against current call policy."""

from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.calls import Call, CallParticipant, CallType
from uniffy.domains.calls.admission import matches_media_session
from uniffy.domains.calls.converters import call_to_event_dict
from uniffy.domains.calls.livekit import LiveKitApiError, get_livekit_admin_client
from uniffy.domains.calls.policy import load_call_policy
from uniffy.domains.chat.access import ChatAccessChecker
from uniffy.domains.chat.calls import CALL_UPDATED, CallChat, build_call_lifecycle_payload


def can_publish(call: Call, user_id: UUID) -> bool:
    return (
        not call.town_hall or call.host_user_id == user_id or str(user_id) in call.speaker_user_ids
    )


async def town_hall_allowed(session: AsyncSession, organization_id: UUID, channel_id: UUID) -> bool:
    policy = await load_call_policy(session, organization_id)
    return policy is None or (
        policy.town_hall_enabled
        and (not policy.town_hall_channel_ids or str(channel_id) in policy.town_hall_channel_ids)
    )


class CallPublishing:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.access = ChatAccessChecker(session)
        self.chat = CallChat(session)

    async def _moderated_call(self, actor: UUID, organization_id: UUID, call_id: UUID) -> Call:
        call = await self.session.scalar(
            select(Call)
            .where(Call.id == call_id, Call.organization_id == organization_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if call is None:
            raise NotFoundError("call", call_id)
        channel = await self.access.get_channel(call.channel_id, organization_id)
        await self.access.check_access(actor, organization_id, channel)
        if call.ended_at is not None or channel.is_archived:
            raise ValidationError("call", "Call has ended")
        if call.host_user_id != actor and not await self.access.require_elevated(
            actor, organization_id, call.channel_id
        ):
            raise PermissionDeniedError(
                "manage speakers", "Only the host or a channel moderator can manage speakers"
            )
        return call

    async def set_mode(
        self, actor: UUID, organization_id: UUID, call_id: UUID, *, town_hall: bool
    ) -> Call:
        call = await self._moderated_call(actor, organization_id, call_id)
        if town_hall:
            if call.call_type != CallType.CHANNEL or not await town_hall_allowed(
                self.session, organization_id, call.channel_id
            ):
                raise PermissionDeniedError(
                    "town hall", "Town halls are not enabled for this channel"
                )
        if call.town_hall != town_hall:
            call.town_hall = town_hall
            # Starting a town hall keeps only the current host on stage.
            call.speaker_user_ids = []
            await self._stage_change(call, actor)
        await self.session.commit()
        await self.sync_and_publish(call.id)
        return call

    async def set_speaker(
        self, actor: UUID, organization_id: UUID, call_id: UUID, user_id: UUID, *, speaker: bool
    ) -> Call:
        call = await self._moderated_call(actor, organization_id, call_id)
        if not call.town_hall:
            raise ValidationError("call", "Speaker roles are only available in town halls")
        if user_id == call.host_user_id:
            raise ValidationError("speaker", "The host remains a speaker")
        active = await self.session.scalar(
            select(CallParticipant.id)
            .where(
                CallParticipant.call_id == call.id,
                CallParticipant.user_id == user_id,
                CallParticipant.left_at.is_(None),
            )
            .limit(1)
        )
        if active is None:
            raise NotFoundError("participant", user_id)
        if speaker:
            channel = await self.access.get_channel(call.channel_id, organization_id)
            await self.access.check_access(user_id, organization_id, channel)
        speakers = set(call.speaker_user_ids)
        if (str(user_id) in speakers) != speaker:
            if speaker:
                if len(speakers) >= 1000:
                    raise ValidationError("speakers", "A call can have at most 1000 speaker grants")
                speakers.add(str(user_id))
            else:
                speakers.discard(str(user_id))
            call.speaker_user_ids = sorted(speakers)
            await self._stage_change(call, actor)
        if speaker:
            await self.session.execute(
                update(CallParticipant)
                .where(
                    CallParticipant.call_id == call.id,
                    CallParticipant.user_id == user_id,
                    CallParticipant.left_at.is_(None),
                    CallParticipant.hand_raised_at.is_not(None),
                )
                .values(hand_raised_at=None, hand_revision=CallParticipant.hand_revision + 1)
            )
        await self.session.commit()
        await self.sync_and_publish(call.id)
        return call

    async def _stage_change(self, call: Call, actor: UUID) -> None:
        call.publishing_revision += 1
        self.session.add(call)
        if call.town_hall:
            speakers = [call.host_user_id, *(UUID(uid) for uid in call.speaker_user_ids)]
            await self.session.execute(
                update(CallParticipant)
                .where(
                    CallParticipant.call_id == call.id,
                    CallParticipant.left_at.is_(None),
                    CallParticipant.user_id.not_in(speakers),
                )
                .values(mic_enabled=False, camera_enabled=False, screen_sharing=False)
            )
        await write_audit_event(
            self.session,
            organization_id=call.organization_id,
            actor_user_id=actor,
            action=Action.CALL_PUBLISHING_CHANGED,
            resource_type=AuditResourceType.CALL,
            resource_id=call.id,
            details={
                "town_hall": call.town_hall,
                "speaker_user_ids": call.speaker_user_ids,
                "publishing_revision": call.publishing_revision,
            },
        )

    async def sync(self, call_id: UUID) -> None:
        # A fresh lock orders external effects across concurrent role changes and joins.
        call = await self.session.scalar(
            select(Call)
            .where(Call.id == call_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if call is None or call.ended_at is not None:
            await self.session.commit()
            return
        client = get_livekit_admin_client()
        try:
            live = await client.list_participants(call.livekit_room_name)
            participants = {
                p.identity: p
                for p in (
                    await self.session.scalars(
                        select(CallParticipant).where(
                            CallParticipant.call_id == call.id, CallParticipant.left_at.is_(None)
                        )
                    )
                ).all()
            }
            for entry in live:
                participant = participants.get(entry.get("identity", ""))
                if participant is None or not matches_media_session(
                    entry, participant.token_jti, participant.session_jti
                ):
                    continue
                allowed = can_publish(call, participant.user_id)
                permission = entry.get("permission") or {}
                actual = permission.get("canPublish", permission.get("can_publish", False))
                if actual is allowed:
                    continue
                try:
                    await client.set_publishing(
                        call.livekit_room_name, participant.identity, allowed=allowed
                    )
                except LiveKitApiError as exc:
                    if exc.status_code != 404:
                        raise
        except LiveKitApiError as exc:
            if exc.status_code != 404:
                raise
        finally:
            await self.session.commit()

    async def sync_and_publish(self, call_id: UUID) -> None:
        try:
            await self.sync(call_id)
        finally:
            call = await self.session.get(Call, call_id, populate_existing=True)
            if call is not None and call.ended_at is None:
                participants = list(
                    (
                        await self.session.scalars(
                            select(CallParticipant).where(
                                CallParticipant.call_id == call.id, CallParticipant.left_at.is_(None)
                            )
                        )
                    ).all()
                )
                profiles = await self.chat.resolve_profiles([p.user_id for p in participants])
                recipients = set(await self.chat.member_user_ids(call.channel_id))
                recipients.update(p.user_id for p in participants)
                await self.chat.publish(
                    list(recipients),
                    CALL_UPDATED,
                    build_call_lifecycle_payload(call_to_event_dict(call, participants, profiles)),
                    channel_id=call.channel_id,
                )
