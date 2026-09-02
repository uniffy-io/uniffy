"""Focused chat channel queries behavior."""

from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import and_, func, or_, select

from uniffy.core.errors import (
    ValidationError,
)
from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.chat.channel import ChannelType, ChatChannel, ChatChannelStats
from uniffy.core.models.chat.channel_member import (
    ChannelRole,
    ChatChannelMember,
)
from uniffy.core.models.login.user import User
from uniffy.core.types import (
    SubjectType,
)
from uniffy.domains.chat.channels.cursor import clamp_page_size, decode_cursor, encode_cursor
from uniffy.domains.chat.channels.limits import (
    DEFAULT_PAGE_SIZE,
)

logger = logger.bind(component="chat.channels.queries")


class ChannelQueries:
    async def list_user_channels(
        self,
        user_id: UUID,
        organization_id: UUID,
        *,
        cursor: str | None = None,
        limit: int = DEFAULT_PAGE_SIZE,
        tag_ids: list[UUID] | None = None,
    ) -> tuple[list[tuple[ChatChannel, ChatChannelStats, ChannelRole, UUID | None]], str | None]:
        await self.access.require_org_member(user_id, organization_id)
        # Keyset by (coalesce(last_root_message_at, epoch) DESC, channel_id ASC).
        epoch_ts = datetime(1, 1, 1, tzinfo=UTC)
        sort_ts = func.coalesce(ChatChannelStats.last_root_message_at, epoch_ts)

        base_query = (
            select(
                ChatChannel,
                ChatChannelStats,
                ChatChannelMember.role,
                ChatChannelMember.agent_folder_id,
            )
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
                ChatChannel.is_deleted == False,  # noqa: E712
                ChatChannel.is_archived == False,  # noqa: E712
            )
            .order_by(sort_ts.desc(), ChatChannel.id.asc())
        )

        if tag_ids:
            base_query = base_query.where(ChatChannel.id.in_(self._tag_filter_subquery(tag_ids)))

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
            last_channel, last_stats, _, _ = rows[-1]
            last_ts = last_stats.last_root_message_at or epoch_ts
            next_cursor = encode_cursor({
                "sort_ts": last_ts.isoformat(),
                "channel_id": str(last_channel.id),
            })
        return rows, next_cursor

    async def list_user_channel_ids(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> list[UUID]:
        """ID-only fan-out fetch for unread aggregation; same visibility
        filter as list_user_channels.
        """
        await self.access.require_org_member(user_id, organization_id)
        result = await self.session.execute(
            select(ChatChannel.id)
            .join(
                ChatChannelMember,
                (ChatChannelMember.channel_id == ChatChannel.id)
                & (ChatChannelMember.user_id == user_id),
            )
            .where(
                ChatChannel.organization_id == organization_id,
                ChatChannel.is_deleted == False,  # noqa: E712
                ChatChannel.is_archived == False,  # noqa: E712
            )
        )
        return list(result.scalars().all())

    async def list_public_channels(
        self,
        user_id: UUID,
        organization_id: UUID,
        *,
        cursor: str | None = None,
        limit: int = DEFAULT_PAGE_SIZE,
        tag_ids: list[UUID] | None = None,
    ) -> tuple[list[tuple[ChatChannel, ChatChannelStats]], str | None]:
        await self.access.require_org_member(user_id, organization_id)
        # Keyset by (member_count DESC, channel_id ASC).
        base_query = (
            select(ChatChannel, ChatChannelStats)
            .join(
                ChatChannelStats,
                ChatChannelStats.channel_id == ChatChannel.id,
            )
            .where(
                ChatChannel.organization_id == organization_id,
                ChatChannel.channel_type == ChannelType.PUBLIC,
                ChatChannel.is_deleted == False,  # noqa: E712
            )
            .order_by(ChatChannelStats.member_count.desc(), ChatChannel.id.asc())
        )

        if tag_ids:
            base_query = base_query.where(ChatChannel.id.in_(self._tag_filter_subquery(tag_ids)))

        if cursor:
            payload = decode_cursor(cursor)
            try:
                cursor_count = int(payload["member_count"])
                cursor_cid = UUID(payload["channel_id"])
            except (KeyError, TypeError, ValueError) as exc:
                raise ValidationError("cursor", "Invalid pagination cursor") from exc
            base_query = base_query.where(
                or_(
                    ChatChannelStats.member_count < cursor_count,
                    and_(
                        ChatChannelStats.member_count == cursor_count,
                        ChatChannel.id > cursor_cid,
                    ),
                )
            )

        page_size = clamp_page_size(limit)
        result = await self.session.execute(base_query.limit(page_size + 1))
        rows = list(result.all())
        next_cursor: str | None = None
        if len(rows) > page_size:
            rows = rows[:page_size]
            last_channel, last_stats = rows[-1]
            next_cursor = encode_cursor({
                "member_count": last_stats.member_count,
                "channel_id": str(last_channel.id),
            })
        return rows, next_cursor

    async def get_members(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        *,
        cursor: str | None = None,
        limit: int = DEFAULT_PAGE_SIZE,
    ) -> tuple[list[tuple[ChatChannelMember, User | None, Agent | None]], str | None]:
        """Channel members with USER/AGENT identity; keyset by (joined_at ASC, subject_id ASC)."""
        await self.get_by_id(user_id, organization_id, channel_id)

        base_query = (
            select(ChatChannelMember, User, Agent)
            .outerjoin(
                User,
                (User.id == ChatChannelMember.subject_id)
                & (ChatChannelMember.subject_type == SubjectType.USER),
            )
            .outerjoin(
                Agent,
                (Agent.id == ChatChannelMember.subject_id)
                & (ChatChannelMember.subject_type == SubjectType.AGENT),
            )
            .where(ChatChannelMember.channel_id == channel_id)
            .order_by(
                ChatChannelMember.joined_at.asc(),
                ChatChannelMember.subject_id.asc(),
            )
        )

        if cursor:
            payload = decode_cursor(cursor)
            try:
                cursor_joined = datetime.fromisoformat(payload["joined_at"])
                cursor_sid = UUID(payload["subject_id"])
            except (KeyError, TypeError, ValueError) as exc:
                raise ValidationError("cursor", "Invalid pagination cursor") from exc
            base_query = base_query.where(
                or_(
                    ChatChannelMember.joined_at > cursor_joined,
                    and_(
                        ChatChannelMember.joined_at == cursor_joined,
                        ChatChannelMember.subject_id > cursor_sid,
                    ),
                )
            )

        page_size = clamp_page_size(limit)
        result = await self.session.execute(base_query.limit(page_size + 1))
        rows = list(result.all())
        next_cursor: str | None = None
        if len(rows) > page_size:
            rows = rows[:page_size]
            last_member, _, _ = rows[-1]
            next_cursor = encode_cursor({
                "joined_at": last_member.joined_at.isoformat(),
                "subject_id": str(last_member.subject_id),
            })
        return rows, next_cursor
