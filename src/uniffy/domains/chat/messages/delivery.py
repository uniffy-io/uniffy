"""Focused chat message delivery behavior."""

from datetime import datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import select

from uniffy.core.content.references import (
    BroadcastMention,
    extract_broadcast_mentions_from_content,
    extract_mentioned_team_ids_from_content,
    extract_mentioned_user_ids_from_content,
)
from uniffy.core.content.team_mentions import TeamExpansion, expand_team_mentions
from uniffy.core.jobs import enqueue_job
from uniffy.core.models.chat.channel import ChatChannel
from uniffy.core.models.chat.channel_member import (
    ChatChannelMember,
    ChatNotificationLevel,
)
from uniffy.core.models.chat.message import ChatMessage, SenderType
from uniffy.core.models.chat.thread import ChatThreadStats
from uniffy.core.types import SubjectType
from uniffy.domains.agents.bridge.jobs.contracts import RESPOND_TO_CHAT_MESSAGE
from uniffy.domains.agents.bridge.mentions import detect_agent_mentions
from uniffy.domains.chat.cache import fetch_channel_members
from uniffy.domains.chat.drafts.operations import ChatDraftOperations
from uniffy.domains.chat.features import is_chat_agents_enabled
from uniffy.domains.chat.messages.converters import (
    get_forward_metadata,
    get_thread_reply_metadata,
    public_message_metadata,
)
from uniffy.domains.chat.streaming.events import (
    MESSAGE_CREATED,
    THREAD_UPDATED,
    build_message_payload,
    build_thread_updated_payload,
)
from uniffy.domains.chat.streaming.publisher import (
    publish_channel_event_to_members,
    publish_user_chat_events,
)

logger = logger.bind(component="chat.messages.delivery")


