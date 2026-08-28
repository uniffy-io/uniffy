"""Call lifecycle business logic.

Access rides on chat channel membership via ChatAccessChecker - a call is a
property of its channel, not standalone content. Stream events publish after
commit so receivers never observe state the DB does not hold yet.
"""

from datetime import UTC, datetime, timedelta
from uuid import UUID

from loguru import logger
from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import set_committed_value

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.content.references import sanitize_mention_label
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.calls import (
    Call,
    CallEndReason,
    CallParticipant,
    CallType,
    ScreenShareQuality,
)
from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.models.chat.channel_member import ChatChannelMember
from uniffy.core.models.chat.message import ChatMessageMetadataKind, SenderType
from uniffy.core.types import SubjectType
from uniffy.domains.calls.config import (
    LiveKitConfigError,
    default_screen_share_quality,
    get_livekit_config,
)
from uniffy.domains.calls.converters import call_to_event_dict, participant_to_event_dict
from uniffy.domains.calls.livekit import LiveKitApiError, get_livekit_admin_client
from uniffy.domains.calls.policy import (
    DEFAULT_MAX_PARTICIPANTS,
    ResolvedCallPolicy,
    load_call_policy,
    save_call_policy,
)
from uniffy.domains.calls.tokens import (
    LiveKitTokenMinter,
    MintedToken,
    livekit_room_name,
    participant_identity,
)
from uniffy.domains.chat.access import ChatAccessChecker
from uniffy.domains.chat.cache import fetch_channel_members
from uniffy.domains.chat.messages.operations import ChatMessageOperations
from uniffy.domains.chat.senders import SenderInfo, SenderResolver
from uniffy.domains.chat.streaming import events as evt
from uniffy.domains.chat.streaming.publisher import publish_channel_event_to_members

logger = logger.bind(component="calls.operations")

RING_TIMEOUT_SECONDS = 30
SILENT_JOIN_MEMBER_THRESHOLD = 10
MAX_DEVICES_PER_USER = 2
CALL_SUMMARY_MAX_MENTIONS = 6


def _format_call_duration(seconds: int) -> str:
    if seconds >= 3600:
        return f"{seconds // 3600}h {(seconds % 3600) // 60:02d}m"
    if seconds >= 60:
        return f"{seconds // 60}m {seconds % 60:02d}s"
    return f"{seconds}s"


def _user_mention(user_id: UUID, display_name: str) -> str:
    label = sanitize_mention_label(display_name or "Someone")
    return f"[[[{label}|urn:uniffy:content:USER:{user_id}]]]"


_CHANNEL_TYPE_TO_CALL_TYPE = {
    ChannelType.DIRECT: CallType.DIRECT,
    ChannelType.GROUP_DM: CallType.GROUP_DM,
    ChannelType.PUBLIC: CallType.CHANNEL,
    ChannelType.PRIVATE: CallType.CHANNEL,
}


def _policy_cap_for_type(policy: ResolvedCallPolicy, call_type: CallType) -> int:
    """The raw per-type ceiling stored on the policy for this call type."""
    if call_type == CallType.DIRECT:
        return policy.max_screen_share_quality_direct
    if call_type == CallType.GROUP_DM:
        return policy.max_screen_share_quality_group
    return policy.max_screen_share_quality_channel


