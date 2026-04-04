"""Chat message operations with two-phase transaction pattern.

Messages are children of channels, not top-level content entities.
This class does NOT extend BaseContentOperations. Permission checks
delegate to ChatAccessChecker.
"""

from datetime import UTC, datetime, timedelta
from uuid import UUID

from loguru import logger
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.chat.channel import ChannelType, ChatChannel, ChatChannelStats
from uniffy.core.models.chat.message import ChatMessage, SenderType
from uniffy.core.models.chat.thread import ChatThread, ChatThreadParticipant, ChatThreadStats
from uniffy.core.models.chat.thread_follow import ChatThreadFollow
from uniffy.domains.chat.access import ChatAccessChecker

# Maximum message content length
MAX_MESSAGE_LENGTH = 30_000
# Edit window in minutes
EDIT_WINDOW_MINUTES = 2


class ChatMessageOperations:
    """Message CRUD with two-phase transaction and thread auto-creation."""

    def __init__(self, session: AsyncSession, access: ChatAccessChecker | None = None) -> None:
        self.session = session
        self.access = access or ChatAccessChecker(session)

    # ---------------------------------------------------------------
    # Send message (two-phase transaction)
    # ---------------------------------------------------------------

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
    ) -> tuple[ChatMessage, str, str]:
        """Send a message to a channel.

        Phase 1 (DB transaction): INSERT message, UPDATE stats, handle thread.
        Phase 2 (post-commit): Valkey publish.

        Returns (message, sender_name, sender_avatar_url).
        Caller should pass sender_name/sender_avatar from JWT claims.
        """
        if len(content) > MAX_MESSAGE_LENGTH:
            raise ValidationError(
                "content", f"Message exceeds {MAX_MESSAGE_LENGTH} characters"
            )

        # Verify channel access and send permission
        channel = await self.access.get_channel(channel_id, organization_id)
        await self.access.require_send(user_id, channel)

        # Validate root_id if provided (thread reply)
        if root_id:
            root_msg = await self._get_message_by_id(root_id)
            if not root_msg or root_msg.channel_id != channel_id:
                raise NotFoundError("message", root_id)
            if root_msg.root_id is not None:
                raise ValidationError(
                    "root_id", "Cannot reply to a reply (flat threads only)"
                )

        # Validate reply_to_id if provided (inline quote reply)
        reply_to_msg: ChatMessage | None = None
        if reply_to_id:
            reply_to_msg = await self._get_message_by_id(reply_to_id)
            if not reply_to_msg or reply_to_msg.channel_id != channel_id:
                raise NotFoundError("message", reply_to_id)

        # Phase 1: DB transaction
        now = datetime.now(UTC)
        message = ChatMessage(
            channel_id=channel_id,
            sender_id=user_id,
            sender_type=sender_type,
            content=content,
            root_id=root_id,
            reply_to_id=reply_to_id,
            message_metadata=message_metadata,
            created_at=now,
            updated_at=now,
        )
        self.session.add(message)
        await self.session.flush()

        # Update channel stats
        if root_id is None:
            # Root message: bump both counters
            await self.session.execute(
                update(ChatChannelStats)
                .where(ChatChannelStats.channel_id == channel_id)
                .values(
                    message_count=ChatChannelStats.message_count + 1,
                    root_message_count=ChatChannelStats.root_message_count + 1,
                    last_message_at=now,
                    last_root_message_at=now,
                )
            )
        else:
            # Thread reply: only bump message_count and last_message_at
            await self.session.execute(
                update(ChatChannelStats)
                .where(ChatChannelStats.channel_id == channel_id)
                .values(
                    message_count=ChatChannelStats.message_count + 1,
                    last_message_at=now,
                )
            )
            # Handle thread creation/update
            await self._handle_thread_reply(root_id, channel_id, user_id, now)

        await self.session.commit()
        await self.session.refresh(message)

        # Resolve reply context for streaming (before post-commit)
        reply_context: dict[str, str] | None = None
        if reply_to_msg:
            from uniffy.core.models.login.user import User

            u_result = await self.session.execute(
                select(User.full_name).where(User.id == reply_to_msg.sender_id)
            )
            reply_sender = u_result.scalar_one_or_none() or "Unknown"
            reply_context = {
                "id": str(reply_to_id),
                "sender_name": reply_sender,
                "content_preview": reply_to_msg.content[:150],
            }

        # Phase 2: Post-commit (non-fatal, best-effort)
        await self._post_commit_send(
            message, channel, user_id, root_id, now,
            sender_name, sender_avatar, reply_context,
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
        """Post-commit actions: publish (sync), then background tasks.

        Fetches member IDs once upfront, shared across real-time fan-out,
        search indexing, unread notifications, and app notifications.
        """
        import asyncio

        # Fetch member IDs once - used by real-time publish, index, and notifications
        member_ids = await self._get_channel_member_ids(channel.id)

        # 1. Fan out to member user channels (synchronous - essential for real-time)
        await self._publish_send_event(
            message, channel, user_id, root_id, now,
            sender_name, sender_avatar, member_ids, reply_context,
        )

        # 2-4. Background: index, resources, notifications
        asyncio.create_task(
            self._background_post_send(
                message, channel, user_id, root_id, sender_name, member_ids,
            )
        )

    async def _background_post_send(
        self,
        message: ChatMessage,
        channel: ChatChannel,
        user_id: UUID,
        root_id: UUID | None,
        sender_name: str,
        member_ids: list[UUID],
    ) -> None:
        """Background post-send: index, resources, notifications.

        Runs as a fire-and-forget asyncio task. Each step is independent
        and non-fatal.
        """
        # For search indexing, only private channels need member IDs
        index_member_ids = member_ids if channel.channel_type != ChannelType.PUBLIC else None

        # Index to Meilisearch
        await self._index_message(message, channel, index_member_ids)

        # Update channel resources (URN mention tracking)
        await self._update_resources(channel.id, message.content, user_id)

        # Notify channel members of unread count change
        await self._publish_unread_notifications(channel, user_id, member_ids)

        # Emit notifications
        await self._emit_send_notifications(
            message, channel, user_id, root_id, sender_name, member_ids,
        )

    async def _get_channel_member_ids(self, channel_id: UUID) -> list[UUID]:
        """Fetch all member user IDs for a channel."""
        try:
            from uniffy.core.models.chat.channel_member import ChatChannelMember

            result = await self.session.execute(
                select(ChatChannelMember.user_id).where(
                    ChatChannelMember.channel_id == channel_id
                )
            )
            return [r[0] for r in result.all()]
        except Exception:
            logger.warning(f"Failed to fetch members for channel {channel_id}")
            return []

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
        """Fan out MESSAGE_CREATED and THREAD_UPDATED to all channel members."""
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
                    select(ChatThreadStats).where(
                        ChatThreadStats.root_message_id == root_id
                    )
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
        member_ids: list[UUID] | None = None,
    ) -> None:
        """Index message content to Meilisearch.

        member_ids: pre-fetched channel member IDs for private channels.
        Avoids re-querying when already fetched by the caller.
        """
        if channel.is_encrypted:
            return

        try:
            from uniffy.core.search.indexer import SearchIndexer

            indexer = SearchIndexer(self.session)

            # Strip URN mentions to plain labels for search
            from uniffy.core.content.references import strip_mentions_to_labels

            plain = strip_mentions_to_labels(message.content)

            # Derive access from channel membership
            if channel.channel_type == ChannelType.PUBLIC:
                visibility = "ORGANIZATION"
                shared_user_ids = None
            else:
                visibility = "PRIVATE"
                if member_ids is not None:
                    shared_user_ids = member_ids if member_ids else None
                else:
                    # Fallback: fetch member IDs if not pre-fetched
                    from uniffy.core.models.chat.channel_member import ChatChannelMember

                    result = await self.session.execute(
                        select(ChatChannelMember.user_id).where(
                            ChatChannelMember.channel_id == channel.id
                        )
                    )
                    fetched = [r[0] for r in result.all()]
                    shared_user_ids = fetched if fetched else None

            urn = f"urn:uniffy:content:CHAT_MESSAGE:{message.id}"
            await indexer.index(
                urn=urn,
                organization_id=channel.organization_id,
                title=plain[:120],
                entity_type="chat_message",
                url_path=f"/chat/{channel.id}",
                visibility=visibility,
                owner_id=message.sender_id,
                keywords=plain,
                shared_user_ids=shared_user_ids,
                metadata={
                    "channel_id": str(channel.id),
                    "channel_name": channel.name,
                    "channel_type": channel.channel_type.value,
                    "sender_id": str(message.sender_id),
                },
            )
        except Exception:
            logger.warning(f"Meilisearch index failed for message {message.id}")

    async def _update_resources(
        self,
        channel_id: UUID,
        content: str,
        sender_id: UUID,
    ) -> None:
        """Update channel resource tracking from URN mentions."""
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
    ) -> None:
        """Publish unread count change to all channel members except the sender."""
        try:
            from uniffy.domains.chat.streaming.events import UNREAD_COUNT_CHANGED
            from uniffy.domains.chat.streaming.publisher import publish_user_chat_event

            for uid in member_ids:
                if uid == sender_id:
                    continue
                await publish_user_chat_event(
                    uid,
                    UNREAD_COUNT_CHANGED,
                    {
                        "channel_id": str(channel.id),
                        "unread_count": 1,
                        "mention_count": 0,
                    },
                )
        except Exception:
            logger.warning(
                f"Failed to publish unread notifications for channel {channel.id}"
            )

    async def _emit_send_notifications(
        self,
        message: ChatMessage,
        channel: ChatChannel,
        user_id: UUID,
        root_id: UUID | None,
        sender_name: str,
        member_ids: list[UUID],
    ) -> None:
        """Emit chat notifications: mentions, DMs, thread replies."""
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

            # 1. @mentions in content (batch all mentioned users into one notification)
            from uniffy.core.content.references import (
                extract_mentioned_user_ids_from_content,
            )

            mentioned_ids = extract_mentioned_user_ids_from_content(
                message.content
            )
            mention_targets = [mid for mid in mentioned_ids if mid != user_id]
            if mention_targets:
                await emit_notification(NotificationEvent(
                    notification_type=NotificationType.CHAT_MENTION,
                    organization_id=channel.organization_id,
                    actor_id=user_id,
                    title=f"Mentioned you in #{channel.name}",
                    body=preview,
                    source_urn=channel_urn,
                    target_user_ids=mention_targets,
                    metadata=notif_metadata,
                ))
                notified_ids.update(mention_targets)

            # 2. DM/GROUP_DM notifications
            if channel.channel_type in (ChannelType.DIRECT, ChannelType.GROUP_DM):
                dm_recipients = [
                    mid for mid in member_ids
                    if mid != user_id and mid not in notified_ids
                ]
                if dm_recipients:
                    await emit_notification(NotificationEvent(
                        notification_type=NotificationType.CHAT_DM,
                        organization_id=channel.organization_id,
                        actor_id=user_id,
                        title="Sent you a message",
                        body=preview,
                        source_urn=channel_urn,
                        target_user_ids=dm_recipients,
                        metadata=notif_metadata,
                    ))
                    notified_ids.update(dm_recipients)

            # 3. Thread reply notifications
            if root_id:
                result = await self.session.execute(
                    select(ChatThreadFollow.user_id).where(
                        ChatThreadFollow.root_message_id == root_id,
                        ChatThreadFollow.user_id != user_id,
                    )
                )
                followers = [
                    r[0] for r in result.all()
                    if r[0] not in notified_ids
                ]
                if followers:
                    await emit_notification(NotificationEvent(
                        notification_type=NotificationType.CHAT_THREAD_REPLY,
                        organization_id=channel.organization_id,
                        actor_id=user_id,
                        title=f"Replied in a thread in #{channel.name}",
                        body=preview,
                        source_urn=channel_urn,
                        target_user_ids=followers,
                        metadata=notif_metadata,
                    ))
        except Exception:
            logger.warning(f"Notification emit failed for message {message.id}")

    # ---------------------------------------------------------------
    # Get messages (cursor-based pagination)
    # ---------------------------------------------------------------

    async def get_messages(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        before_id: UUID | None = None,
        after_id: UUID | None = None,
        limit: int = 50,
        root_only: bool = True,
    ) -> tuple[list[ChatMessage], bool]:
        """Get messages with cursor-based pagination.

        Returns (messages, has_more).
        """
        channel = await self.access.get_channel(channel_id, organization_id)
        await self.access.check_access(user_id, organization_id, channel)

        limit = min(max(limit, 1), 100)

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
                    (ChatMessage.created_at, ChatMessage.id)
                    < (cursor_msg.created_at, cursor_msg.id)
                )
            query = query.order_by(
                ChatMessage.created_at.desc(), ChatMessage.id.desc()
            )
        elif after_id:
            cursor_msg = await self._get_message_by_id(after_id)
            if cursor_msg:
                query = query.where(
                    (ChatMessage.created_at, ChatMessage.id)
                    > (cursor_msg.created_at, cursor_msg.id)
                )
            query = query.order_by(
                ChatMessage.created_at.asc(), ChatMessage.id.asc()
            )
        else:
            # Latest messages
            query = query.order_by(
                ChatMessage.created_at.desc(), ChatMessage.id.desc()
            )

        # Fetch limit+1 to detect has_more
        query = query.limit(limit + 1)
        result = await self.session.execute(query)
        messages = list(result.scalars().all())

        has_more = len(messages) > limit
        if has_more:
            messages = messages[:limit]

        # Reverse if we fetched in DESC order (before_id or latest)
        if not after_id:
            messages.reverse()

        return messages, has_more

    async def get_message(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        message_id: UUID,
    ) -> ChatMessage:
        """Get a single message by ID."""
        channel = await self.access.get_channel(channel_id, organization_id)
        await self.access.check_access(user_id, organization_id, channel)

        msg = await self._get_message_by_id(message_id)
        if not msg or msg.channel_id != channel_id:
            raise NotFoundError("message", message_id)
        return msg

    # ---------------------------------------------------------------
    # Update / delete / pin
    # ---------------------------------------------------------------

    async def update_message(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        message_id: UUID,
        content: str,
    ) -> ChatMessage:
        """Update a message (own messages, within edit window)."""
        if len(content) > MAX_MESSAGE_LENGTH:
            raise ValidationError(
                "content", f"Message exceeds {MAX_MESSAGE_LENGTH} characters"
            )

        await self.access.get_channel(channel_id, organization_id)
        msg = await self._get_message_by_id(message_id)
        if not msg or msg.channel_id != channel_id:
            raise NotFoundError("message", message_id)

        await self._require_message_action(
            user_id, organization_id, channel_id, msg, "edit"
        )

        now = datetime.now(UTC)
        msg.content = content
        msg.edited_at = now
        msg.updated_at = now

        await self.session.commit()
        await self.session.refresh(msg)

        # Post-commit: fan out to members, re-index, update resources
        try:
            from uniffy.domains.chat.streaming.events import (
                MESSAGE_UPDATED,
                build_message_payload,
            )
            from uniffy.domains.chat.streaming.publisher import (
                publish_channel_event_to_members,
            )

            member_ids = await self._get_channel_member_ids(channel_id)
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

        # Re-index in Meilisearch (channel already cached in access checker)
        channel = await self.access.get_channel(channel_id, organization_id)
        await self._index_message(msg, channel)

        # Update resource tracking
        await self._update_resources(channel_id, msg.content, msg.sender_id)

        return msg

    async def delete_message(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        message_id: UUID,
    ) -> None:
        """Soft-delete a message."""
        await self.access.get_channel(channel_id, organization_id)
        msg = await self._get_message_by_id(message_id)
        if not msg or msg.channel_id != channel_id:
            raise NotFoundError("message", message_id)

        await self._require_message_action(
            user_id, organization_id, channel_id, msg, "delete"
        )

        now = datetime.now(UTC)
        msg.is_deleted = True
        msg.deleted_at = now
        msg.updated_at = now

        # Decrement channel stats
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
            # Decrement thread stats
            await self.session.execute(
                update(ChatThreadStats)
                .where(ChatThreadStats.root_message_id == msg.root_id)
                .values(reply_count=ChatThreadStats.reply_count - 1)
            )

        await self.session.commit()

        # Post-commit: fan out to members, remove from search, decrement resources
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

        # Remove from Meilisearch
        try:
            from uniffy.core.search.indexer import SearchIndexer

            indexer = SearchIndexer(self.session)
            urn = f"urn:uniffy:content:CHAT_MESSAGE:{msg.id}"
            await indexer.remove(urn)
        except Exception:
            logger.warning(f"Search remove failed for message {msg.id}")

        # Decrement resource tracking
        try:
            from uniffy.domains.chat.resources.operations import ChatResourceOperations

            ops = ChatResourceOperations(self.session)
            await ops.decrement_resources_from_message(channel_id, msg.content)
        except Exception:
            logger.warning(f"Resource decrement failed for message {msg.id}")

    async def pin_message(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        message_id: UUID,
    ) -> ChatMessage:
        """Pin a message. Requires admin/owner role."""
        await self.access.get_channel(channel_id, organization_id)
        msg = await self._get_message_by_id(message_id)
        if not msg or msg.channel_id != channel_id:
            raise NotFoundError("message", message_id)

        await self._require_message_action(
            user_id, organization_id, channel_id, msg, "pin"
        )

        msg.is_pinned = True
        msg.updated_at = datetime.now(UTC)
        await self.session.commit()
        await self.session.refresh(msg)
        return msg

    async def unpin_message(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        message_id: UUID,
    ) -> ChatMessage:
        """Unpin a message. Requires admin/owner role."""
        await self.access.get_channel(channel_id, organization_id)
        msg = await self._get_message_by_id(message_id)
        if not msg or msg.channel_id != channel_id:
            raise NotFoundError("message", message_id)

        await self._require_message_action(
            user_id, organization_id, channel_id, msg, "pin"
        )

        msg.is_pinned = False
        msg.updated_at = datetime.now(UTC)
        await self.session.commit()
        await self.session.refresh(msg)
        return msg

    async def get_pinned_messages(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
    ) -> list[ChatMessage]:
        """Get all pinned messages in a channel."""
        channel = await self.access.get_channel(channel_id, organization_id)
        await self.access.check_access(user_id, organization_id, channel)

        result = await self.session.execute(
            select(ChatMessage).where(
                ChatMessage.channel_id == channel_id,
                ChatMessage.is_pinned == True,  # noqa: E712
                ChatMessage.is_deleted == False,  # noqa: E712
            ).order_by(ChatMessage.created_at.desc())
        )
        return list(result.scalars().all())

    # ---------------------------------------------------------------
    # Thread helpers
    # ---------------------------------------------------------------

    async def _handle_thread_reply(
        self,
        root_id: UUID,
        channel_id: UUID,
        sender_id: UUID,
        now: datetime,
    ) -> None:
        """Handle thread creation/update on reply."""
        # Check if thread exists
        result = await self.session.execute(
            select(ChatThread).where(
                ChatThread.root_message_id == root_id
            )
        )
        thread = result.scalar_one_or_none()

        if not thread:
            # Create thread + stats on first reply
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

            # Auto-follow the root message author
            root_msg = await self._get_message_by_id(root_id)
            if root_msg and root_msg.sender_id != sender_id:
                self.session.add(ChatThreadFollow(
                    root_message_id=root_id,
                    user_id=root_msg.sender_id,
                    created_at=now,
                ))
        else:
            # Update existing thread stats
            await self.session.execute(
                update(ChatThreadStats)
                .where(ChatThreadStats.root_message_id == root_id)
                .values(
                    reply_count=ChatThreadStats.reply_count + 1,
                    last_reply_at=now,
                )
            )

        # Add sender as thread participant (idempotent)
        await self.session.execute(
            pg_insert(ChatThreadParticipant)
            .values(
                root_message_id=root_id,
                user_id=sender_id,
                created_at=now,
            )
            .on_conflict_do_nothing(
                index_elements=["root_message_id", "user_id"]
            )
        )

        # Auto-follow sender (idempotent)
        await self.session.execute(
            pg_insert(ChatThreadFollow)
            .values(
                root_message_id=root_id,
                user_id=sender_id,
                created_at=now,
            )
            .on_conflict_do_nothing(
                index_elements=["root_message_id", "user_id"]
            )
        )

    # ---------------------------------------------------------------
    # Permission helpers
    # ---------------------------------------------------------------

    async def _require_message_action(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        message: ChatMessage,
        action: str,
    ) -> None:
        """Check role-based permission for message operations."""
        is_elevated = await self.access.require_elevated(
            user_id, organization_id, channel_id
        )

        if action == "edit":
            if message.sender_id != user_id:
                raise PermissionDeniedError("edit", "Can only edit own messages")
            window = datetime.now(UTC) - timedelta(minutes=EDIT_WINDOW_MINUTES)
            if message.created_at < window:
                raise ValidationError("message", "Edit window has expired")

        elif action == "delete":
            if message.sender_id != user_id and not is_elevated:
                raise PermissionDeniedError(
                    "delete", "Cannot delete other users' messages"
                )

        elif action == "pin":
            if not is_elevated:
                raise PermissionDeniedError("pin", "Requires channel admin")

    # ---------------------------------------------------------------
    # Internal query helpers
    # ---------------------------------------------------------------

    async def _get_message_by_id(self, message_id: UUID) -> ChatMessage | None:
        """Fetch a message by ID."""
        result = await self.session.execute(
            select(ChatMessage).where(ChatMessage.id == message_id)
        )
        return result.scalar_one_or_none()
