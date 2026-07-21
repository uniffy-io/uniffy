"""Chat message operations; permission checks delegate to ChatAccessChecker."""

from datetime import UTC, datetime, timedelta
from uuid import UUID

from loguru import logger
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.content.references import (
    extract_all_outgoing_references,
    extract_mentioned_agent_ids_from_content,
)
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.chat.channel import ChannelType, ChatChannel, ChatChannelStats
from uniffy.core.models.chat.message import ChatMessage, SenderType
from uniffy.core.models.chat.thread import ChatThread, ChatThreadParticipant, ChatThreadStats
from uniffy.core.models.chat.thread_follow import ChatThreadFollow
from uniffy.core.types import AccessMode, ContentRole, ContentType, SubjectType
from uniffy.core.valkey.mentions import publish_mention_state
from uniffy.db import open_session
from uniffy.domains.chat.access import ChatAccessChecker
from uniffy.domains.chat.cache import (
    get_cached_pinned_message_ids,
    invalidate_cached_pinned_messages,
    set_cached_pinned_message_ids,
)

logger = logger.bind(component="chat.messages.operations")

MAX_MESSAGE_LENGTH = 30_000
EDIT_WINDOW_MINUTES = 2


async def bump_channel_message_stats(
    session: AsyncSession,
    channel_id: UUID,
    *,
    at: datetime,
    is_root: bool,
) -> None:
    """Advance the channel's message counters and activity timestamps.

    Every persisted chat row - human or agent - must run through this so the
    sidebar's last-activity ordering stays truthful. Caller owns the commit.
    """
    if is_root:
        await session.execute(
            update(ChatChannelStats)
            .where(ChatChannelStats.channel_id == channel_id)
            .values(
                message_count=ChatChannelStats.message_count + 1,
                root_message_count=ChatChannelStats.root_message_count + 1,
                last_message_at=at,
                last_root_message_at=at,
            )
        )
    else:
        await session.execute(
            update(ChatChannelStats)
            .where(ChatChannelStats.channel_id == channel_id)
            .values(
                message_count=ChatChannelStats.message_count + 1,
                last_message_at=at,
            )
        )


