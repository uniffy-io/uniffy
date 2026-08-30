"""Chat message operations; permission checks delegate to ChatAccessChecker."""

from datetime import UTC, datetime, timedelta
from enum import StrEnum
from uuid import UUID

from loguru import logger
from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.content.references import (
    BroadcastMention,
    extract_all_outgoing_references,
    extract_broadcast_mentions_from_content,
    extract_mentioned_agent_ids_from_content,
    extract_mentioned_team_ids_from_content,
)
from uniffy.core.content.team_mentions import TeamExpansion, expand_team_mentions
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.jobs import enqueue_job
from uniffy.core.json_codec import dumps_str
from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.chat.channel import ChannelType, ChatChannel, ChatChannelStats
from uniffy.core.models.chat.channel_member import (
    ChannelRole,
    ChatChannelMember,
    ChatNotificationLevel,
)
from uniffy.core.models.chat.message import ChatMessage, ChatMessageMetadataKind, SenderType
from uniffy.core.models.chat.message_revision import ChatMessageRevision
from uniffy.core.models.chat.thread import ChatThread, ChatThreadParticipant, ChatThreadStats
from uniffy.core.models.chat.thread_follow import ChatThreadFollow
from uniffy.core.search import SearchIndexer
from uniffy.core.storage import ObjectStorage
from uniffy.core.types import AccessMode, ContentRole, ContentType, SubjectType
from uniffy.core.valkey.mentions import publish_mention_state
from uniffy.core.valkey.presence import PRESENCE_STATUS_ONLINE, presence_get_bulk
from uniffy.domains.chat.access import ChatAccessChecker
from uniffy.domains.chat.cache import (
    get_cached_pinned_message_ids,
    invalidate_cached_pinned_messages,
    set_cached_pinned_message_ids,
)
from uniffy.domains.chat.jobs.contracts import POST_SEND_CHAT_MESSAGE
from uniffy.domains.chat.limits import SEND, check_chat_mutation_limit
from uniffy.domains.chat.messages.converters import (
    get_forward_metadata,
    public_message_metadata,
)
from uniffy.domains.chat.policies.operations import (
    BroadcastMinRole,
    EditHistoryVisibility,
    resolve_chat_policy,
)

logger = logger.bind(component="chat.messages.operations")


MAX_MESSAGE_LENGTH = 30_000


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


# Agent rows a reader sees as an answer in the thread. Tool cards, tool results
# and compaction summaries are machinery, so they never move the reply counter.
AGENT_THREAD_REPLY_KINDS = frozenset({
    ChatMessageMetadataKind.FINAL,
    ChatMessageMetadataKind.AGENT_ERROR,
    ChatMessageMetadataKind.SKILL_DRAFT,
})


class ChatMessageAction(StrEnum):
    EDIT = "edit"
    DELETE = "delete"
    PIN = "pin"


def counts_as_thread_reply(message: ChatMessage) -> bool:
    """Whether a row moves its thread's reply counter."""
    if message.root_id is None:
        return False
    if message.sender_type != SenderType.AGENT:
        return True
    return (message.message_metadata or {}).get("kind") in AGENT_THREAD_REPLY_KINDS


