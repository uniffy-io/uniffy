"""Focused chat message mutations behavior."""

from datetime import UTC, datetime, timedelta
from uuid import UUID

from loguru import logger
from sqlalchemy import func, select, update

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.content.references import (
    extract_all_outgoing_references,
    extract_broadcast_mentions_from_content,
    extract_mentioned_agent_ids_from_content,
)
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.chat.channel import ChatChannelStats
from uniffy.core.models.chat.message import ChatMessage
from uniffy.core.models.chat.message_revision import ChatMessageRevision
from uniffy.core.types import ContentType
from uniffy.domains.chat.cache import (
    get_cached_pinned_message_ids,
    invalidate_cached_pinned_messages,
    set_cached_pinned_message_ids,
)
from uniffy.domains.chat.messages.broadcasts import (
    lock_message_pair,
    peer_attachment_content,
    released_resource_content,
)
from uniffy.domains.chat.messages.converters import get_thread_reply_metadata
from uniffy.domains.chat.messages.limits import MAX_MESSAGE_LENGTH
from uniffy.domains.chat.messages.types import ChatMessageAction
from uniffy.domains.chat.policies.operations import (
    EditHistoryVisibility,
    resolve_chat_policy,
)
from uniffy.domains.chat.resources.operations import ChatResourceOperations
from uniffy.domains.chat.streaming.events import (
    MESSAGE_DELETED,
    MESSAGE_UPDATED,
    build_message_deleted_payload,
    build_message_payload,
)
from uniffy.domains.chat.streaming.publisher import publish_channel_event_to_members
from uniffy.domains.chat.threads.replies import counts_as_thread_reply, drop_thread_reply
from uniffy.domains.files.attachments.operations import AttachmentOperations

logger = logger.bind(component="chat.messages.mutations")