class MessageDelivery:
    async def _maybe_trigger_agents(self, message: ChatMessage, channel: ChatChannel) -> None:
        """Detect agent mentions and enqueue respond_to_chat_message ARQ jobs; non-fatal."""
        try:
            if not await is_chat_agents_enabled(self.session, channel.organization_id):
                return

            matches = await detect_agent_mentions(self.session, message, channel)
            if not matches:
                return

            logger.info(
                f"agents-in-chat: {len(matches)} match(es) for "
                f"channel={channel.id} msg={message.id} "
                f"agents={[(m.agent_id, m.rule) for m in matches]}"
            )

            try:
                for m in matches:
                    await enqueue_job(
                        RESPOND_TO_CHAT_MESSAGE,
                        str(channel.id),
                        str(message.id),
                        str(m.agent_id),
                        m.rule,
                    )
            except RuntimeError:
                logger.warning(
                    "agents-in-chat: queue unavailable, dropping "
                    f"{len(matches)} match(es) for message {message.id}"
                )
        except Exception as exc:
            logger.exception(f"agent mention detection failed for message {message.id}: {exc}")

    async def background_post_send(
        self,
        message: ChatMessage,
        channel: ChatChannel,
        user_id: UUID,
        root_id: UUID | None,
        sender_name: str,
        member_ids: list[UUID],
        index_message: ChatMessage | None = None,
    ) -> None:
        """Index the channel-visible twin so a broadcast has one search document."""
        # Membership and join messages embed a mention urn for the member the
        # event is about. That urn is the copy, not a ping: nobody gets
        # "Mentioned you" or a mention badge for their own membership event.
        visible_mentioned: set[UUID] = set()
        team_mentions: list[tuple[TeamExpansion, list[UUID]]] = []
        if message.sender_type != SenderType.SYSTEM:
            mentioned_user_ids = extract_mentioned_user_ids_from_content(message.content)
            team_ids = extract_mentioned_team_ids_from_content(message.content)
            team_expansions = (
                await expand_team_mentions(self.session, channel.organization_id, team_ids)
                if team_ids
                else []
            )
            visible_mentioned, team_mentions = await self._visible_mention_targets(
                channel,
                mentioned_user_ids,
                team_expansions,
            )
        team_recipient_ids: set[UUID] = set()
        for _, recipients in team_mentions:
            team_recipient_ids.update(recipients)

        # Broadcast recipients are the channel roster, so the viewer filter is
        # moot; @here narrows the notification set to online members while the
        # badge set stays the whole roster (read-time counting matches all
        # members against the broadcast urn).
        broadcast_kind: BroadcastMention | None = None
        broadcast_badge_ids: set[UUID] = set()
        broadcast_notify_ids: set[UUID] = set()
        if message.sender_type != SenderType.SYSTEM:
            broadcast_kinds = extract_broadcast_mentions_from_content(message.content)
            if broadcast_kinds:
                broadcast_kind = self._effective_broadcast_kind(broadcast_kinds)
                broadcast_badge_ids = {uid for uid in member_ids if uid != user_id}
                if broadcast_kind is BroadcastMention.HERE:
                    broadcast_notify_ids = await self._online_member_ids(
                        channel, broadcast_badge_ids
                    )
                else:
                    broadcast_notify_ids = set(broadcast_badge_ids)

        await self._index_message(
            index_message or message, channel, member_ids, sender_name=sender_name
        )

        await self._update_resources(channel.id, message.content, user_id)

        muted_user_ids: set[UUID] = set()
        none_notification_ids: set[UUID] = set()
        try:
            pref_result = await self.session.execute(
                select(
                    ChatChannelMember.subject_id,
                    ChatChannelMember.is_muted,
                    ChatChannelMember.notification_level,
                ).where(
                    ChatChannelMember.channel_id == channel.id,
                    ChatChannelMember.subject_type == SubjectType.USER,
                )
            )
            for row in pref_result.all():
                if row[0] is None:
                    continue
                if row[1]:
                    muted_user_ids.add(row[0])
                if row[2] == ChatNotificationLevel.NONE:
                    none_notification_ids.add(row[0])
        except Exception:
            logger.warning(f"Failed to fetch notification preferences for channel {channel.id}")

        await self._publish_unread_notifications(
            channel,
            user_id,
            member_ids,
            visible_mentioned | team_recipient_ids | broadcast_badge_ids,
        )

        # A broadcast is a mention for badge purposes, but muted and
        # notification-level NONE members opted out of being pinged by it.
        broadcast_notify_ids -= muted_user_ids | none_notification_ids

        await self._emit_send_notifications(
            message,
            channel,
            user_id,
            root_id,
            sender_name,
            member_ids,
            visible_mentioned,
            team_mentions,
            broadcast_kind=broadcast_kind,
            broadcast_target_ids=broadcast_notify_ids,
        )

        if message.sender_type == SenderType.USER:
            await ChatDraftOperations(self.session).clear_for_send(
                user_id, channel.organization_id, channel.id, root_id
            )

    async def _visible_mention_targets(
        self,
        channel: ChatChannel,
        mentioned_user_ids: set[UUID],
        team_expansions: list[TeamExpansion],
    ) -> tuple[set[UUID], list[tuple[TeamExpansion, list[UUID]]]]:
        candidates = set(mentioned_user_ids)
        for expansion in team_expansions:
            candidates.update(expansion.member_ids)
        allowed = set(
            await self.access.filter_viewers(
                channel.organization_id,
                channel,
                candidates,
            )
        )
        visible_teams = [
            (expansion, [user_id for user_id in expansion.member_ids if user_id in allowed])
            for expansion in team_expansions
        ]
        return mentioned_user_ids & allowed, [
            (expansion, user_ids) for expansion, user_ids in visible_teams if user_ids
        ]

    async def _get_channel_member_ids(self, channel_id: UUID) -> list[UUID]:
        # USER-only; AGENT rows have NULL user_id which would crash _event_to_json on deserialize.
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

    async def _publish_send_event(
        self,
        message: ChatMessage,
        channel: ChatChannel,
        user_id: UUID,
        root_id: UUID | None,
        now: datetime,
        sender_name: str,
        sender_avatar: str,
        member_ids: list[UUID],
        reply_context: dict[str, str] | None = None,
    ) -> None:
        try:
            forward_metadata = get_forward_metadata(message.message_metadata)
            thread_reply_metadata = get_thread_reply_metadata(message.message_metadata)
            base_payload = build_message_payload(
                message_id=message.id,
                channel_id=channel.id,
                sender_id=user_id,
                sender_type=message.sender_type.value,
                content=message.content,
                root_id=root_id,
                created_at=now,
                sender_name=sender_name,
                sender_avatar_url=sender_avatar,
                metadata=public_message_metadata(message.message_metadata),
                reply_to_id=message.reply_to_id,
                reply_context=reply_context,
                is_forwarded=forward_metadata is not None,
                thread_reply_context=thread_reply_metadata,
            )
            if forward_metadata is None:
                await publish_channel_event_to_members(
                    member_ids,
                    MESSAGE_CREATED,
                    base_payload,
                )
            else:
                source_viewers = set(
                    await self._resolve_forward_viewers(
                        channel.organization_id,
                        forward_metadata,
                        member_ids,
                    )
                )
                events = []
                for member_id in member_ids:
                    payload = dict(base_payload)
                    if member_id in source_viewers:
                        payload["forward_context"] = forward_metadata
                    events.append((member_id, MESSAGE_CREATED, payload))
                await publish_user_chat_events(events)

            if root_id:
                stats_result = await self.session.execute(
                    select(ChatThreadStats).where(ChatThreadStats.root_message_id == root_id)
                )
                ts = stats_result.scalar_one_or_none()
                if ts:
                    await publish_channel_event_to_members(
                        member_ids,
                        THREAD_UPDATED,
                        build_thread_updated_payload(
                            root_message_id=root_id,
                            reply_count=ts.reply_count,
                            last_reply_at=ts.last_reply_at or now,
                            latest_participant_id=user_id,
                        ),
                        channel_id=channel.id,
                    )
        except Exception:
            logger.warning(f"Valkey publish failed for message {message.id}")

    async def _resolve_forward_viewers(
        self,
        organization_id: UUID,
        forward_metadata: dict,
        member_ids: list[UUID],
    ) -> list[UUID]:
        try:
            source_message_id = UUID(str(forward_metadata["message_id"]))
            source_channel_id = UUID(str(forward_metadata["channel_id"]))
        except KeyError, TypeError, ValueError:
            return []

        source_channel = (
            await self.session.execute(
                select(ChatChannel)
                .join(ChatMessage, ChatMessage.channel_id == ChatChannel.id)
                .where(
                    ChatMessage.id == source_message_id,
                    ChatMessage.channel_id == source_channel_id,
                    ChatMessage.is_deleted.is_(False),
                    ChatChannel.id == source_channel_id,
                    ChatChannel.organization_id == organization_id,
                    ChatChannel.is_deleted.is_(False),
                )
            )
        ).scalar_one_or_none()
        if source_channel is None:
            return []
        return await self.access.filter_forward_source_viewers(
            organization_id,
            source_channel,
            member_ids,
        )