class CallOperations:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.access = ChatAccessChecker(session)
        self._minter = LiveKitTokenMinter(get_livekit_config())
        self._resolver = SenderResolver(session)

    async def initiate_call(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        device_id: str,
        device_label: str | None = None,
    ) -> tuple[Call, list[CallParticipant], MintedToken, bool]:
        """Start a call, or join the channel's active call when one exists.

        Returns (call, active_participants, token, joined_existing).
        """
        channel = await self.access.get_channel(channel_id, organization_id)
        await self.access.check_access(user_id, organization_id, channel)
        if channel.is_archived:
            raise ValidationError("channel", "Channel is archived")
        await self._require_calls_enabled(organization_id)
        await self._require_not_in_another_call(user_id, organization_id, exclude_channel=channel_id)

        existing = await self.get_active_call_row(channel_id)
        if existing is not None:
            token, participants = await self._join(
                existing, channel, user_id, device_id, device_label
            )
            return existing, participants, token, True

        call = Call(
            organization_id=organization_id,
            channel_id=channel_id,
            call_type=_CHANNEL_TYPE_TO_CALL_TYPE[channel.channel_type],
            initiator_user_id=user_id,
            host_user_id=user_id,
            livekit_room_name="",
        )
        call.livekit_room_name = livekit_room_name(organization_id, call.id)
        self.session.add(call)
        try:
            await self.session.flush()
        except IntegrityError:
            # Lost the concurrent-start race; the winner's call is the call.
            await self.session.rollback()
            existing = await self.get_active_call_row(channel_id)
            if existing is None:
                raise
            token, participants = await self._join(
                existing, channel, user_id, device_id, device_label
            )
            return existing, participants, token, True

        # Rides the _join commit so the audit row lands atomically with the call.
        await write_audit_event(
            self.session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=Action.CALL_STARTED,
            resource_type=AuditResourceType.CALL,
            resource_id=call.id,
            details={
                "channel_id": str(channel_id),
                "call_type": call.call_type.value,
            },
        )
        token, participants = await self._join(
            call, channel, user_id, device_id, device_label, is_start=True
        )
        await self._ring_callees(call, channel, user_id)
        info = (await self.resolve_profiles([user_id])).get(user_id)
        await self._post_call_system_message(
            call,
            f"{_user_mention(user_id, getattr(info, 'display_name', ''))} started a call",
            user_id,
            ChatMessageMetadataKind.CALL_STARTED,
        )
        return call, participants, token, False

    async def join_call(
        self,
        user_id: UUID,
        organization_id: UUID,
        call_id: UUID,
        device_id: str,
        device_label: str | None = None,
    ) -> tuple[Call, list[CallParticipant], MintedToken]:
        call = await self._get_call(call_id, organization_id, require_active=True)
        channel = await self.access.get_channel(call.channel_id, organization_id)
        await self.access.check_access(user_id, organization_id, channel)
        if channel.is_archived:
            raise ValidationError("channel", "Channel is archived")
        await self._require_calls_enabled(organization_id)
        await self._require_not_in_another_call(
            user_id, organization_id, exclude_channel=call.channel_id
        )
        token, participants = await self._join(call, channel, user_id, device_id, device_label)
        return call, participants, token

    async def leave_call(
        self, user_id: UUID, organization_id: UUID, call_id: UUID, device_id: str
    ) -> None:
        call = await self._get_call(call_id, organization_id)
        participant = await self.get_active_participant(
            call_id, participant_identity(user_id, device_id)
        )
        if participant is None or call.ended_at is not None:
            return
        await self.mark_participant_left(call, participant)

    async def end_call(
        self,
        user_id: UUID,
        organization_id: UUID,
        call_id: UUID,
        reason: CallEndReason = CallEndReason.HOST_ENDED,
    ) -> None:
        call = await self._get_call(call_id, organization_id, require_active=True)
        if call.host_user_id != user_id and not await self.access.require_elevated(
            user_id, organization_id, call.channel_id
        ):
            raise PermissionDeniedError("end", "Only the host can end the call")
        await self.end_call_internal(call, reason, actor_user_id=user_id)

    async def refresh_token(
        self, user_id: UUID, organization_id: UUID, call_id: UUID, device_id: str
    ) -> MintedToken:
        call = await self._get_call(call_id, organization_id, require_active=True)
        identity = participant_identity(user_id, device_id)
        participant = await self.get_active_participant(call_id, identity)
        if participant is None:
            raise PermissionDeniedError("refresh", "Not an active participant")

        channel = await self.access.get_channel(call.channel_id, organization_id)
        await self.access.check_access(user_id, organization_id, channel)

        info = await self._resolver.resolve_one(SenderType.USER, user_id)
        token = self._minter.mint_user_token(
            organization_id=organization_id,
            call_id=call.id,
            user_id=user_id,
            device_id=device_id,
            display_name=info.display_name,
            device_label=participant.device_label,
        )
        # session_jti stays put: the live SFU session keeps emitting its original
        # jti because the refreshed token is never handed to the Room.
        participant.token_jti = token.jti
        self.session.add(participant)
        await self.session.commit()
        return token

    async def get_active_call(
        self, user_id: UUID, organization_id: UUID, channel_id: UUID
    ) -> tuple[Call, list[CallParticipant]] | None:
        channel = await self.access.get_channel(channel_id, organization_id)
        await self.access.check_access(user_id, organization_id, channel)
        call = await self.get_active_call_row(channel_id)
        if call is None:
            return None
        return call, await self.list_active_participants(call.id)

    async def list_active_calls_for_user(
        self, user_id: UUID, organization_id: UUID
    ) -> list[tuple[Call, list[CallParticipant]]]:
        """Resync snapshot: active calls the user can see - channels they belong to, plus any call
        they are an active participant of. A joiner in an unjoined PUBLIC channel (or an admin
        moderating) has no member row, so a membership-only query would omit their own live call."""
        member_channels = select(ChatChannelMember.channel_id).where(
            ChatChannelMember.subject_type == SubjectType.USER,
            ChatChannelMember.subject_id == user_id,
        )
        participant_calls = select(CallParticipant.call_id).where(
            CallParticipant.user_id == user_id,
            CallParticipant.left_at.is_(None),
        )
        result = await self.session.execute(
            select(Call)
            .where(
                Call.organization_id == organization_id,
                Call.ended_at.is_(None),
                or_(
                    Call.channel_id.in_(member_channels),
                    Call.id.in_(participant_calls),
                ),
            )
            .order_by(Call.started_at)
        )
        calls = list(result.scalars().all())
        if not calls:
            return []
        parts = await self.session.execute(
            select(CallParticipant)
            .where(
                CallParticipant.call_id.in_([c.id for c in calls]),
                CallParticipant.left_at.is_(None),
            )
            .order_by(CallParticipant.joined_at)
        )
        by_call: dict[UUID, list[CallParticipant]] = {c.id: [] for c in calls}
        for participant in parts.scalars().all():
            by_call[participant.call_id].append(participant)
        return [(c, by_call[c.id]) for c in calls]

    async def kick_participant(
        self, user_id: UUID, organization_id: UUID, call_id: UUID, identity: str
    ) -> None:
        call = await self._get_call(call_id, organization_id, require_active=True)
        if call.host_user_id != user_id and not await self.access.require_elevated(
            user_id, organization_id, call.channel_id
        ):
            raise PermissionDeniedError("kick", "Only the host can remove participants")
        participant = await self.get_active_participant(call_id, identity)
        if participant is None:
            raise NotFoundError("participant", identity)

        await self.session.commit()  # release the pooled connection before the LiveKit HTTP
        client = get_livekit_admin_client()
        try:
            await client.remove_participant(call.livekit_room_name, identity)
        except LiveKitApiError as exc:
            # 404 means already gone from the SFU; state cleanup proceeds.
            if exc.status_code != 404:
                raise
        # Audit only when this call actually closed the row - a lost race (the
        # participant already left) must not write a phantom kick.
        if not await self.mark_participant_left(call, participant):
            return
        await write_audit_event(
            self.session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=Action.CALL_PARTICIPANT_KICKED,
            resource_type=AuditResourceType.CALL,
            resource_id=call.id,
            details={
                "channel_id": str(call.channel_id),
                "target_user_id": str(participant.user_id),
                "target_identity": identity,
            },
        )
        await self.session.commit()

    async def mute_participant(
        self, user_id: UUID, organization_id: UUID, call_id: UUID, identity: str
    ) -> None:
        call = await self._get_call(call_id, organization_id, require_active=True)
        if call.host_user_id != user_id and not await self.access.require_elevated(
            user_id, organization_id, call.channel_id
        ):
            raise PermissionDeniedError("mute", "Only the host can mute participants")
        await self.session.commit()  # release the pooled connection before the LiveKit HTTP
        client = get_livekit_admin_client()
        await client.mute_participant_microphone(call.livekit_room_name, identity)

        participant = await self.get_active_participant(call_id, identity)
        details = {"channel_id": str(call.channel_id), "target_identity": identity}
        if participant is not None:
            details["target_user_id"] = str(participant.user_id)
        await write_audit_event(
            self.session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=Action.CALL_PARTICIPANT_MUTED,
            resource_type=AuditResourceType.CALL,
            resource_id=call.id,
            details=details,
        )

        # Mirror the forced mute into DB state and fan it out; the muted client's
        # own ReportMediaState arriving later agrees, so it is a no-op.
        if participant is None or not participant.mic_enabled:
            await self.session.commit()
            return
        participant.mic_enabled = False
        self.session.add(participant)
        await self.session.commit()
        await self.publish_participant_state(call, participant)

    async def update_media_state(
        self,
        user_id: UUID,
        organization_id: UUID,
        call_id: UUID,
        device_id: str,
        *,
        mic_enabled: bool,
        camera_enabled: bool,
        screen_sharing: bool,
    ) -> None:
        """Client-reported media state is the roster's source of truth: LiveKit emits no mute
        webhook, so a muted mic (track stays published) cannot be inferred server-side."""
        call = await self._get_call(call_id, organization_id)
        if call.ended_at is not None:
            return
        participant = await self.get_active_participant(
            call_id, participant_identity(user_id, device_id)
        )
        if participant is None:
            return
        if (
            participant.mic_enabled == mic_enabled
            and participant.camera_enabled == camera_enabled
            and participant.screen_sharing == screen_sharing
        ):
            return
        participant.mic_enabled = mic_enabled
        participant.camera_enabled = camera_enabled
        participant.screen_sharing = screen_sharing
        self.session.add(participant)
        await self.session.commit()
        await self.publish_participant_state(call, participant)

    async def get_active_call_row(self, channel_id: UUID) -> Call | None:
        result = await self.session.execute(
            select(Call).where(Call.channel_id == channel_id, Call.ended_at.is_(None))
        )
        return result.scalar_one_or_none()

    async def list_active_participants(self, call_id: UUID) -> list[CallParticipant]:
        result = await self.session.execute(
            select(CallParticipant)
            .where(CallParticipant.call_id == call_id, CallParticipant.left_at.is_(None))
            .order_by(CallParticipant.joined_at)
        )
        return list(result.scalars().all())

    async def resolve_profiles(self, user_ids: list[UUID]) -> dict[UUID, SenderInfo]:
        return await self._resolver.resolve_many([(SenderType.USER, uid) for uid in user_ids])

    async def call_recipient_ids(
        self, call: Call, active: list[CallParticipant] | None = None
    ) -> list[UUID]:
        """Channel members plus active participants - a joiner in an unjoined PUBLIC channel has no
        member row but must still receive the call's events. Pass a pre-fetched active list to avoid
        a redundant query on the hot fanout paths."""
        if active is None:
            active = await self.list_active_participants(call.id)
        ids = set(await self.member_user_ids(call.channel_id))
        ids.update(p.user_id for p in active)
        return list(ids)

    async def publish_participant_state(self, call: Call, participant: CallParticipant) -> None:
        active = await self.list_active_participants(call.id)
        # A concurrent leave/kick/ghost-retire may have closed this row after the
        # caller read it (a debounced ReportMediaState or a host mute racing a
        # leave). Suppress the STATE event so it cannot land after CALL_PARTICIPANT_LEFT
        # and re-insert a phantom roster entry.
        if all(p.id != participant.id for p in active):
            return
        member_ids = await self.call_recipient_ids(call, active)
        profiles = await self.resolve_profiles([participant.user_id])
        info = profiles.get(participant.user_id)
        await publish_channel_event_to_members(
            member_ids,
            evt.CALL_PARTICIPANT_STATE,
            evt.build_call_participant_payload(
                call.id,
                participant_to_event_dict(
                    participant,
                    display_name=getattr(info, "display_name", ""),
                    avatar_url=getattr(info, "avatar_url", None) or None,
                ),
                len(active),
            ),
            channel_id=call.channel_id,
        )

    async def mark_participant_left(self, call: Call, participant: CallParticipant) -> bool:
        """Close one active row via compare-and-set; the leave side-effects run only on the win.

        The RPC leave and the participant_left webhook fire near-simultaneously for the same
        row; gating fanout and auto-end on the CAS keeps the audit log and host handoff single.
        """
        now = datetime.now(UTC)
        won = await self.session.execute(
            update(CallParticipant)
            .where(CallParticipant.id == participant.id, CallParticipant.left_at.is_(None))
            .values(left_at=now)
            .returning(CallParticipant.id)
            .execution_options(synchronize_session=False)
        )
        if won.scalar_one_or_none() is None:
            await self.session.commit()
            return False
        set_committed_value(participant, "left_at", now)
        await self.session.commit()
        await self._finalize_participant_left(call, participant)
        return True

    async def retire_ghost_participant(
        self, call: Call, participant: CallParticipant, cutoff: datetime
    ) -> bool:
        """Retire an absent row only while its absence still holds, so a grace rejoin wins."""
        now = datetime.now(UTC)
        won = await self.session.execute(
            update(CallParticipant)
            .where(
                CallParticipant.id == participant.id,
                CallParticipant.left_at.is_(None),
                CallParticipant.missing_since.is_not(None),
                CallParticipant.missing_since < cutoff,
            )
            .values(left_at=now)
            .returning(CallParticipant.id)
            .execution_options(synchronize_session=False)
        )
        if won.scalar_one_or_none() is None:
            await self.session.commit()
            return False
        set_committed_value(participant, "left_at", now)
        await self.session.commit()
        await self._finalize_participant_left(call, participant)
        return True

    async def _finalize_participant_left(self, call: Call, participant: CallParticipant) -> None:
        remaining = await self.list_active_participants(call.id)
        member_ids = await self.call_recipient_ids(call, remaining)
        info = (await self.resolve_profiles([participant.user_id])).get(participant.user_id)
        await publish_channel_event_to_members(
            member_ids,
            evt.CALL_PARTICIPANT_LEFT,
            evt.build_call_participant_payload(
                call.id,
                participant_to_event_dict(
                    participant,
                    display_name=getattr(info, "display_name", ""),
                    avatar_url=getattr(info, "avatar_url", None) or None,
                ),
                len(remaining),
            ),
            channel_id=call.channel_id,
        )
        if not remaining:
            await self.end_call_internal(call, CallEndReason.ALL_LEFT)
            return
        await self.reassign_host_if_absent(call)

    async def end_call_internal(
        self, call: Call, reason: CallEndReason, actor_user_id: UUID | None = None
    ) -> bool:
        """End the call via compare-and-set; audit, fanout, and room delete run only on the win.

        actor_user_id is None for system ends (all-left, reconciler, webhook). The CAS is the
        guard: an in-memory ended_at check is stale across sessions (expire_on_commit=False).
        """
        now = datetime.now(UTC)
        won = await self.session.execute(
            update(Call)
            .where(Call.id == call.id, Call.ended_at.is_(None))
            .values(ended_at=now, end_reason=reason)
            .returning(Call.id)
            .execution_options(synchronize_session=False)
        )
        if won.scalar_one_or_none() is None:
            await self.session.commit()
            return False
        set_committed_value(call, "ended_at", now)
        set_committed_value(call, "end_reason", reason)
        closed = await self.session.execute(
            update(CallParticipant)
            .where(CallParticipant.call_id == call.id, CallParticipant.left_at.is_(None))
            .values(left_at=now)
            .returning(CallParticipant.user_id)
            .execution_options(synchronize_session=False)
        )
        closed_user_ids = [row[0] for row in closed.all()]
        participant_count = len(closed_user_ids)
        await write_audit_event(
            self.session,
            organization_id=call.organization_id,
            actor_user_id=actor_user_id,
            action=Action.CALL_ENDED,
            resource_type=AuditResourceType.CALL,
            resource_id=call.id,
            details={
                "channel_id": str(call.channel_id),
                "reason": reason.value,
                "duration_seconds": int((now - call.started_at).total_seconds()),
                "participant_count": participant_count,
            },
        )
        await self.session.commit()

        # Include the just-closed participants: a PUBLIC-channel joiner has no
        # member row but must still receive CALL_ENDED to clear its indicator.
        member_ids = list(set(await self.member_user_ids(call.channel_id)) | set(closed_user_ids))
        await publish_channel_event_to_members(
            member_ids,
            evt.CALL_ENDED,
            evt.build_call_lifecycle_payload(call_to_event_dict(call, [])),
            channel_id=call.channel_id,
        )

        await self._post_call_ended_summary(call, reason, actor_user_id, now)

        client = get_livekit_admin_client()
        try:
            await client.delete_room(call.livekit_room_name)
        except LiveKitApiError as exc:
            if exc.status_code != 404:
                logger.warning(f"LiveKit room delete failed for call={call.id}: {exc}")
        return True

    async def _post_call_ended_summary(
        self, call: Call, reason: CallEndReason, actor_user_id: UUID | None, ended_at: datetime
    ) -> None:
        try:
            # Everyone who ever joined, in first-join order - not just those
            # active at the end, so early leavers still appear in the summary.
            rows = await self.session.execute(
                select(CallParticipant.user_id)
                .where(CallParticipant.call_id == call.id)
                .group_by(CallParticipant.user_id)
                .order_by(func.min(CallParticipant.joined_at))
            )
            participant_ids = [row[0] for row in rows.all()]
            lookup_ids = participant_ids + ([actor_user_id] if actor_user_id else [])
            profiles = await self.resolve_profiles(lookup_ids)
        except Exception:
            logger.opt(exception=True).warning(f"Failed to compose call summary for call={call.id}")
            return

        def mention(uid: UUID) -> str:
            return _user_mention(uid, getattr(profiles.get(uid), "display_name", ""))

        shown = [mention(uid) for uid in participant_ids[:CALL_SUMMARY_MAX_MENTIONS]]
        overflow = len(participant_ids) - len(shown)
        roster = ", ".join(shown) + (f" and {overflow} more" if overflow > 0 else "")

        if reason == CallEndReason.HOST_ENDED and actor_user_id is not None:
            summary = f"{mention(actor_user_id)} ended the call for everyone"
        else:
            summary = "Call ended"
        duration = _format_call_duration(int((ended_at - call.started_at).total_seconds()))
        content = f"{summary} - {duration}" + (f" - with {roster}" if roster else "")
        await self._post_call_system_message(
            call, content, actor_user_id or call.host_user_id, ChatMessageMetadataKind.CALL_ENDED
        )

    async def _post_call_system_message(
        self, call: Call, content: str, sender_user_id: UUID, kind: ChatMessageMetadataKind
    ) -> None:
        """Lifecycle breadcrumbs ride the normal message pipeline as SYSTEM posts;
        a failure here must never break the call lifecycle."""
        try:
            await ChatMessageOperations(self.session).send_message(
                user_id=sender_user_id,
                organization_id=call.organization_id,
                channel_id=call.channel_id,
                content=content,
                message_metadata={"kind": kind.value},
                sender_type=SenderType.SYSTEM,
            )
        except Exception:
            logger.opt(exception=True).warning(
                f"Failed to post call lifecycle message for call={call.id}"
            )

    async def reassign_host_if_absent(self, call: Call) -> None:
        """Hand host to the earliest-joined active participant when the host has no active row."""
        active_user_ids = select(CallParticipant.user_id).where(
            CallParticipant.call_id == call.id, CallParticipant.left_at.is_(None)
        )
        next_host = (
            select(CallParticipant.user_id)
            .where(CallParticipant.call_id == call.id, CallParticipant.left_at.is_(None))
            .order_by(CallParticipant.joined_at, CallParticipant.id)
            .limit(1)
            .scalar_subquery()
        )
        res = await self.session.execute(
            update(Call)
            .where(
                Call.id == call.id,
                Call.ended_at.is_(None),
                Call.host_user_id.not_in(active_user_ids),
                next_host.is_not(None),
            )
            .values(host_user_id=next_host)
            .returning(Call.host_user_id)
            .execution_options(synchronize_session=False)
        )
        new_host = res.scalar_one_or_none()
        if new_host is None:
            await self.session.commit()
            return
        set_committed_value(call, "host_user_id", new_host)
        await self.session.commit()
        member_ids = await self.call_recipient_ids(call)
        await publish_channel_event_to_members(
            member_ids,
            evt.CALL_HOST_CHANGED,
            evt.build_call_host_changed_payload(call.id, new_host),
            channel_id=call.channel_id,
        )

    async def record_absence(self, participant: CallParticipant, when: datetime) -> None:
        await self._set_missing_since(participant, when)

    async def clear_absence(self, participant: CallParticipant) -> None:
        await self._set_missing_since(participant, None)

    async def _set_missing_since(self, participant: CallParticipant, value: datetime | None) -> None:
        await self.session.execute(
            update(CallParticipant)
            .where(CallParticipant.id == participant.id)
            .values(missing_since=value)
            .execution_options(synchronize_session=False)
        )
        await self.session.commit()
        set_committed_value(participant, "missing_since", value)

    async def _reopen_participant_row(
        self, call: Call, row: CallParticipant, token: MintedToken, device_label: str | None
    ) -> bool:
        """Reclaim a returning device's active row via CAS so a concurrent ghost retire wins cleanly.

        A grace rejoin establishes a fresh SFU session, so session_jti advances to the new token
        and missing_since clears - the row is present again for the two-pass ghost gate.
        """
        won = await self.session.execute(
            update(CallParticipant)
            .where(CallParticipant.id == row.id, CallParticipant.left_at.is_(None))
            .values(
                token_jti=token.jti,
                session_jti=token.jti,
                missing_since=None,
                device_label=device_label or row.device_label,
            )
            .returning(CallParticipant.id)
            .execution_options(synchronize_session=False)
        )
        if won.scalar_one_or_none() is None:
            return False
        set_committed_value(row, "token_jti", token.jti)
        set_committed_value(row, "session_jti", token.jti)
        set_committed_value(row, "missing_since", None)
        if device_label:
            set_committed_value(row, "device_label", device_label)
        await self.session.commit()
        return True

    async def _join(
        self,
        call: Call,
        channel: ChatChannel,
        user_id: UUID,
        device_id: str,
        device_label: str | None,
        *,
        is_start: bool = False,
    ) -> tuple[MintedToken, list[CallParticipant]]:
        identity = participant_identity(user_id, device_id)
        info = await self._resolver.resolve_one(SenderType.USER, user_id)

        existing_row = await self.get_active_participant(call.id, identity)
        user_devices = await self._count_active_devices(call.id, user_id)
        if existing_row is None and user_devices >= MAX_DEVICES_PER_USER:
            raise ValidationError("device", "Already in this call on too many devices")

        active = await self.list_active_participants(call.id)
        max_participants = await self._max_participants(call.organization_id)
        if existing_row is None and len(active) >= max_participants:
            raise ValidationError("call", "Call is full")

        token = self._minter.mint_user_token(
            organization_id=call.organization_id,
            call_id=call.id,
            user_id=user_id,
            device_id=device_id,
            display_name=info.display_name,
            device_label=device_label,
        )

        if existing_row is not None:
            if await self._reopen_participant_row(call, existing_row, token, device_label):
                return token, await self.list_active_participants(call.id)
            # A concurrent ghost sweep retired the row; fall through to a fresh insert.

        participant = CallParticipant(
            call_id=call.id,
            organization_id=call.organization_id,
            user_id=user_id,
            device_id=device_id,
            identity=identity,
            device_label=device_label,
            token_jti=token.jti,
            session_jti=token.jti,
            # Second device joins muted; the client honors this on connect.
            mic_enabled=user_devices == 0,
        )
        self.session.add(participant)
        try:
            await self.session.commit()
        except IntegrityError:
            # Two tabs sharing a device_id, or a double-clicked join, raced the
            # active-identity unique index; reclaim the row the winner inserted.
            await self.session.rollback()
            await self.session.refresh(call)
            existing_row = await self.get_active_participant(call.id, identity)
            if existing_row is None or not await self._reopen_participant_row(
                call, existing_row, token, device_label
            ):
                raise
            return token, await self.list_active_participants(call.id)

        participants = await self.list_active_participants(call.id)
        member_ids = await self.call_recipient_ids(call, participants)
        if is_start:
            profiles = await self.resolve_profiles([p.user_id for p in participants])
            await publish_channel_event_to_members(
                member_ids,
                evt.CALL_STARTED,
                evt.build_call_lifecycle_payload(call_to_event_dict(call, participants, profiles)),
                channel_id=call.channel_id,
            )
        else:
            await publish_channel_event_to_members(
                member_ids,
                evt.CALL_PARTICIPANT_JOINED,
                evt.build_call_participant_payload(
                    call.id,
                    participant_to_event_dict(
                        participant,
                        display_name=info.display_name,
                        avatar_url=info.avatar_key,
                    ),
                    len(participants),
                ),
                channel_id=call.channel_id,
            )
        return token, participants

    async def _ring_callees(self, call: Call, channel: ChatChannel, caller_id: UUID) -> None:
        member_ids = await self.member_user_ids(channel.id)
        callees = [uid for uid in member_ids if uid != caller_id]
        if not callees:
            return
        if call.call_type == CallType.CHANNEL and len(member_ids) >= SILENT_JOIN_MEMBER_THRESHOLD:
            return
        info = await self._resolver.resolve_one(SenderType.USER, caller_id)
        payload = evt.build_call_ring_payload(
            call_id=call.id,
            channel_name=channel.effective_name,
            call_type=call.call_type.value,
            caller_user_id=caller_id,
            caller_name=info.display_name,
            caller_avatar_url=info.avatar_url or None,
            expires_at=datetime.now(UTC) + timedelta(seconds=RING_TIMEOUT_SECONDS),
        )
        await publish_channel_event_to_members(
            callees, evt.CALL_RING, payload, channel_id=channel.id
        )

    async def _get_call(
        self, call_id: UUID, organization_id: UUID, *, require_active: bool = False
    ) -> Call:
        result = await self.session.execute(
            select(Call).where(Call.id == call_id, Call.organization_id == organization_id)
        )
        call = result.scalar_one_or_none()
        if call is None:
            raise NotFoundError("call", call_id)
        if require_active and call.ended_at is not None:
            raise ValidationError("call", "Call has ended")
        return call

    async def get_active_participant(self, call_id: UUID, identity: str) -> CallParticipant | None:
        result = await self.session.execute(
            select(CallParticipant).where(
                CallParticipant.call_id == call_id,
                CallParticipant.identity == identity,
                CallParticipant.left_at.is_(None),
            )
        )
        return result.scalar_one_or_none()

    async def _count_active_devices(self, call_id: UUID, user_id: UUID) -> int:
        result = await self.session.execute(
            select(CallParticipant.id).where(
                CallParticipant.call_id == call_id,
                CallParticipant.user_id == user_id,
                CallParticipant.left_at.is_(None),
            )
        )
        return len(result.scalars().all())

    async def _require_not_in_another_call(
        self, user_id: UUID, organization_id: UUID, *, exclude_channel: UUID
    ) -> None:
        result = await self.session.execute(
            select(Call.channel_id)
            .join(CallParticipant, CallParticipant.call_id == Call.id)
            .where(
                CallParticipant.user_id == user_id,
                CallParticipant.left_at.is_(None),
                Call.ended_at.is_(None),
                Call.organization_id == organization_id,
                Call.channel_id != exclude_channel,
            )
            .limit(1)
        )
        if result.scalar_one_or_none() is not None:
            raise ValidationError("call", "Already in a call in another channel")

    async def _require_calls_enabled(self, organization_id: UUID) -> None:
        policy = await self.get_org_policy(organization_id)
        if policy is not None and not policy.calls_enabled:
            raise PermissionDeniedError("calls", "Calls are disabled for this organization")

    async def _max_participants(self, organization_id: UUID) -> int:
        policy = await self.get_org_policy(organization_id)
        if policy is None:
            return DEFAULT_MAX_PARTICIPANTS
        return policy.max_participants

    async def get_org_policy(self, organization_id: UUID) -> ResolvedCallPolicy | None:
        return await load_call_policy(self.session, organization_id)

    async def resolve_screen_share_ceiling(
        self, organization_id: UUID, call_type: CallType
    ) -> ScreenShareQuality:
        """Effective screen-share ceiling: the org's per-type cap, else the built-in default.

        A 1:1 DIRECT call has a single viewer, so its egress is trivial and it
        defaults to MAX. Channel / group calls fall back to the env default,
        which protects the single SFU node from viewer-count egress.
        """
        policy = await self.get_org_policy(organization_id)
        if policy is not None:
            cap = ScreenShareQuality(_policy_cap_for_type(policy, call_type))
            if cap != ScreenShareQuality.UNSPECIFIED:
                return cap
        if call_type == CallType.DIRECT:
            return ScreenShareQuality.MAX
        return default_screen_share_quality()

    async def _require_org_admin(self, user_id: UUID, organization_id: UUID) -> None:
        if not await PermissionChecker(self.session).is_org_admin(user_id, organization_id):
            raise PermissionDeniedError(
                "call_policy", "Only organization admins can manage call policy"
            )

    async def get_org_policy_view(self, user_id: UUID, organization_id: UUID) -> ResolvedCallPolicy:
        """Org call policy for the admin surface, materialized to defaults when unset."""
        await self._require_org_admin(user_id, organization_id)
        policy = await self.get_org_policy(organization_id)
        return policy if policy is not None else ResolvedCallPolicy(organization_id=organization_id)

    async def update_org_policy(
        self,
        user_id: UUID,
        organization_id: UUID,
        *,
        calls_enabled: bool,
        max_participants: int,
        max_duration_minutes: int,
        max_screen_share_quality_direct: ScreenShareQuality,
        max_screen_share_quality_group: ScreenShareQuality,
        max_screen_share_quality_channel: ScreenShareQuality,
    ) -> ResolvedCallPolicy:
        await self._require_org_admin(user_id, organization_id)
        if not 1 <= max_participants <= 1000:
            raise ValidationError("max_participants", "Must be between 1 and 1000")
        if not 1 <= max_duration_minutes <= 1440:
            raise ValidationError("max_duration_minutes", "Must be between 1 and 1440")
        policy = ResolvedCallPolicy(
            organization_id=organization_id,
            calls_enabled=calls_enabled,
            max_participants=max_participants,
            max_duration_minutes=max_duration_minutes,
            max_screen_share_quality_direct=int(max_screen_share_quality_direct),
            max_screen_share_quality_group=int(max_screen_share_quality_group),
            max_screen_share_quality_channel=int(max_screen_share_quality_channel),
        )
        await save_call_policy(
            self.session,
            policy=policy,
            updated_by_user_id=user_id,
        )
        await self.session.commit()
        return policy

    async def member_user_ids(self, channel_id: UUID) -> list[UUID]:
        members = await fetch_channel_members(self.session, channel_id)
        ids: list[UUID] = []
        for member in members:
            if member.get("subject_type") != SubjectType.USER.value:
                continue
            uid = member.get("user_id")
            if not uid:
                continue
            try:
                ids.append(UUID(uid))
            except ValueError:
                continue
        return ids


