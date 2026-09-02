"""Focused chat channel agents behavior."""

from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import and_, func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from uniffy.core.auth.permissions import (
    PermissionChecker,
    role_can_view,
)
from uniffy.core.errors import (
    NotFoundError,
    PermissionDeniedError,
    ValidationError,
)
from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.agents.channel_binding import AgentChannelBinding
from uniffy.core.models.chat.channel import ChannelType, ChatChannel, ChatChannelStats
from uniffy.core.models.chat.channel_member import (
    ChannelRole,
    ChatChannelMember,
)
from uniffy.core.types import (
    ContentType,
    generate_id,
    slugify,
)
from uniffy.domains.chat.channels.cursor import clamp_page_size, decode_cursor, encode_cursor
from uniffy.domains.chat.channels.limits import (
    DEFAULT_PAGE_SIZE,
)
from uniffy.domains.chat.channels.slugs import slug_suffix
from uniffy.domains.chat.limits import (
    CHANNEL_CREATE,
    check_chat_mutation_limit,
)
from uniffy.domains.chat.subjects import ChatSubject

logger = logger.bind(component="chat.channels.agents")


class AgentChannels:
    async def _require_agent_usable(
        self,
        user_id: UUID,
        organization_id: UUID,
        agent_id: UUID,
    ) -> None:
        """Actor must have VIEWER+ on the agent to add it to a channel."""
        agent_row = await self.session.execute(
            select(
                Agent.id,
                Agent.owner_id,
                Agent.access_mode,
                Agent.baseline_role,
                Agent.organization_id,
            ).where(
                Agent.id == agent_id,
                Agent.organization_id == organization_id,
                Agent.is_deleted == False,  # noqa: E712
            )
        )
        row = agent_row.one_or_none()
        if row is None:
            raise NotFoundError("agent", agent_id)

        checker = PermissionChecker(self.session)
        role = await checker.effective_role(
            user_id=user_id,
            organization_id=organization_id,
            content_type=ContentType.AGENT,
            content_id=row[0],
            owner_id=row[1],
            access_mode=row[2],
            baseline_role=row[3],
        )
        if not role_can_view(role):
            raise PermissionDeniedError("use", "agent")

    async def _ensure_agent_bindings(
        self,
        channel_id: UUID,
        agent_ids: list[UUID],
        actor_user_id: UUID,
    ) -> None:
        """Idempotent default AgentChannelBinding rows for new AGENT members."""
        if not agent_ids:
            return
        rows = [
            {
                "channel_id": channel_id,
                "agent_id": agent_id,
                "created_by_user_id": actor_user_id,
            }
            for agent_id in agent_ids
        ]
        stmt = pg_insert(AgentChannelBinding).values(rows)
        stmt = stmt.on_conflict_do_nothing(constraint="agents_channel_bindings_unique")
        await self.session.execute(stmt)

    async def create_agent_chat(
        self,
        user_id: UUID,
        organization_id: UUID,
        agent_id: UUID,
        custom_name: str | None = None,
    ) -> ChatChannel:
        """Create a new named (user, agent) chat; multiple chats per pair are allowed."""
        await self.access.require_org_member(user_id, organization_id)
        await self._require_agent_usable(user_id, organization_id, agent_id)
        await check_chat_mutation_limit(
            CHANNEL_CREATE,
            user_id=user_id,
            organization_id=organization_id,
        )

        agent_subject = ChatSubject.agent(agent_id)
        actor_subject = ChatSubject.user(user_id)
        participants = [actor_subject, agent_subject]

        base_name = await self._build_dm_name_from_subjects([agent_subject])
        existing_count_result = await self.session.execute(
            select(func.count())
            .select_from(ChatChannel)
            .join(
                ChatChannelMember,
                (ChatChannelMember.channel_id == ChatChannel.id)
                & (ChatChannelMember.user_id == user_id),
            )
            .where(
                ChatChannel.organization_id == organization_id,
                ChatChannel.is_agent_dm == True,  # noqa: E712
                ChatChannel.agent_id == agent_id,
                ChatChannel.is_deleted == False,  # noqa: E712
            )
        )
        existing_count = existing_count_result.scalar_one() or 0
        default_name = base_name if existing_count == 0 else f"{base_name} ({existing_count + 1})"

        slug = f"{slugify(default_name)}-{slug_suffix(generate_id())}"

        normalized_custom = (custom_name or "").strip() or None
        if normalized_custom and len(normalized_custom) > 200:
            raise ValidationError("custom_name", "Name must be 200 characters or fewer")

        channel = ChatChannel(
            organization_id=organization_id,
            owner_id=user_id,
            name=default_name,
            slug=slug,
            description="",
            channel_type=ChannelType.DIRECT,
            is_agent_dm=True,
            agent_id=agent_id,
            custom_name=normalized_custom,
        )
        self.session.add(channel)
        await self.session.flush()

        self.session.add(ChatChannelStats(channel_id=channel.id, member_count=len(participants)))

        for s in participants:
            role = ChannelRole.OWNER if s == actor_subject else ChannelRole.MEMBER
            self.session.add(self._build_member_row(channel.id, s, role))

        await self._ensure_agent_bindings(
            channel.id,
            [agent_id],
            actor_user_id=user_id,
        )

        await self.session.commit()
        await self.session.refresh(channel)

        try:
            await self._index_for_search(channel)
        except Exception:
            logger.warning(f"Failed to index agent chat {channel.id}")

        await self._publish_channel_created(channel.id)

        return channel

    async def rename_agent_chat(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        custom_name: str | None,
    ) -> ChatChannel:
        """Set/clear the user's custom display name; only the human member can rename."""
        channel = await self.get_by_id(user_id, organization_id, channel_id)
        if not channel.is_agent_dm:
            raise ValidationError("channel_id", "Channel is not an agent chat")

        membership = await self.access.get_membership(channel_id, user_id)
        if membership is None:
            raise PermissionDeniedError("rename", "agent chat")

        normalized = (custom_name or "").strip() or None
        if normalized is not None and len(normalized) > 200:
            raise ValidationError("custom_name", "Name must be 200 characters or fewer")

        channel.custom_name = normalized
        channel.updated_at = datetime.now(UTC)
        await self.session.commit()
        await self.session.refresh(channel)

        await self._refresh_channel_live_state(channel)
        await self._publish_channel_updated(channel)

        return channel

    async def backfill_agent_chat_search_index(
        self,
        organization_id: UUID,
    ) -> int:
        """Re-index every active agent chat in an org; drops any CHAT urn
        before re-indexing as AGENT_CHAT.
        """
        result = await self.session.execute(
            select(ChatChannel).where(
                ChatChannel.organization_id == organization_id,
                ChatChannel.is_agent_dm == True,  # noqa: E712
                ChatChannel.is_deleted == False,  # noqa: E712
            )
        )
        channels = list(result.scalars().all())
        for channel in channels:
            try:
                await self.search_indexer.remove(
                    urn=f"urn:uniffy:content:CHAT:{channel.id}",
                    organization_id=channel.organization_id,
                )
            except Exception:
                logger.warning(f"Failed to drop legacy CHAT urn for {channel.id}")
            try:
                await self._index_for_search(channel)
            except Exception:
                logger.warning(f"Failed to backfill search index for chat {channel.id}")
        return len(channels)

    async def list_agent_chats(
        self,
        user_id: UUID,
        organization_id: UUID,
        *,
        agent_id: UUID | None = None,
        cursor: str | None = None,
        limit: int = DEFAULT_PAGE_SIZE,
    ) -> tuple[list[tuple[ChatChannel, ChatChannelStats]], str | None]:
        """User's agent chats with same keyset as list_user_channels; restricted to is_agent_dm."""
        await self.access.require_org_member(user_id, organization_id)
        epoch_ts = datetime(1, 1, 1, tzinfo=UTC)
        sort_ts = func.coalesce(ChatChannelStats.last_root_message_at, epoch_ts)

        base_query = (
            select(ChatChannel, ChatChannelStats)
            .join(
                ChatChannelStats,
                ChatChannelStats.channel_id == ChatChannel.id,
            )
            .join(
                ChatChannelMember,
                (ChatChannelMember.channel_id == ChatChannel.id)
                & (ChatChannelMember.user_id == user_id),
            )
            .where(
                ChatChannel.organization_id == organization_id,
                ChatChannel.is_agent_dm == True,  # noqa: E712
                ChatChannel.is_deleted == False,  # noqa: E712
                ChatChannel.is_archived == False,  # noqa: E712,
            )
            .order_by(sort_ts.desc(), ChatChannel.id.asc())
        )

        if agent_id is not None:
            base_query = base_query.where(ChatChannel.agent_id == agent_id)

        if cursor:
            payload = decode_cursor(cursor)
            try:
                cursor_ts = datetime.fromisoformat(payload["sort_ts"])
                cursor_cid = UUID(payload["channel_id"])
            except (KeyError, TypeError, ValueError) as exc:
                raise ValidationError("cursor", "Invalid pagination cursor") from exc
            base_query = base_query.where(
                or_(
                    sort_ts < cursor_ts,
                    and_(sort_ts == cursor_ts, ChatChannel.id > cursor_cid),
                )
            )

        page_size = clamp_page_size(limit)
        result = await self.session.execute(base_query.limit(page_size + 1))
        rows = list(result.all())
        next_cursor: str | None = None
        if len(rows) > page_size:
            rows = rows[:page_size]
            last_channel, last_stats = rows[-1]
            last_ts = last_stats.last_root_message_at or epoch_ts
            next_cursor = encode_cursor({
                "sort_ts": last_ts.isoformat(),
                "channel_id": str(last_channel.id),
            })
        return rows, next_cursor