async def record_thread_reply(
    session: AsyncSession,
    *,
    root_message_id: UUID,
    channel_id: UUID,
    sender_type: SenderType,
    sender_id: UUID,
    at: datetime,
    root_message: ChatMessage | None = None,
) -> None:
    """Count one reply into a thread and record its sender as a participant.

    Agents participate as AGENT subjects with no `user_id`, so the follow rows -
    a user-inbox concept - are written for human senders only. Caller owns the
    commit.
    """
    is_agent = sender_type == SenderType.AGENT
    subject_type = SubjectType.AGENT if is_agent else SubjectType.USER

    result = await session.execute(
        select(ChatThread).where(ChatThread.root_message_id == root_message_id)
    )
    thread = result.scalar_one_or_none()

    if not thread:
        session.add(
            ChatThread(
                root_message_id=root_message_id,
                channel_id=channel_id,
                created_at=at,
            )
        )
        await session.flush()
        session.add(
            ChatThreadStats(
                root_message_id=root_message_id,
                reply_count=1,
                last_reply_at=at,
            )
        )

        if (
            root_message is not None
            and root_message.sender_id != sender_id
            and root_message.sender_type == SenderType.USER
        ):
            session.add(
                ChatThreadFollow(
                    root_message_id=root_message_id,
                    subject_type=SubjectType.USER,
                    subject_id=root_message.sender_id,
                    user_id=root_message.sender_id,
                    created_at=at,
                )
            )
    else:
        await session.execute(
            update(ChatThreadStats)
            .where(ChatThreadStats.root_message_id == root_message_id)
            .values(
                reply_count=ChatThreadStats.reply_count + 1,
                last_reply_at=at,
            )
        )

    await session.execute(
        pg_insert(ChatThreadParticipant)
        .values(
            root_message_id=root_message_id,
            subject_type=subject_type,
            subject_id=sender_id,
            user_id=None if is_agent else sender_id,
            created_at=at,
        )
        .on_conflict_do_nothing(index_elements=["root_message_id", "subject_type", "subject_id"])
    )

    if is_agent:
        return

    await session.execute(
        pg_insert(ChatThreadFollow)
        .values(
            root_message_id=root_message_id,
            subject_type=SubjectType.USER,
            subject_id=sender_id,
            user_id=sender_id,
            created_at=at,
        )
        .on_conflict_do_nothing(index_elements=["root_message_id", "subject_type", "subject_id"])
    )


async def drop_thread_reply(session: AsyncSession, root_message_id: UUID) -> None:
    """Take one counted reply back off a thread (deletion, discarded placeholder).

    Participant rows are append-only, so only the counter moves. Caller owns the
    commit.
    """
    await session.execute(
        update(ChatThreadStats)
        .where(
            ChatThreadStats.root_message_id == root_message_id,
            ChatThreadStats.reply_count > 0,
        )
        .values(reply_count=ChatThreadStats.reply_count - 1)
    )


