"""Focused chat message sending behavior."""

from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import select

from uniffy.core.content.references import (
    BroadcastMention,
    extract_all_outgoing_references,
    extract_broadcast_mentions_from_content,
    extract_mentioned_agent_ids_from_content,
)
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.jobs import enqueue_job
from uniffy.core.json_codec import dumps_str
from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.chat.channel import ChatChannel
from uniffy.core.models.chat.channel_member import (
    ChannelRole,
    ChatChannelMember,
)
from uniffy.core.models.chat.message import ChatMessage, SenderType
from uniffy.core.types import ContentType
from uniffy.domains.chat.jobs.contracts import POST_SEND_CHAT_MESSAGE
from uniffy.domains.chat.limits import SEND, check_chat_mutation_limit
from uniffy.domains.chat.messages.limits import MAX_MESSAGE_LENGTH
from uniffy.domains.chat.messages.stats import bump_channel_message_stats
from uniffy.domains.chat.policies.operations import (
    BroadcastMinRole,
    resolve_chat_policy,
)
from uniffy.domains.chat.reads.operations import ChatReadStateOperations
from uniffy.domains.chat.senders import SenderResolver
from uniffy.domains.chat.threads.replies import record_thread_reply
from uniffy.domains.files.attachments.operations import AttachmentOperations
from uniffy.domains.presence.state import PRESENCE_STATUS_ONLINE, presence_get_bulk

logger = logger.bind(component="chat.messages.sending")


class MessageSender:
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
        """Persist a message before publishing its non-authoritative effects."""
        if len(content) > MAX_MESSAGE_LENGTH:
            raise ValidationError("content", f"Message exceeds {MAX_MESSAGE_LENGTH} characters")

        channel = await self.access.get_channel(channel_id, organization_id)
        # SYSTEM breadcrumbs record something that happened, attributed to a user
        # for display - they are not that user speaking. The attributed user may
        # have no member row (a PUBLIC-channel caller, a moderating admin) and the
        # channel may already be archived (a call ended by archiving); neither may
        # lose the record. All SYSTEM sends are internal - the SendMessage RPC
        # never passes a sender_type.
        member: ChatChannelMember | None = None
        if sender_type != SenderType.SYSTEM:
            member = await self.access.require_send(user_id, channel)
        if sender_type == SenderType.USER:
            await check_chat_mutation_limit(
                SEND,
                user_id=user_id,
                organization_id=organization_id,
            )
            if extract_broadcast_mentions_from_content(content):
                await self._require_broadcast_allowed(user_id, channel, member)

        # An agent DM whose agent was deleted is frozen: the history stays
        # readable, but nothing new can be said to an agent that cannot answer.
        if channel.is_agent_dm and channel.agent_id is not None:
            agent_deleted = await self.session.execute(
                select(Agent.is_deleted).where(Agent.id == channel.agent_id)
            )
            if agent_deleted.scalar_one_or_none() is not False:
                raise ValidationError("channel", "This agent was deleted")

        # Hold the loaded root row and thread it to record_thread_reply to avoid a re-fetch.
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
            att_ops = AttachmentOperations(
                self.session,
                self.storage,
                self.search_indexer,
            )
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
            await record_thread_reply(
                self.session,
                root_message_id=root_id,
                channel_id=channel_id,
                sender_type=SenderType.USER,
                sender_id=user_id,
                at=now,
                root_message=root_msg,
            )

        await self.session.commit()
        await self.session.refresh(message)

        reply_context: dict[str, str] | None = None
        if reply_to_msg:
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

    async def _require_broadcast_allowed(
        self,
        user_id: UUID,
        channel: ChatChannel,
        member: ChatChannelMember | None,
    ) -> None:
        """Gate channel-wide mentions behind the org broadcast policy."""
        policy = await resolve_chat_policy(self.session, channel.organization_id)
        if policy.broadcast_min_role == BroadcastMinRole.MEMBER:
            return
        if member is not None and member.role in (ChannelRole.ADMIN, ChannelRole.OWNER):
            return
        if await self.access.is_org_admin(user_id, channel.organization_id):
            return
        if await self.access.is_chat_domain_admin(user_id, channel.organization_id):
            return
        raise PermissionDeniedError(
            "broadcast", "Channel-wide mentions are limited to admins in this organization"
        )

    @staticmethod
    def _effective_broadcast_kind(kinds: set[BroadcastMention]) -> BroadcastMention:
        """Widest kind wins: @channel reaches the whole roster, @here only online members."""
        if BroadcastMention.CHANNEL in kinds:
            return BroadcastMention.CHANNEL
        return BroadcastMention.HERE

    async def _online_member_ids(
        self,
        channel: ChatChannel,
        candidate_ids: set[UUID],
    ) -> set[UUID]:
        """Members whose presence is online right now; absent-from-Valkey means offline."""
        online: set[UUID] = set()
        ids = list(candidate_ids)
        chunk_size = 200
        for start in range(0, len(ids), chunk_size):
            chunk = ids[start : start + chunk_size]
            try:
                data = await presence_get_bulk(channel.organization_id, chunk)
            except Exception:
                logger.warning(f"presence lookup failed for channel {channel.id}")
                continue
            for uid_str, info in data.items():
                if info.get("status") != PRESENCE_STATUS_ONLINE:
                    continue
                try:
                    online.add(UUID(uid_str))
                except ValueError:
                    continue
        return online

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
        """Publish the committed message and enqueue its remaining projections."""
        # Sending marks the sender read up to their own message, so the badge
        # never lights up in the sender's other sessions or devices.
        if message.sender_type == SenderType.USER:
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

        # Agent detection finishes on this session before background work begins.
        await self._maybe_trigger_agents(message, channel)

        try:
            await enqueue_job(
                POST_SEND_CHAT_MESSAGE,
                str(message.id),
                str(channel.id),
                str(user_id),
                str(root_id) if root_id is not None else None,
                sender_name,
                dumps_str([str(member_id) for member_id in member_ids]),
            )
        except Exception:
            logger.opt(exception=True).warning(
                f"Background post-send work was not queued for message {message.id}"
            )