class MessageMutations:
    async def update_message(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        message_id: UUID,
        content: str,
    ) -> ChatMessage:
        """Update a message; own messages only, within the org's edit window policy."""
        if len(content) > MAX_MESSAGE_LENGTH:
            raise ValidationError("content", f"Message exceeds {MAX_MESSAGE_LENGTH} characters")

        channel = await self.access.get_channel(channel_id, organization_id)
        msg = await self._get_message_by_id(message_id)
        if not msg or msg.channel_id != channel_id:
            raise NotFoundError("message", message_id)
        msg, peer = await lock_message_pair(self.session, msg)
        if msg.is_deleted:
            raise NotFoundError("message", message_id)

        await self._require_message_action(
            user_id, organization_id, channel_id, msg, ChatMessageAction.EDIT
        )

        # Editing in a broadcast must clear the same bar as sending one.
        if extract_broadcast_mentions_from_content(content):
            editor_member = await self.access.get_membership(channel_id, user_id)
            await self._require_broadcast_allowed(user_id, channel, editor_member)

        if content == msg.content:
            return msg

        now = datetime.now(UTC)
        edits = [(msg, content)]
        if peer is not None and not peer.is_deleted:
            peer_content = await peer_attachment_content(
                self.session,
                organization_id=organization_id,
                message=msg,
                peer=peer,
                content=content,
            )
            edits.append((peer, peer_content))
        for edited, body in edits:
            await self._record_revision(edited, edited_by=user_id)
            edited.content = body
            edited.edited_at = now
            edited.updated_at = now
            edited.mentioned_agent_ids = (
                sorted(extract_mentioned_agent_ids_from_content(body)) or None
                if get_thread_reply_metadata(edited.message_metadata) is None
                else None
            )
            edited.mentioned_urns = (
                sorted(extract_all_outgoing_references(body, organization_id=organization_id))
                or None
            )

        await self.session.commit()
        await self.session.refresh(msg)

        # One fetch covers fan-out + re-index.
        member_ids = await self._get_channel_member_ids(channel_id)

        for edited, _ in edits:
            try:
                await publish_channel_event_to_members(
                    member_ids,
                    MESSAGE_UPDATED,
                    build_message_payload(
                        message_id=edited.id,
                        channel_id=channel_id,
                        sender_id=edited.sender_id,
                        sender_type=edited.sender_type.value,
                        content=edited.content,
                        root_id=edited.root_id,
                        created_at=edited.created_at,
                        edited_at=edited.edited_at,
                        is_pinned=edited.is_pinned,
                    ),
                )
            except Exception:
                logger.warning(f"Valkey publish failed for message update {edited.id}")

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
        channel = await self.access.get_channel(channel_id, organization_id)
        msg = await self._get_message_by_id(message_id)
        if not msg or msg.channel_id != channel_id:
            raise NotFoundError("message", message_id)
        msg, peer = await lock_message_pair(self.session, msg)
        if msg.is_deleted:
            raise NotFoundError("message", message_id)

        await self._require_message_action(
            user_id, organization_id, channel_id, msg, ChatMessageAction.DELETE
        )

        await AttachmentOperations(
            self.session,
            self.storage,
            self.search_indexer,
        ).detach_all_for_content(
            user_id=user_id,
            organization_id=organization_id,
            content_type=ContentType.CHAT_MESSAGE,
            content_id=message_id,
        )

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
                resource_type=AuditResourceType.CHAT_MESSAGE,
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
            if counts_as_thread_reply(msg):
                await drop_thread_reply(self.session, msg.root_id)

        await self.session.commit()

        if was_pinned:
            await invalidate_cached_pinned_messages(channel_id)

        member_ids = await self._get_channel_member_ids(channel_id)
        try:
            await publish_channel_event_to_members(
                member_ids,
                MESSAGE_DELETED,
                build_message_deleted_payload(msg.id, now),
                channel_id=channel_id,
            )
        except Exception:
            logger.warning(f"Valkey publish failed for message delete {msg.id}")

        try:
            urn = f"urn:uniffy:content:CHAT_MESSAGE:{msg.id}"
            await self.search_indexer.remove(urn)
        except Exception:
            logger.warning(f"Search remove failed for message {msg.id}")

        if peer is not None and not peer.is_deleted:
            await self._index_message(peer, channel, member_ids)

        released = released_resource_content(msg, peer)
        if released is not None:
            try:
                ops = ChatResourceOperations(self.session)
                await ops.decrement_resources_from_message(channel_id, released)
            except Exception:
                logger.warning(f"Resource decrement failed for message {msg.id}")

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

        await self._require_message_action(
            user_id, organization_id, channel_id, msg, ChatMessageAction.PIN
        )

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

        await self._require_message_action(
            user_id, organization_id, channel_id, msg, ChatMessageAction.PIN
        )

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
        await set_cached_pinned_message_ids(channel_id, [m.id for m in messages])
        return messages

    async def _require_message_action(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        message: ChatMessage,
        action: ChatMessageAction,
    ) -> None:
        is_elevated = await self.access.require_elevated(user_id, organization_id, channel_id)

        if action is ChatMessageAction.EDIT:
            if message.sender_id != user_id:
                raise PermissionDeniedError("edit", "Can only edit own messages")
            policy = await resolve_chat_policy(self.session, organization_id)
            if policy.edit_window_minutes == 0:
                raise PermissionDeniedError("edit", "Message editing is disabled")
            if policy.edit_window_minutes is not None:
                window = datetime.now(UTC) - timedelta(minutes=policy.edit_window_minutes)
                if message.created_at < window:
                    raise ValidationError("message", "Edit window has expired")

        elif action is ChatMessageAction.DELETE:
            if message.sender_id != user_id and not is_elevated:
                raise PermissionDeniedError("delete", "Cannot delete other users' messages")

        elif action is ChatMessageAction.PIN:
            if not is_elevated:
                raise PermissionDeniedError("pin", "Requires channel admin")

    async def get_message_revisions(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        message_id: UUID,
    ) -> list[ChatMessageRevision]:
        channel = await self.access.get_channel(channel_id, organization_id)
        await self.access.check_access(user_id, organization_id, channel)

        msg = await self._get_message_by_id(message_id)
        if not msg or msg.channel_id != channel_id or msg.is_deleted:
            raise NotFoundError("message", message_id)

        if msg.sender_id != user_id:
            policy = await resolve_chat_policy(self.session, organization_id)
            if policy.edit_history_visible_to is not EditHistoryVisibility.EVERYONE and not (
                await self.access.require_elevated(user_id, organization_id, channel_id)
            ):
                raise PermissionDeniedError("view", "Edit history is limited to admins")

        result = await self.session.execute(
            select(ChatMessageRevision)
            .where(ChatMessageRevision.message_id == message_id)
            .order_by(ChatMessageRevision.revision_no)
        )
        return list(result.scalars().all())

    async def _record_revision(self, message: ChatMessage, *, edited_by: UUID) -> None:
        """Snapshot the message's current content before an edit replaces it (caller commits)."""
        result = await self.session.execute(
            select(func.coalesce(func.max(ChatMessageRevision.revision_no), 0)).where(
                ChatMessageRevision.message_id == message.id
            )
        )
        next_no = int(result.scalar_one()) + 1
        self.session.add(
            ChatMessageRevision(
                message_id=message.id,
                revision_no=next_no,
                content=message.content,
                edited_by=edited_by,
            )
        )

    async def _get_message_by_id(self, message_id: UUID) -> ChatMessage | None:
        result = await self.session.execute(select(ChatMessage).where(ChatMessage.id == message_id))
        return result.scalar_one_or_none()