class ChatMessageOperations:
    """Message CRUD with two-phase transaction and thread auto-creation."""

    def __init__(
        self,
        session: AsyncSession,
        access: ChatAccessChecker | None = None,
        storage: ObjectStorage | None = None,
        search_indexer: SearchIndexer | None = None,
    ) -> None:
        self.session = session
        self.access = access or ChatAccessChecker(session)
        self.storage = storage
        self._search_indexer = search_indexer

    @property
    def search_indexer(self) -> SearchIndexer:
        if self._search_indexer is None:
            raise RuntimeError("Search indexing is required for chat message mutations")
        return self._search_indexer

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
            from uniffy.domains.files.attachments.operations import AttachmentOperations

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
            from uniffy.domains.chat.senders import SenderResolver

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
            from uniffy.domains.chat.reads.operations import ChatReadStateOperations

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

    async def _maybe_trigger_agents(self, message: ChatMessage, channel: ChatChannel) -> None:
        """Detect agent mentions and enqueue respond_to_chat_message ARQ jobs; non-fatal."""
        try:
            from uniffy.domains.agents.bridge import (
                detect_agent_mentions,
            )
            from uniffy.domains.chat.features import is_chat_agents_enabled

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
                from uniffy.core.jobs import enqueue_job
                from uniffy.domains.agents.bridge.jobs.contracts import (
                    RESPOND_TO_CHAT_MESSAGE,
                )

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

    async def _background_post_send(
        self,
        message: ChatMessage,
        channel: ChatChannel,
        user_id: UUID,
        root_id: UUID | None,
        sender_name: str,
        member_ids: list[UUID],
    ) -> None:
        """Run the independent, non-authoritative post-send projections."""
        from uniffy.core.content.references import extract_mentioned_user_ids_from_content

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

        await self._index_message(message, channel, member_ids, sender_name=sender_name)

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
            from uniffy.domains.chat.drafts.operations import ChatDraftOperations

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
                publish_user_chat_events,
            )

            forward_metadata = get_forward_metadata(message.message_metadata)
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

    async def _index_message(
        self,
        message: ChatMessage,
        channel: ChatChannel,
        member_ids: list[UUID],
        sender_name: str = "",
    ) -> None:
        # System messages (joined/left channel, call started/ended, member
        # added) are UI narration, not content; they only pollute search.
        if message.sender_type == SenderType.SYSTEM:
            return

        # Mention-only content indexes badly (would surface under the *referenced* item's name).
        from uniffy.core.content.references import (
            is_mention_only_content,
            strip_mentions_to_labels,
        )

        if is_mention_only_content(message.content):
            try:
                urn = f"urn:uniffy:content:CHAT_MESSAGE:{message.id}"
                await self.search_indexer.remove(urn)
            except Exception:
                logger.warning(f"Search remove failed for mention-only message {message.id}")
            return

        try:
            # SenderResolver handles AGENT-authored messages too (avoids "Unknown" fallback).
            if not sender_name:
                from uniffy.domains.chat.senders import SenderResolver

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
            await self.search_indexer.index(
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
            logger.warning(f"Search indexing failed for message {message.id}")

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
    ) -> None:
        """Publish the unread/mention count change to every member but the sender.

        Deliberately preference-blind: the read-time aggregate counts unread and
        mention rows for muted, NONE, and MENTIONS-only members too, so the live
        event must match or the badge diverges until the next reload. Muting
        gates notifications, never unread state.
        """
        try:
            from uniffy.domains.chat.streaming.events import UNREAD_COUNT_CHANGED
            from uniffy.domains.chat.streaming.publisher import publish_user_chat_events

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

            # A broadcast widens this set to the whole roster, so the fan-out
            # must stay one pipelined round trip, never a PUBLISH per member.
            mention_stream_targets = mention_targets + team_targets + broadcast_targets
            if mention_stream_targets:
                from uniffy.domains.chat.streaming.events import MENTION_RECEIVED
                from uniffy.domains.chat.streaming.publisher import (
                    publish_user_chat_events,
                )

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
            around = await self._get_messages_around(
                channel_id,
                around_id,
                limit,
                root_only,
            )
            if around is not None:
                return around
            # Target is gone or belongs elsewhere (stale search hit, old deep link);
            # the latest page beats handing back an empty channel.

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
    ) -> tuple[list[ChatMessage], bool] | None:
        """None when the target cannot anchor a window, so the caller can serve the latest page."""
        target = await self._get_message_by_id(target_id)
        if not target or target.channel_id != channel_id or target.is_deleted:
            return None

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
            .limit(half + 1)
        )
        before_result = await self.session.execute(before_q)
        before_msgs = list(before_result.scalars().all())

        # has_more reports the OLDER side, matching before_id pagination: clients page backwards
        # from a window, and a target near the tail would otherwise disable that.
        has_more = len(before_msgs) > half
        if has_more:
            before_msgs = before_msgs[:half]
        before_msgs.reverse()

        after_q = (
            select(ChatMessage)
            .where(
                *base_where,
                (ChatMessage.created_at, ChatMessage.id) > (target.created_at, target.id),
            )
            .order_by(ChatMessage.created_at.asc(), ChatMessage.id.asc())
            .limit(half)
        )
        after_result = await self.session.execute(after_q)
        after_msgs = list(after_result.scalars().all())

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
        """Update a message; own messages only, within the org's edit window policy."""
        if len(content) > MAX_MESSAGE_LENGTH:
            raise ValidationError("content", f"Message exceeds {MAX_MESSAGE_LENGTH} characters")

        channel = await self.access.get_channel(channel_id, organization_id)
        msg = await self._get_message_by_id(message_id)
        if not msg or msg.channel_id != channel_id:
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

        await self._record_revision(msg, edited_by=user_id)

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

        await self._require_message_action(
            user_id, organization_id, channel_id, msg, ChatMessageAction.DELETE
        )

        from uniffy.domains.files.attachments.operations import AttachmentOperations

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
            urn = f"urn:uniffy:content:CHAT_MESSAGE:{msg.id}"
            await self.search_indexer.remove(urn)
        except Exception:
            logger.warning(f"Search remove failed for message {msg.id}")

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
