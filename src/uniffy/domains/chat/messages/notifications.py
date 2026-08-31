"""Focused chat message notifications behavior."""

from uuid import UUID

from loguru import logger
from sqlalchemy import select

from uniffy.core.content.references import (
    BroadcastMention,
)
from uniffy.core.content.team_mentions import TeamExpansion
from uniffy.core.events.bus import emit_notification
from uniffy.core.events.types import NotificationEvent
from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.models.chat.message import ChatMessage
from uniffy.core.models.chat.thread_follow import ChatThreadFollow
from uniffy.core.models.shared import NotificationType
from uniffy.domains.chat.streaming.events import (
    MENTION_RECEIVED,
    THREAD_ACTIVITY,
    UNREAD_COUNT_CHANGED,
)
from uniffy.domains.chat.streaming.publisher import (
    publish_user_chat_event,
    publish_user_chat_events,
)

logger = logger.bind(component="chat.messages.notifications")


class MessageNotifications:
    async def _publish_unread_notifications(
        self,
        channel: ChatChannel,
        sender_id: UUID,
        member_ids: list[UUID],
        mentioned_user_ids: set[UUID] | None = None,
    ) -> None:
        """Publish the unread/mention count change to every member but the sender.

        Deliberately preference-blind: the read-time aggregate counts unread and
        mention rows for muted, NONE, and MENTIONS-only members too, so the live
        event must match or the badge diverges until the next reload. Muting
        gates notifications, never unread state.
        """
        try:
            mentioned = mentioned_user_ids or set()

            events: list[tuple[UUID, str, dict]] = []
            for uid in member_ids:
                if uid == sender_id:
                    continue
                events.append((
                    uid,
                    UNREAD_COUNT_CHANGED,
                    {
                        "channel_id": str(channel.id),
                        "unread_count": 1,
                        "mention_count": 1 if uid in mentioned else 0,
                    },
                ))
            await publish_user_chat_events(events)
        except Exception:
            logger.warning(f"Failed to publish unread notifications for channel {channel.id}")

    async def _emit_send_notifications(
        self,
        message: ChatMessage,
        channel: ChatChannel,
        user_id: UUID,
        root_id: UUID | None,
        sender_name: str,
        member_ids: list[UUID],
        mentioned_user_ids: set[UUID] | None = None,
        team_mentions: list[tuple[TeamExpansion, list[UUID]]] | None = None,
        *,
        broadcast_kind: BroadcastMention | None = None,
        broadcast_target_ids: set[UUID] | None = None,
    ) -> None:
        """Emit notifications + stream events for mentions, broadcasts, DMs, and thread replies."""
        try:
            channel_urn = f"urn:uniffy:content:CHAT:{channel.id}"
            preview = message.content[:200]
            notif_metadata = {
                "channel_id": str(channel.id),
                "channel_name": channel.name,
                "channel_type": channel.channel_type.value,
                "message_id": str(message.id),
            }
            if root_id:
                notif_metadata["root_message_id"] = str(root_id)

            notified_ids: set[UUID] = set()

            mentioned_ids = mentioned_user_ids or set()
            mention_targets = [mid for mid in mentioned_ids if mid != user_id]
            if mention_targets:
                await emit_notification(
                    NotificationEvent(
                        notification_type=NotificationType.CHAT_MENTION,
                        organization_id=channel.organization_id,
                        actor_id=user_id,
                        title=f"Mentioned you in #{channel.name}",
                        body=preview,
                        source_urn=channel_urn,
                        target_user_ids=mention_targets,
                        metadata=notif_metadata,
                    )
                )
                notified_ids.update(mention_targets)

            # One event per team so each recipient sees the team that pinged
            # them; a directly mentioned user keeps the "Mentioned you" copy.
            team_targets: list[UUID] = []
            for expansion, recipients in team_mentions or ():
                targets = [uid for uid in recipients if uid != user_id and uid not in notified_ids]
                if not targets:
                    continue
                await emit_notification(
                    NotificationEvent(
                        notification_type=NotificationType.CHAT_MENTION,
                        organization_id=channel.organization_id,
                        actor_id=user_id,
                        title=f"Mentioned {expansion.name} in #{channel.name}",
                        body=preview,
                        source_urn=channel_urn,
                        target_user_ids=targets,
                        metadata={
                            **notif_metadata,
                            "team_id": str(expansion.team_id),
                            "team_name": expansion.name,
                        },
                    )
                )
                notified_ids.update(targets)
                team_targets.extend(targets)

            # Directly mentioned users keep the personal "Mentioned you" copy;
            # the broadcast event covers everyone the roster fan-out reaches.
            broadcast_targets: list[UUID] = []
            if broadcast_kind is not None and broadcast_target_ids:
                broadcast_targets = [
                    uid for uid in broadcast_target_ids if uid != user_id and uid not in notified_ids
                ]
            if broadcast_targets:
                where = f"#{channel.name}" if channel.name else "the conversation"
                title = (
                    f"Mentioned everyone active in {where}"
                    if broadcast_kind is BroadcastMention.HERE
                    else f"Mentioned everyone in {where}"
                )
                await emit_notification(
                    NotificationEvent(
                        notification_type=NotificationType.CHAT_MENTION,
                        organization_id=channel.organization_id,
                        actor_id=user_id,
                        title=title,
                        body=preview,
                        source_urn=channel_urn,
                        target_user_ids=broadcast_targets,
                        metadata={**notif_metadata, "broadcast": broadcast_kind.value},
                    )
                )
                notified_ids.update(broadcast_targets)

            if channel.channel_type in (ChannelType.DIRECT, ChannelType.GROUP_DM):
                dm_recipients = [
                    mid for mid in member_ids if mid != user_id and mid not in notified_ids
                ]
                if dm_recipients:
                    await emit_notification(
                        NotificationEvent(
                            notification_type=NotificationType.CHAT_DM,
                            organization_id=channel.organization_id,
                            actor_id=user_id,
                            title="Sent you a message",
                            body=preview,
                            source_urn=channel_urn,
                            target_user_ids=dm_recipients,
                            metadata=notif_metadata,
                        )
                    )
                    notified_ids.update(dm_recipients)

            if root_id:
                result = await self.session.execute(
                    select(ChatThreadFollow.user_id).where(
                        ChatThreadFollow.root_message_id == root_id,
                        ChatThreadFollow.user_id != user_id,
                    )
                )
                all_followers = [r[0] for r in result.all()]

                notif_followers = [uid for uid in all_followers if uid not in notified_ids]
                if notif_followers:
                    await emit_notification(
                        NotificationEvent(
                            notification_type=NotificationType.CHAT_THREAD_REPLY,
                            organization_id=channel.organization_id,
                            actor_id=user_id,
                            title=f"Replied in a thread in #{channel.name}",
                            body=preview,
                            source_urn=channel_urn,
                            target_user_ids=notif_followers,
                            metadata=notif_metadata,
                        )
                    )

                thread_payload = {
                    "root_message_id": str(root_id),
                    "channel_id": str(channel.id),
                    "latest_participant_id": str(user_id),
                }
                for follower_id in all_followers:
                    await publish_user_chat_event(
                        follower_id,
                        THREAD_ACTIVITY,
                        thread_payload,
                    )

            # A broadcast widens this set to the whole roster, so the fan-out
            # must stay one pipelined round trip, never a PUBLISH per member.
            mention_stream_targets = mention_targets + team_targets + broadcast_targets
            if mention_stream_targets:
                mention_payload = {
                    "message_id": str(message.id),
                    "channel_id": str(channel.id),
                    "sender_id": str(user_id),
                    "content_preview": message.content[:150],
                }
                await publish_user_chat_events([
                    (mid, MENTION_RECEIVED, mention_payload) for mid in mention_stream_targets
                ])
        except Exception:
            logger.warning(f"Notification emit failed for message {message.id}")