class ChatMessageOperations:
    """Message CRUD with two-phase transaction and thread auto-creation."""

    def __init__(self, session: AsyncSession, access: ChatAccessChecker | None = None) -> None:
        self.session = session
        self.access = access or ChatAccessChecker(session)

    async def send_message(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        content: str,
        root_id: UUID | None = None,
        reply_to_id: UUID | None = None,
        message_metadata: dict | None = None,
        sender_type: SenderType = SenderType.USER,
        sender_name: str = "",
        sender_avatar: str = "",
        attachment_file_ids: list[UUID] | None = None,
    ) -> tuple[ChatMessage, str, str]:
        """Send a message; Phase 1 DB transaction, Phase 2 post-commit publish/fan-out."""
        if len(content) > MAX_MESSAGE_LENGTH:
            raise ValidationError("content", f"Message exceeds {MAX_MESSAGE_LENGTH} characters")

        channel = await self.access.get_channel(channel_id, organization_id)
        await self.access.require_send(user_id, channel)

        # Hold the loaded root row and thread it to _handle_thread_reply to avoid a re-fetch.
        root_msg: ChatMessage | None = None
        if root_id:
            root_msg = await self._get_message_by_id(root_id)
            if not root_msg or root_msg.channel_id != channel_id:
                raise NotFoundError("message", root_id)
            if root_msg.root_id is not None:
                raise ValidationError("root_id", "Cannot reply to a reply (flat threads only)")

        reply_to_msg: ChatMessage | None = None
        if reply_to_id:
            reply_to_msg = await self._get_message_by_id(reply_to_id)
            if not reply_to_msg or reply_to_msg.channel_id != channel_id:
                raise NotFoundError("message", reply_to_id)

        now = datetime.now(UTC)
        agent_mentions = sorted(extract_mentioned_agent_ids_from_content(content))
        urn_mentions = sorted(
            extract_all_outgoing_references(content, organization_id=organization_id)
        )
        message = ChatMessage(
            channel_id=channel_id,
            sender_id=user_id,
            sender_type=sender_type,
            content=content,
            root_id=root_id,
            reply_to_id=reply_to_id,
            message_metadata=message_metadata,
            mentioned_agent_ids=agent_mentions or None,
            mentioned_urns=urn_mentions or None,
            created_at=now,
            updated_at=now,
        )
        self.session.add(message)
        await self.session.flush()

        if attachment_file_ids:
            from uniffy.domains.files.attachments.operations import AttachmentOperations

            att_ops = AttachmentOperations(self.session)
            for file_id in attachment_file_ids:
                await att_ops.attach_file(
                    user_id=user_id,
                    organization_id=organization_id,
                    content_type=ContentType.CHAT_MESSAGE,
                    content_id=message.id,
                    source_file_id=file_id,
                )

        await bump_channel_message_stats(self.session, channel_id, at=now, is_root=root_id is None)
        if root_id is not None:
            await self._handle_thread_reply(root_id, channel_id, user_id, now, root_msg)

        await self.session.commit()
        await self.session.refresh(message)

        reply_context: dict[str, str] | None = None
        if reply_to_msg:
            from uniffy.domains.chat.sender_resolver import SenderResolver

            resolver = SenderResolver(self.session)
            reply_info = await resolver.resolve_one(reply_to_msg.sender_type, reply_to_msg.sender_id)
            reply_context = {
                "id": str(reply_to_id),
                "sender_name": reply_info.display_name,
                "content_preview": reply_to_msg.content[:150],
            }

        await self._post_commit_send(
            message,
            channel,
            user_id,
            root_id,
            now,
            sender_name,
            sender_avatar,
            reply_context,
        )

        return message, sender_name, sender_avatar

    async def _post_commit_send(
        self,
        message: ChatMessage,
        channel: ChatChannel,
        user_id: UUID,
        root_id: UUID | None,
        now: datetime,
        sender_name: str,
        sender_avatar: str,
        reply_context: dict[str, str] | None = None,
    ) -> None:
        """Post-commit: synchronous publish, then background tasks. One member-id fetch shared."""
        import asyncio

        # Sending marks the sender read up to their own message, so the badge
        # never lights up in the sender's other sessions or devices.
        if message.sender_type == SenderType.USER:
            from uniffy.domains.chat.read_state.operations import ChatReadStateOperations

            read_ops = ChatReadStateOperations(self.session)
            try:
                if root_id is None:
                    await read_ops.mark_channel_read(user_id, channel.id, message.id)
                else:
                    await read_ops.mark_thread_read(user_id, root_id)
            except Exception:
                logger.warning(f"Failed to advance sender read cursor for channel {channel.id}")

        member_ids = await self._get_channel_member_ids(channel.id)

        await self._publish_send_event(
            message,
            channel,
            user_id,
            root_id,
            now,
            sender_name,
            sender_avatar,
            member_ids,
            reply_context,
        )

        # Agent detection runs before the background spawn: both touch self.session and
        # concurrent use of the same asyncpg connection trips an "operation in progress" error.
        await self._maybe_trigger_agents(message, channel)

        # Background opens its own session; the request handler's session is already closed.
        asyncio.create_task(
            _run_background_post_send(
                message_id=message.id,
                channel_id=channel.id,
                user_id=user_id,
                root_id=root_id,
                sender_name=sender_name,
                member_ids=member_ids,
            )
        )

    async def _maybe_trigger_agents(self, message: ChatMessage, channel: ChatChannel) -> None:
        """Detect agent mentions and enqueue respond_to_chat_message ARQ jobs; non-fatal."""
        try:
            from uniffy.domains.agents.chat_integration import (
                detect_agent_mentions,
            )
            from uniffy.domains.chat.feature_flags import is_chat_agents_enabled

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
                from uniffy.core.valkey.queue import get_queue

                queue = get_queue("egress")
                for m in matches:
                    await queue.enqueue_job(
                        "respond_to_chat_message",
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

    async def _background_post_send(
        self,
        message: ChatMessage,
        channel: ChatChannel,
        user_id: UUID,
        root_id: UUID | None,
        sender_name: str,
        member_ids: list[UUID],
    ) -> None:
        """Background post-send: index, resources, notifications; each step
        independent and non-fatal.
        """
        from uniffy.core.content.references import extract_mentioned_user_ids_from_content

        mentioned_user_ids = extract_mentioned_user_ids_from_content(message.content)

        await self._index_message(message, channel, member_ids, sender_name=sender_name)

        await self._update_resources(channel.id, message.content, user_id)

        muted_user_ids: set[UUID] = set()
        none_notification_ids: set[UUID] = set()
        mentions_only_ids: set[UUID] = set()
        try:
            from uniffy.core.models.chat.channel_member import (
                ChatChannelMember,
                ChatNotificationLevel,
            )

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
                elif row[2] == ChatNotificationLevel.MENTIONS:
                    mentions_only_ids.add(row[0])
        except Exception:
            logger.warning(f"Failed to fetch notification preferences for channel {channel.id}")

        await self._publish_unread_notifications(
            channel,
            user_id,
            member_ids,
            mentioned_user_ids,
            muted_user_ids | none_notification_ids,
            mentions_only_ids,
        )

        await self._emit_send_notifications(
            message,
            channel,
            user_id,
            root_id,
            sender_name,
            member_ids,
            mentioned_user_ids,
        )

        if message.sender_type == SenderType.USER:
            from uniffy.domains.chat.drafts.operations import ChatDraftOperations

            await ChatDraftOperations(self.session).clear_for_send(
                user_id, channel.organization_id, channel.id, root_id
            )

    async def _get_channel_member_ids(self, channel_id: UUID) -> list[UUID]:
        # USER-only; AGENT rows have NULL user_id which would crash _event_to_json on deserialize.
        from uniffy.domains.chat.cache import fetch_channel_members

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
            from uniffy.domains.chat.streaming.events import (
                MESSAGE_CREATED,
                THREAD_UPDATED,
                build_message_payload,
                build_thread_updated_payload,
            )
            from uniffy.domains.chat.streaming.publisher import (
                publish_channel_event_to_members,
            )

            await publish_channel_event_to_members(
                member_ids,
                MESSAGE_CREATED,
                build_message_payload(
                    message_id=message.id,
                    channel_id=channel.id,
                    sender_id=user_id,
                    sender_type=message.sender_type.value,
                    content=message.content,
                    root_id=root_id,
                    created_at=now,
                    sender_name=sender_name,
                    sender_avatar_url=sender_avatar,
                    reply_to_id=message.reply_to_id,
                    reply_context=reply_context,
                ),
            )

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

    async def _index_message(
        self,
        message: ChatMessage,
        channel: ChatChannel,
        member_ids: list[UUID],
        sender_name: str = "",
    ) -> None:
        """Index message to Meilisearch; caller threads member_ids from the fan-out path."""
        if channel.is_encrypted:
            return

        # Mention-only content indexes badly (would surface under the *referenced* item's name).
        from uniffy.core.content.references import (
            is_mention_only_content,
            strip_mentions_to_labels,
        )

        if is_mention_only_content(message.content):
            try:
                from uniffy.core.search.indexer import SearchIndexer

                indexer = SearchIndexer(self.session)
                urn = f"urn:uniffy:content:CHAT_MESSAGE:{message.id}"
                await indexer.remove(urn)
            except Exception:
                logger.warning(f"Search remove failed for mention-only message {message.id}")
            return

        try:
            from uniffy.core.search.indexer import SearchIndexer

            indexer = SearchIndexer(self.session)

            # SenderResolver handles AGENT-authored messages too (avoids "Unknown" fallback).
            if not sender_name:
                from uniffy.domains.chat.sender_resolver import SenderResolver

                resolver = SenderResolver(self.session)
                info = await resolver.resolve_one(message.sender_type, message.sender_id)
                sender_name = info.display_name

            plain = strip_mentions_to_labels(message.content)

            if channel.channel_type == ChannelType.PUBLIC:
                access_mode = AccessMode.OPEN_TO_ORG
                baseline_role: ContentRole | None = ContentRole.VIEWER
                shared_user_ids = None
            else:
                access_mode = AccessMode.EXPLICIT_MEMBERS
                baseline_role = None
                shared_user_ids = member_ids if member_ids else None

            urn = f"urn:uniffy:content:CHAT_MESSAGE:{message.id}"
            await indexer.index(
                urn=urn,
                organization_id=channel.organization_id,
                title=plain[:120],
                entity_type="chat_message",
                url_path=f"/chat/{channel.id}#{message.id}",
                access_mode=access_mode,
                baseline_role=baseline_role,
                owner_id=message.sender_id,
                keywords=plain,
                description=plain[:300],
                shared_user_ids=shared_user_ids,
                metadata={
                    "channel_id": str(channel.id),
                    "channel_name": channel.name,
                    "channel_type": channel.channel_type.value,
                    "sender_id": str(message.sender_id),
                    "sender_name": sender_name,
                    "parent_label": f"#{channel.name}",
                },
            )

            # Safe on first index too; no listeners exist for a brand-new URN.
            try:
                await publish_mention_state(
                    organization_id=channel.organization_id,
                    urn=urn,
                    changes={
                        "title": plain[:120],
                        "description": plain[:300],
                        "parent_label": f"#{channel.name}",
                        "sender_name": sender_name,
                        "channel_type": channel.channel_type.value,
                    },
                )
            except Exception:
                logger.warning(f"Failed to publish mention state for message {message.id}")
        except Exception:
            logger.warning(f"Meilisearch index failed for message {message.id}")

    async def _update_resources(
        self,
        channel_id: UUID,
        content: str,
        sender_id: UUID,
    ) -> None:
        try:
            from uniffy.domains.chat.resources.operations import ChatResourceOperations

            ops = ChatResourceOperations(self.session)
            await ops.update_resources_from_message(channel_id, content, sender_id)
        except Exception:
            logger.warning(f"Resource tracking failed for channel {channel_id}")

    async def _publish_unread_notifications(
        self,
        channel: ChatChannel,
        sender_id: UUID,
        member_ids: list[UUID],
        mentioned_user_ids: set[UUID] | None = None,
        skip_user_ids: set[UUID] | None = None,
        mentions_only_ids: set[UUID] | None = None,
    ) -> None:
        """Publish unread count change; skip muted/NONE; MENTIONS-only users only on @mention."""
        try:
            from uniffy.domains.chat.streaming.events import UNREAD_COUNT_CHANGED
            from uniffy.domains.chat.streaming.publisher import publish_user_chat_events

            mentioned = mentioned_user_ids or set()
            skip = skip_user_ids or set()
            mentions_only = mentions_only_ids or set()

            events: list[tuple[UUID, str, dict]] = []
            for uid in member_ids:
                if uid == sender_id:
                    continue
                if uid in skip:
                    continue
                if uid in mentions_only and uid not in mentioned:
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
    ) -> None:
        """Emit notifications + stream events for mentions, DMs, and thread replies."""
        try:
            from uniffy.core.events.bus import emit_notification
            from uniffy.core.events.types import NotificationEvent
            from uniffy.core.models.shared import NotificationType

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

                from uniffy.domains.chat.streaming.events import THREAD_ACTIVITY
                from uniffy.domains.chat.streaming.publisher import publish_user_chat_event

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

            if mention_targets:
                from uniffy.domains.chat.streaming.events import MENTION_RECEIVED
                from uniffy.domains.chat.streaming.publisher import (
                    publish_user_chat_event as pub_user,
                )

                mention_payload = {
                    "message_id": str(message.id),
                    "channel_id": str(channel.id),
                    "sender_id": str(user_id),
                    "content_preview": message.content[:150],
                }
                for mid in mention_targets:
                    await pub_user(mid, MENTION_RECEIVED, mention_payload)
        except Exception:
            logger.warning(f"Notification emit failed for message {message.id}")

    async def get_messages(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        before_id: UUID | None = None,
        after_id: UUID | None = None,
        around_id: UUID | None = None,
        limit: int = 50,
        root_only: bool = True,
    ) -> tuple[list[ChatMessage], bool]:
        """Cursor-paginated messages; around_id fetches limit/2 before + target + limit/2 after."""
        channel = await self.access.get_channel(channel_id, organization_id)
        await self.access.check_access(user_id, organization_id, channel)

        limit = min(max(limit, 1), 100)

        if around_id:
            return await self._get_messages_around(
                channel_id,
                around_id,
                limit,
                root_only,
            )

        query = select(ChatMessage).where(
            ChatMessage.channel_id == channel_id,
            ChatMessage.is_deleted == False,  # noqa: E712
        )

        if root_only:
            query = query.where(ChatMessage.root_id.is_(None))

        if before_id:
            cursor_msg = await self._get_message_by_id(before_id)
            if cursor_msg:
                query = query.where(
                    (ChatMessage.created_at, ChatMessage.id) < (cursor_msg.created_at, cursor_msg.id)
                )
            query = query.order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc())
        elif after_id:
            cursor_msg = await self._get_message_by_id(after_id)
            if cursor_msg:
                query = query.where(
                    (ChatMessage.created_at, ChatMessage.id) > (cursor_msg.created_at, cursor_msg.id)
                )
            query = query.order_by(ChatMessage.created_at.asc(), ChatMessage.id.asc())
        else:
            query = query.order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc())

        # +1 to detect has_more.
        query = query.limit(limit + 1)
        result = await self.session.execute(query)
        messages = list(result.scalars().all())

        has_more = len(messages) > limit
        if has_more:
            messages = messages[:limit]

        # DESC fetches (before_id / latest) need a reverse.
        if not after_id:
            messages.reverse()

        return messages, has_more

    async def _get_messages_around(
        self,
        channel_id: UUID,
        target_id: UUID,
        limit: int,
        root_only: bool,
    ) -> tuple[list[ChatMessage], bool]:
        target = await self._get_message_by_id(target_id)
        if not target:
            return [], False

        half = limit // 2
        base_where = [
            ChatMessage.channel_id == channel_id,
            ChatMessage.is_deleted == False,  # noqa: E712
        ]
        if root_only:
            base_where.append(ChatMessage.root_id.is_(None))

        before_q = (
            select(ChatMessage)
            .where(
                *base_where,
                (ChatMessage.created_at, ChatMessage.id) < (target.created_at, target.id),
            )
            .order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc())
            .limit(half)
        )
        before_result = await self.session.execute(before_q)
        before_msgs = list(before_result.scalars().all())
        before_msgs.reverse()

        after_q = (
            select(ChatMessage)
            .where(
                *base_where,
                (ChatMessage.created_at, ChatMessage.id) > (target.created_at, target.id),
            )
            .order_by(ChatMessage.created_at.asc(), ChatMessage.id.asc())
            .limit(half + 1)
        )
        after_result = await self.session.execute(after_q)
        after_msgs = list(after_result.scalars().all())

        has_more = len(after_msgs) > half
        if has_more:
            after_msgs = after_msgs[:half]

        return before_msgs + [target] + after_msgs, has_more

    async def get_message(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        message_id: UUID,
    ) -> ChatMessage:
        channel = await self.access.get_channel(channel_id, organization_id)
        await self.access.check_access(user_id, organization_id, channel)

        msg = await self._get_message_by_id(message_id)
        if not msg or msg.channel_id != channel_id:
            raise NotFoundError("message", message_id)
        return msg

    async def update_message(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        message_id: UUID,
        content: str,
    ) -> ChatMessage:
        """Update a message; own messages only, within EDIT_WINDOW_MINUTES."""
        if len(content) > MAX_MESSAGE_LENGTH:
            raise ValidationError("content", f"Message exceeds {MAX_MESSAGE_LENGTH} characters")

        await self.access.get_channel(channel_id, organization_id)
        msg = await self._get_message_by_id(message_id)
        if not msg or msg.channel_id != channel_id:
            raise NotFoundError("message", message_id)

        await self._require_message_action(user_id, organization_id, channel_id, msg, "edit")

        now = datetime.now(UTC)
        msg.content = content
        msg.edited_at = now
        msg.updated_at = now
        agent_mentions = sorted(extract_mentioned_agent_ids_from_content(content))
        urn_mentions = sorted(
            extract_all_outgoing_references(content, organization_id=organization_id)
        )
        msg.mentioned_agent_ids = agent_mentions or None
        msg.mentioned_urns = urn_mentions or None

        await self.session.commit()
        await self.session.refresh(msg)

        # One fetch covers fan-out + re-index.
        member_ids = await self._get_channel_member_ids(channel_id)

        try:
            from uniffy.domains.chat.streaming.events import (
                MESSAGE_UPDATED,
                build_message_payload,
            )
            from uniffy.domains.chat.streaming.publisher import (
                publish_channel_event_to_members,
            )

            await publish_channel_event_to_members(
                member_ids,
                MESSAGE_UPDATED,
                build_message_payload(
                    message_id=msg.id,
                    channel_id=channel_id,
                    sender_id=msg.sender_id,
                    sender_type=msg.sender_type.value,
                    content=msg.content,
                    root_id=msg.root_id,
                    created_at=msg.created_at,
                    edited_at=msg.edited_at,
                    is_pinned=msg.is_pinned,
                ),
            )
        except Exception:
            logger.warning(f"Valkey publish failed for message update {msg.id}")

        channel = await self.access.get_channel(channel_id, organization_id)
        await self._index_message(msg, channel, member_ids)

        await self._update_resources(channel_id, msg.content, msg.sender_id)

        return msg

    async def delete_message(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        message_id: UUID,
    ) -> None:
        await self.access.get_channel(channel_id, organization_id)
        msg = await self._get_message_by_id(message_id)
        if not msg or msg.channel_id != channel_id:
            raise NotFoundError("message", message_id)

        await self._require_message_action(user_id, organization_id, channel_id, msg, "delete")

        was_pinned = msg.is_pinned
        now = datetime.now(UTC)
        msg.is_deleted = True
        msg.deleted_at = now
        msg.updated_at = now

        # Audit admin moderation only; self-deletes carry too much volume to log.
        if msg.sender_id != user_id:
            await write_audit_event(
                self.session,
                organization_id=organization_id,
                actor_user_id=user_id,
                action=Action.CHAT_MESSAGE_DELETED_BY_ADMIN,
                resource_type=ContentType.CHAT_MESSAGE.value,
                resource_id=message_id,
                details={
                    "channel_id": str(channel_id),
                    "sender_id": str(msg.sender_id),
                    "sender_type": msg.sender_type.value,
                },
            )

        if msg.root_id is None:
            await self.session.execute(
                update(ChatChannelStats)
                .where(ChatChannelStats.channel_id == channel_id)
                .values(
                    message_count=ChatChannelStats.message_count - 1,
                    root_message_count=ChatChannelStats.root_message_count - 1,
                )
            )
        else:
            await self.session.execute(
                update(ChatChannelStats)
                .where(ChatChannelStats.channel_id == channel_id)
                .values(message_count=ChatChannelStats.message_count - 1)
            )
            await self.session.execute(
                update(ChatThreadStats)
                .where(ChatThreadStats.root_message_id == msg.root_id)
                .values(reply_count=ChatThreadStats.reply_count - 1)
            )

        await self.session.commit()

        if was_pinned:
            await invalidate_cached_pinned_messages(channel_id)

        try:
            from uniffy.domains.chat.streaming.events import (
                MESSAGE_DELETED,
                build_message_deleted_payload,
            )
            from uniffy.domains.chat.streaming.publisher import (
                publish_channel_event_to_members,
            )

            member_ids = await self._get_channel_member_ids(channel_id)
            await publish_channel_event_to_members(
                member_ids,
                MESSAGE_DELETED,
                build_message_deleted_payload(msg.id, now),
                channel_id=channel_id,
            )
        except Exception:
            logger.warning(f"Valkey publish failed for message delete {msg.id}")

        try:
            from uniffy.core.search.indexer import SearchIndexer

            indexer = SearchIndexer(self.session)
            urn = f"urn:uniffy:content:CHAT_MESSAGE:{msg.id}"
            await indexer.remove(urn)
        except Exception:
            logger.warning(f"Search remove failed for message {msg.id}")

        try:
            from uniffy.domains.chat.resources.operations import ChatResourceOperations

            ops = ChatResourceOperations(self.session)
            await ops.decrement_resources_from_message(channel_id, msg.content)
        except Exception:
            logger.warning(f"Resource decrement failed for message {msg.id}")

        try:
            from uniffy.domains.files.attachments.operations import AttachmentOperations

            att_ops = AttachmentOperations(self.session)
            await att_ops.detach_all_for_content(
                user_id=user_id,
                organization_id=organization_id,
                content_type=ContentType.CHAT_MESSAGE,
                content_id=message_id,
            )
        except Exception:
            logger.warning(f"Attachment cleanup failed for message {msg.id}")

    async def pin_message(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        message_id: UUID,
    ) -> ChatMessage:
        """Pin a message; requires admin/owner role."""
        await self.access.get_channel(channel_id, organization_id)
        msg = await self._get_message_by_id(message_id)
        if not msg or msg.channel_id != channel_id:
            raise NotFoundError("message", message_id)

        await self._require_message_action(user_id, organization_id, channel_id, msg, "pin")

        msg.is_pinned = True
        msg.updated_at = datetime.now(UTC)
        await self.session.commit()
        await self.session.refresh(msg)
        await invalidate_cached_pinned_messages(channel_id)
        return msg

    async def unpin_message(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        message_id: UUID,
    ) -> ChatMessage:
        """Unpin a message; requires admin/owner role."""
        await self.access.get_channel(channel_id, organization_id)
        msg = await self._get_message_by_id(message_id)
        if not msg or msg.channel_id != channel_id:
            raise NotFoundError("message", message_id)

        await self._require_message_action(user_id, organization_id, channel_id, msg, "pin")

        msg.is_pinned = False
        msg.updated_at = datetime.now(UTC)
        await self.session.commit()
        await self.session.refresh(msg)
        await invalidate_cached_pinned_messages(channel_id)
        return msg

    async def get_pinned_messages(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
    ) -> list[ChatMessage]:
        # Cached id list; full rows re-fetched by id so edits propagate without invalidation.
        channel = await self.access.get_channel(channel_id, organization_id)
        await self.access.check_access(user_id, organization_id, channel)

        cached_ids = await get_cached_pinned_message_ids(channel_id)
        if cached_ids is not None:
            if not cached_ids:
                return []
            result = await self.session.execute(
                select(ChatMessage)
                .where(
                    ChatMessage.id.in_(cached_ids),
                    ChatMessage.is_deleted == False,  # noqa: E712
                    ChatMessage.is_pinned == True,  # noqa: E712
                )
                .order_by(ChatMessage.created_at.desc())
            )
            return list(result.scalars().all())

        result = await self.session.execute(
            select(ChatMessage)
            .where(
                ChatMessage.channel_id == channel_id,
                ChatMessage.is_pinned == True,  # noqa: E712
                ChatMessage.is_deleted == False,  # noqa: E712
            )
            .order_by(ChatMessage.created_at.desc())
        )
        messages = list(result.scalars().all())
        await set_cached_pinned_message_ids(
            channel_id, [m.id for m in messages]
        )
        return messages

    async def _handle_thread_reply(
        self,
        root_id: UUID,
        channel_id: UUID,
        sender_id: UUID,
        now: datetime,
        root_msg: ChatMessage,
    ) -> None:
        result = await self.session.execute(
            select(ChatThread).where(ChatThread.root_message_id == root_id)
        )
        thread = result.scalar_one_or_none()

        if not thread:
            thread = ChatThread(
                root_message_id=root_id,
                channel_id=channel_id,
                created_at=now,
            )
            self.session.add(thread)
            await self.session.flush()

            stats = ChatThreadStats(
                root_message_id=root_id,
                reply_count=1,
                last_reply_at=now,
            )
            self.session.add(stats)

            # Auto-follow root author (USER only; agent participation is via AgentChatBridge).
            if (
                root_msg.sender_id != sender_id
                and root_msg.sender_type == SenderType.USER
            ):
                self.session.add(
                    ChatThreadFollow(
                        root_message_id=root_id,
                        subject_type=SubjectType.USER,
                        subject_id=root_msg.sender_id,
                        user_id=root_msg.sender_id,
                        created_at=now,
                    )
                )
        else:
            await self.session.execute(
                update(ChatThreadStats)
                .where(ChatThreadStats.root_message_id == root_id)
                .values(
                    reply_count=ChatThreadStats.reply_count + 1,
                    last_reply_at=now,
                )
            )

        # Sender is always a USER from this path; agent participation goes via AgentChatBridge.
        await self.session.execute(
            pg_insert(ChatThreadParticipant)
            .values(
                root_message_id=root_id,
                subject_type=SubjectType.USER,
                subject_id=sender_id,
                user_id=sender_id,
                created_at=now,
            )
            .on_conflict_do_nothing(index_elements=["root_message_id", "subject_type", "subject_id"])
        )

        await self.session.execute(
            pg_insert(ChatThreadFollow)
            .values(
                root_message_id=root_id,
                subject_type=SubjectType.USER,
                subject_id=sender_id,
                user_id=sender_id,
                created_at=now,
            )
            .on_conflict_do_nothing(index_elements=["root_message_id", "subject_type", "subject_id"])
        )

    async def _require_message_action(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        message: ChatMessage,
        action: str,
    ) -> None:
        is_elevated = await self.access.require_elevated(user_id, organization_id, channel_id)

        if action == "edit":
            if message.sender_id != user_id:
                raise PermissionDeniedError("edit", "Can only edit own messages")
            window = datetime.now(UTC) - timedelta(minutes=EDIT_WINDOW_MINUTES)
            if message.created_at < window:
                raise ValidationError("message", "Edit window has expired")

        elif action == "delete":
            if message.sender_id != user_id and not is_elevated:
                raise PermissionDeniedError("delete", "Cannot delete other users' messages")

        elif action == "pin":
            if not is_elevated:
                raise PermissionDeniedError("pin", "Requires channel admin")

    async def _get_message_by_id(self, message_id: UUID) -> ChatMessage | None:
        result = await self.session.execute(select(ChatMessage).where(ChatMessage.id == message_id))
        return result.scalar_one_or_none()


async def _run_background_post_send(
    *,
    message_id: UUID,
    channel_id: UUID,
    user_id: UUID,
    root_id: UUID | None,
    sender_name: str,
    member_ids: list[UUID],
) -> None:
    """Fire-and-forget post-send; opens its own session because the request session is closed."""
    try:
        async with open_session() as session:
            message = await session.get(ChatMessage, message_id)
            channel = await session.get(ChatChannel, channel_id)
            if message is None or channel is None:
                return
            ops = ChatMessageOperations(session)
            await ops._background_post_send(
                message,
                channel,
                user_id,
                root_id,
                sender_name,
                member_ids,
            )
    except Exception:
        logger.exception(f"background post-send failed for message {message_id}")