async def end_active_call_for_channel(
    session: AsyncSession, channel_id: UUID, reason: CallEndReason
) -> bool:
    """Chat-side hook (archive / delete): end the channel's active call, if any."""
    result = await session.execute(
        select(Call).where(Call.channel_id == channel_id, Call.ended_at.is_(None))
    )
    call = result.scalar_one_or_none()
    if call is None:
        return False
    try:
        ops = CallOperations(session)
    except LiveKitConfigError:
        logger.warning(
            f"Active call {call.id} in channel {channel_id} but LiveKit is not configured"
        )
        return False
    await ops.end_call_internal(call, reason)
    return True


async def kick_user_from_active_call(session: AsyncSession, channel_id: UUID, user_id: UUID) -> None:
    """Chat-side hook (member removed / left): drop every device of the user
    from the channel's active call, SFU first, then DB state."""
    result = await session.execute(
        select(Call).where(Call.channel_id == channel_id, Call.ended_at.is_(None))
    )
    call = result.scalar_one_or_none()
    if call is None:
        return
    try:
        ops = CallOperations(session)
    except LiveKitConfigError:
        return

    rows = await session.execute(
        select(CallParticipant).where(
            CallParticipant.call_id == call.id,
            CallParticipant.user_id == user_id,
            CallParticipant.left_at.is_(None),
        )
    )
    client = get_livekit_admin_client()
    for participant in rows.scalars().all():
        try:
            await client.remove_participant(call.livekit_room_name, participant.identity)
        except LiveKitApiError as exc:
            if exc.status_code != 404:
                logger.warning(
                    f"call kick remove_participant failed for {participant.identity}: {exc}"
                )
        await ops.mark_participant_left(call, participant)
