"""Chat channel operations with membership-based permission model.

Chat uses channel membership as the permission. The BaseContentOperations
``_require_*`` helpers are overridden to delegate to ``ChatAccessChecker``.
Channels do not participate in the generic access_mode / baseline_role
model -- channel_type (PUBLIC / PRIVATE / DIRECT / GROUP_DM) drives access.
"""

import base64
import json
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions import PermissionChecker, role_can_view
from uniffy.core.content.base_operations import BaseContentOperations
from uniffy.core.errors import (
    NotFoundError,
    PermissionDeniedError,
    ValidationError,
)
from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.agents.channel_binding import AgentChannelBinding
from uniffy.core.models.chat.channel import ChannelType, ChatChannel, ChatChannelStats
from uniffy.core.models.chat.channel_category import ChatChannelCategory
from uniffy.core.models.chat.channel_member import (
    ChannelRole,
    ChatChannelMember,
)
from uniffy.core.models.login.user import User
from uniffy.core.types import AccessMode, ContentType, SubjectType, generate_id, slugify
from uniffy.core.valkey.mentions import publish_mention_state
from uniffy.domains.chat.access import ChatAccessChecker
from uniffy.domains.chat.cache import (
    fetch_channel_members,
    invalidate_cached_channel,
    invalidate_cached_dm_peers,
    invalidate_cached_member_ids,
)
from uniffy.domains.chat.sender_resolver import SenderResolver
from uniffy.domains.chat.subjects import ChatSubject

DEFAULT_PAGE_SIZE = 200
MAX_PAGE_SIZE = 500


def _encode_cursor(payload: dict[str, Any]) -> str:
    """Opaque base64-url-encoded JSON cursor."""
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _decode_cursor(cursor: str) -> dict[str, Any]:
    """Decode an opaque cursor into its payload dict.

    Raises ValidationError on malformed input -- callers should let it
    bubble up to the handler so the client sees INVALID_ARGUMENT.
    """
    try:
        padding = "=" * (-len(cursor) % 4)
        raw = base64.urlsafe_b64decode(cursor + padding)
        return json.loads(raw.decode("utf-8"))
    except (ValueError, json.JSONDecodeError) as exc:
        raise ValidationError("cursor", "Invalid pagination cursor") from exc


def _clamp_page_size(limit: int | None) -> int:
    """Apply default + max bounds for paginated list endpoints."""
    if limit is None or limit <= 0:
        return DEFAULT_PAGE_SIZE
    return min(limit, MAX_PAGE_SIZE)


class ChatChannelOperations(BaseContentOperations[ChatChannel]):
    """Channel CRUD with membership-based permission model.

    Channel membership is the permission: the standard
    ``_require_view / _require_edit / _require_delete`` helpers are
    overridden to delegate to :class:`ChatAccessChecker`.
    """

    content_type = ContentType.CHAT
    model_class = ChatChannel

    def __init__(self, session: AsyncSession, access: ChatAccessChecker | None = None) -> None:
        super().__init__(session)
        self.access = access or ChatAccessChecker(session)

    # Abstract method implementations (required by BaseContentOperations)

    def _build_search_keywords(self, model: ChatChannel) -> str:
        # Include both the auto-generated name and any custom override so renamed
        # agent chats remain findable by either label.
        if model.custom_name:
            return f"{model.custom_name} {model.name} {model.description}"
        return f"{model.name} {model.description}"

    def _get_search_title(self, model: ChatChannel) -> str:
        return model.effective_name

    def _get_url_path(self, model: ChatChannel) -> str:
        return f"/chat/{model.id}"

    def _get_search_description(self, model: ChatChannel) -> str | None:
        return model.description[:200] if model.description else None

    # Permission override - membership-based access

    async def _require_view(
        self,
        user_id: UUID,
        organization_id: UUID,
        content: ChatChannel,
    ) -> None:
        """Override: check channel membership instead of the generic role model."""
        await self.access.check_access(user_id, organization_id, content)

    async def _require_edit(
        self,
        user_id: UUID,
        organization_id: UUID,
        content: ChatChannel,
    ) -> None:
        """Override: channel admins/owners, org admins, or chat domain admins can edit."""
        if await self.access.is_org_admin(user_id, organization_id):
            return
        if await self.access.is_chat_domain_admin(user_id, organization_id):
            return
        member = await self.access.get_membership(content.id, user_id)
        if not member or member.role == ChannelRole.MEMBER:
            raise PermissionDeniedError("edit", "channel")

    async def _require_delete(
        self,
        user_id: UUID,
        organization_id: UUID,
        content: ChatChannel,
    ) -> None:
        """Override: only channel owner, org admin, or chat domain admin can delete."""
        if await self.access.is_org_admin(user_id, organization_id):
            return
        if await self.access.is_chat_domain_admin(user_id, organization_id):
            return
        member = await self.access.get_membership(content.id, user_id)
        if not member or member.role != ChannelRole.OWNER:
            raise PermissionDeniedError("delete", "channel")

    # Search index override - derive access from membership

    async def _index_for_search(
        self,
        model: ChatChannel,
        skip_member_lookup: bool = False,
    ) -> None:
        """Override: derive the search document access from membership.

        Public channels index as ``OPEN_TO_ORG``. Private channels index
        as ``EXPLICIT_MEMBERS`` with the channel member list attached.
        Group DMs and user-user DMs are excluded entirely (privacy).
        Named agent DMs are indexed as ``EXPLICIT_MEMBERS`` scoped to the
        single human owner so the user can search and ``@`` mention their
        renamed agent chats.

        Live-state fields (``channel_type``, ``member_count``) are written
        into the search document metadata so ``resolve_urns`` can serve
        mention chips with no database round-trip. Callers that change
        membership must re-invoke this method so the cached count stays
        truthful.
        """
        del skip_member_lookup  # membership is always the source of truth

        if model.channel_type == ChannelType.GROUP_DM:
            return
        if model.channel_type == ChannelType.DIRECT and not model.is_agent_dm:
            return

        if model.is_agent_dm:
            access_mode = AccessMode.EXPLICIT_MEMBERS.value
            shared_user_ids = [model.owner_id]
        elif model.channel_type == ChannelType.PUBLIC:
            access_mode = AccessMode.OPEN_TO_ORG.value
            shared_user_ids = None
        else:
            access_mode = AccessMode.EXPLICIT_MEMBERS.value
            member_ids = await self._get_all_member_ids(model.id)
            shared_user_ids = member_ids if member_ids else None

        stats_result = await self.session.execute(
            select(ChatChannelStats.member_count).where(
                ChatChannelStats.channel_id == model.id
            )
        )
        member_count = stats_result.scalar_one_or_none() or 0

        category_name = ""
        if model.category_id:
            cat_result = await self.session.execute(
                select(ChatChannelCategory.name).where(
                    ChatChannelCategory.id == model.category_id
                )
            )
            category_name = cat_result.scalar_one_or_none() or ""

        # Agent DMs surface as their own content type so the search UI can
        # filter / icon / colour them distinctly from regular channels.
        urn_type = ContentType.AGENT_CHAT if model.is_agent_dm else ContentType.CHAT
        entity_type = urn_type.value

        metadata = {
            "channel_type": model.channel_type.value,
            "member_count": str(member_count),
            "parent_label": category_name,
        }
        if model.is_agent_dm and model.agent_id is not None:
            metadata["agent_id"] = str(model.agent_id)

        await self.search_indexer.index(
            urn=f"urn:uniffy:content:{urn_type.value}:{model.id}",
            organization_id=model.organization_id,
            title=self._get_search_title(model),
            entity_type=entity_type,
            url_path=self._get_url_path(model),
            access_mode=access_mode,
            baseline_role=None,
            owner_id=model.owner_id,
            keywords=self._build_search_keywords(model),
            description=self._get_search_description(model),
            shared_user_ids=shared_user_ids,
            metadata=metadata,
        )

    async def _refresh_channel_live_state(self, channel: ChatChannel) -> None:
        """Re-index the channel and broadcast a mention-state change.

        Called from every mutation path (rename, description edit,
        join, leave, batch member add/remove) so the search document
        and visible mention chips reflect the new state without a
        page refresh. Publishes the full set of denormalized fields
        rather than diffing inputs -- the payload is small and
        diffing across all callers is fragile.
        """
        if channel.channel_type == ChannelType.GROUP_DM:
            return
        if channel.channel_type == ChannelType.DIRECT and not channel.is_agent_dm:
            return
        try:
            await self._index_for_search(channel)
        except Exception:
            logger.warning(f"Failed to re-index channel {channel.id} live state")
            return
        try:
            stats_result = await self.session.execute(
                select(ChatChannelStats.member_count).where(
                    ChatChannelStats.channel_id == channel.id
                )
            )
            member_count = stats_result.scalar_one_or_none() or 0

            category_name = ""
            if channel.category_id:
                cat_result = await self.session.execute(
                    select(ChatChannelCategory.name).where(
                        ChatChannelCategory.id == channel.category_id
                    )
                )
                category_name = cat_result.scalar_one_or_none() or ""

            urn_type = ContentType.AGENT_CHAT if channel.is_agent_dm else ContentType.CHAT
            await publish_mention_state(
                organization_id=channel.organization_id,
                urn=f"urn:uniffy:content:{urn_type.value}:{channel.id}",
                changes={
                    "title": channel.effective_name,
                    "description": channel.description or "",
                    "member_count": str(member_count),
                    "channel_type": channel.channel_type.value,
                    "parent_label": category_name,
                },
            )
        except Exception:
            logger.warning(f"Failed to publish mention state for channel {channel.id}")

    # Channel CRUD

    async def create_channel(
        self,
        user_id: UUID,
        organization_id: UUID,
        name: str,
        channel_type: ChannelType,
        description: str = "",
        icon: str = "",
        is_default: bool = False,
        category_id: UUID | None = None,
        member_ids: list[UUID] | None = None,
    ) -> ChatChannel:
        """Create a channel with stats row and initial membership."""
        slug = slugify(name)

        # Check slug uniqueness
        existing = await self.session.execute(
            select(ChatChannel.id).where(
                ChatChannel.organization_id == organization_id,
                ChatChannel.slug == slug,
                ChatChannel.is_deleted == False,  # noqa: E712
            )
        )
        if existing.scalar_one_or_none():
            slug = f"{slug}-{str(UUID(int=0))[:8]}"

        channel = ChatChannel(
            organization_id=organization_id,
            owner_id=user_id,
            name=name,
            slug=slug,
            description=description,
            channel_type=channel_type,
            icon=icon,
            is_default=is_default,
            category_id=category_id,
        )
        self.session.add(channel)
        await self.session.flush()

        # Create stats row
        stats = ChatChannelStats(channel_id=channel.id, member_count=1)
        self.session.add(stats)

        # Add creator as OWNER
        creator_member = ChatChannelMember(
            channel_id=channel.id,
            subject_type=SubjectType.USER,
            subject_id=user_id,
            user_id=user_id,
            role=ChannelRole.OWNER,
        )
        self.session.add(creator_member)

        # Add additional members for DM/GROUP_DM
        if member_ids:
            count = 1
            for mid in member_ids:
                if mid != user_id:
                    m = ChatChannelMember(
                        channel_id=channel.id,
                        subject_type=SubjectType.USER,
                        subject_id=mid,
                        user_id=mid,
                        role=ChannelRole.MEMBER,
                    )
                    self.session.add(m)
                    count += 1
            stats.member_count = count

        await self.session.commit()
        await self.session.refresh(channel)

        # Index for search (post-commit)
        try:
            await self._index_for_search(channel)
        except Exception:
            logger.warning(f"Failed to index channel {channel.id}")

        return channel

    async def create_dm(
        self,
        user_id: UUID,
        organization_id: UUID,
        target_user_ids: list[UUID],
    ) -> ChatChannel:
        """Create or find existing DM/GROUP_DM.

        For 1:1 DMs, finds existing conversation between the two users.
        For group DMs (3+ participants), always creates a new conversation.
        """
        all_user_ids = sorted(set([user_id] + target_user_ids))

        if len(all_user_ids) < 2:
            raise ValidationError("members", "DM requires at least 2 participants")
        if len(all_user_ids) > 8:
            raise ValidationError("members", "Group DMs support up to 8 participants")

        is_direct = len(all_user_ids) == 2
        channel_type = ChannelType.DIRECT if is_direct else ChannelType.GROUP_DM

        # For 1:1 DMs, check if one already exists
        if is_direct:
            existing = await self._find_existing_dm(
                organization_id, all_user_ids[0], all_user_ids[1]
            )
            if existing:
                return existing

        # Build name from ALL participant display names (frontend strips current user)
        name = await self._build_dm_name(all_user_ids)

        return await self.create_channel(
            user_id=user_id,
            organization_id=organization_id,
            name=name,
            channel_type=channel_type,
            member_ids=target_user_ids,
        )

    async def list_user_channels(
        self,
        user_id: UUID,
        organization_id: UUID,
        *,
        cursor: str | None = None,
        limit: int = DEFAULT_PAGE_SIZE,
    ) -> tuple[list[tuple[ChatChannel, ChatChannelStats, ChannelRole]], str | None]:
        """List channels the user is a member of (sidebar query).

        Keyset-paginated by ``(coalesce(last_root_message_at, epoch) DESC,
        channel_id ASC)``. Callers loop on ``next_cursor`` until ``None``.

        Cursor payload: ``{"sort_ts": ISO8601, "channel_id": UUID}``.
        Treats NULL ``last_root_message_at`` as the epoch so DESC NULLS LAST
        ordering composes deterministically with tuple comparison.
        """
        epoch_ts = datetime(1, 1, 1, tzinfo=UTC)
        sort_ts = func.coalesce(ChatChannelStats.last_root_message_at, epoch_ts)

        base_query = (
            select(ChatChannel, ChatChannelStats, ChatChannelMember.role)
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

        if cursor:
            payload = _decode_cursor(cursor)
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

        page_size = _clamp_page_size(limit)
        result = await self.session.execute(base_query.limit(page_size + 1))
        rows = list(result.all())
        next_cursor: str | None = None
        if len(rows) > page_size:
            rows = rows[:page_size]
            last_channel, last_stats, _ = rows[-1]
            last_ts = last_stats.last_root_message_at or epoch_ts
            next_cursor = _encode_cursor(
                {"sort_ts": last_ts.isoformat(), "channel_id": str(last_channel.id)}
            )
        return rows, next_cursor

    async def list_user_channel_ids(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> list[UUID]:
        """Return every active channel ID the user is a member of.

        Lightweight ID-only fetch for internal fan-out callers (unread-count
        aggregation) that need the full set without the cost of hydrating
        ChatChannel + ChatChannelStats rows. Same visibility filter as
        ``list_user_channels`` (excludes deleted + archived).
        """
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
        organization_id: UUID,
        *,
        cursor: str | None = None,
        limit: int = DEFAULT_PAGE_SIZE,
    ) -> tuple[list[tuple[ChatChannel, ChatChannelStats]], str | None]:
        """List all public channels for browse view.

        Sorted by ``(member_count DESC, channel_id ASC)`` for a stable
        cursor. Cursor payload: ``{"member_count": int, "channel_id": UUID}``.
        """
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

        if cursor:
            payload = _decode_cursor(cursor)
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

        page_size = _clamp_page_size(limit)
        result = await self.session.execute(base_query.limit(page_size + 1))
        rows = list(result.all())
        next_cursor: str | None = None
        if len(rows) > page_size:
            rows = rows[:page_size]
            last_channel, last_stats = rows[-1]
            next_cursor = _encode_cursor(
                {
                    "member_count": last_stats.member_count,
                    "channel_id": str(last_channel.id),
                }
            )
        return rows, next_cursor

    async def update(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        *,
        name: str | None = None,
        description: str | None = None,
        icon: str | None = None,
        is_default: bool | None = None,
    ) -> ChatChannel:
        """Update channel metadata. Requires elevated channel permission.

        Only kwargs that are not ``None`` are applied; passing ``None`` for
        a field leaves the existing value untouched. Renaming does NOT
        regenerate the slug -- the slug is created at insert time and is
        treated as a stable handle, not a derived field.

        Drops the cached channel row after commit so the next read picks
        up the new metadata. The cached member-id list mirrors only
        membership state (no name / description / icon / is_default), so
        it is intentionally NOT invalidated here.
        """
        channel = await self.get_by_id(user_id, organization_id, channel_id)
        is_elevated = await self.access.require_elevated(
            user_id,
            organization_id,
            channel_id,
        )
        if not is_elevated:
            raise PermissionDeniedError("update", "channel")

        if name is not None:
            channel.name = name
        if description is not None:
            channel.description = description
        if icon is not None:
            channel.icon = icon
        if is_default is not None:
            channel.is_default = is_default

        channel.updated_at = datetime.now(UTC)
        await self.session.commit()
        await self.session.refresh(channel)

        await invalidate_cached_channel(channel.id)

        # Re-index every channel type (including PUBLIC) so the search
        # document reflects the new name / description / icon, then
        # broadcast a mention-state change so visible chips update
        # without a refresh.
        await self._refresh_channel_live_state(channel)

        return channel

    async def archive_channel(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
    ) -> None:
        """Archive a channel (read-only)."""
        channel = await self.get_by_id(user_id, organization_id, channel_id)
        await self._require_delete(user_id, organization_id, channel)

        if channel.is_default:
            raise ValidationError("channel", "Cannot archive a default channel")

        channel.is_archived = True
        channel.updated_at = datetime.now(UTC)
        await self.session.commit()

        await invalidate_cached_channel(channel.id)

        await self._broadcast_channel_removed(channel)

    async def delete_channel(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
    ) -> None:
        """Soft-delete a channel."""
        channel = await self.get_by_id(user_id, organization_id, channel_id)
        await self._require_delete(user_id, organization_id, channel)

        if channel.is_default:
            raise ValidationError("channel", "Cannot delete a default channel")

        now = datetime.now(UTC)
        channel.is_deleted = True
        channel.deleted_at = now
        channel.updated_at = now
        await self.session.commit()

        await invalidate_cached_channel(channel.id)
        await invalidate_cached_member_ids(channel.id)
        await invalidate_cached_dm_peers(channel.id)

        await self._broadcast_channel_removed(channel)

        try:
            from uniffy.core.search.indexer import SearchIndexer

            indexer = SearchIndexer(self.session)
            urn = f"urn:uniffy:content:CHAT:{channel.id}"
            await indexer.remove(urn)
            # Cascade: drop every chat_message indexed under this channel
            # so global search stops returning content from a deleted
            # channel. ``metadata.channel_id`` is filterable.
            await indexer.remove_by_filter(
                f'entity_type = "chat_message" AND metadata.channel_id = "{channel.id}"'
            )
        except Exception:
            logger.warning(f"Search remove failed for channel {channel.id}")

    async def _broadcast_channel_removed(
        self,
        channel: ChatChannel,
    ) -> None:
        """Notify all channel members that the channel was archived or deleted."""
        try:
            from uniffy.domains.chat.streaming.events import CHANNEL_UPDATED
            from uniffy.domains.chat.streaming.publisher import (
                publish_channel_event_to_members,
            )

            member_ids = await self._get_all_member_ids(channel.id)
            payload = {
                "channel_id": str(channel.id),
                "is_archived": channel.is_archived,
                "is_deleted": channel.is_deleted,
            }
            await publish_channel_event_to_members(
                member_ids,
                CHANNEL_UPDATED,
                payload,
                channel_id=channel.id,
            )
        except Exception:
            logger.warning(f"Failed to broadcast channel removal for {channel.id}")

    async def join_channel(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
    ) -> ChatChannel:
        """Self-join a PUBLIC channel."""
        channel = await self._fetch_by_id(channel_id, organization_id)
        if not channel:
            raise NotFoundError("channel", channel_id)

        if channel.channel_type != ChannelType.PUBLIC:
            raise PermissionDeniedError("join", "channel")

        existing = await self.access.get_membership(channel_id, user_id)
        if existing:
            return channel

        member = ChatChannelMember(
            channel_id=channel_id,
            subject_type=SubjectType.USER,
            subject_id=user_id,
            user_id=user_id,
            role=ChannelRole.MEMBER,
        )
        self.session.add(member)

        await self.session.execute(
            update(ChatChannelStats)
            .where(ChatChannelStats.channel_id == channel_id)
            .values(member_count=ChatChannelStats.member_count + 1)
        )
        await self.session.commit()
        self.access.invalidate_membership(channel_id, user_id)
        await invalidate_cached_member_ids(channel_id)

        # Publish MEMBER_JOINED event to existing members
        await self._publish_member_event(channel_id, user_id, joined=True)

        # Post a system message announcing the join
        await self._post_join_system_message(user_id, organization_id, channel)

        # Refresh search-index member_count and notify visible mention chips
        await self._refresh_channel_live_state(channel)

        return channel

    async def join_default_channels(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> None:
        """Auto-join a user to all default channels in an organization."""
        result = await self.session.execute(
            select(ChatChannel).where(
                ChatChannel.organization_id == organization_id,
                ChatChannel.is_default.is_(True),
                ChatChannel.is_deleted.is_(False),
            )
        )
        default_channels = result.scalars().all()

        for channel in default_channels:
            existing = await self.access.get_membership(channel.id, user_id)
            if existing:
                continue

            member = ChatChannelMember(
                channel_id=channel.id,
                subject_type=SubjectType.USER,
                subject_id=user_id,
                user_id=user_id,
                role=ChannelRole.MEMBER,
            )
            self.session.add(member)

            await self.session.execute(
                update(ChatChannelStats)
                .where(ChatChannelStats.channel_id == channel.id)
                .values(member_count=ChatChannelStats.member_count + 1)
            )

    async def leave_channel(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
    ) -> None:
        """Leave a channel."""
        channel = await self._fetch_by_id(channel_id, organization_id)
        if not channel:
            raise NotFoundError("channel", channel_id)

        if channel.is_default:
            raise ValidationError("channel", "Cannot leave a default channel")
        if channel.channel_type == ChannelType.DIRECT:
            raise ValidationError("channel", "Cannot leave a direct message")

        member = await self.access.get_membership(channel_id, user_id)
        if not member:
            return

        await self.session.execute(
            delete(ChatChannelMember).where(
                ChatChannelMember.channel_id == channel_id,
                ChatChannelMember.user_id == user_id,
            )
        )
        await self.session.execute(
            update(ChatChannelStats)
            .where(ChatChannelStats.channel_id == channel_id)
            .values(member_count=ChatChannelStats.member_count - 1)
        )
        await self.session.commit()
        self.access.invalidate_membership(channel_id, user_id)
        await invalidate_cached_member_ids(channel_id)

        # Publish MEMBER_LEFT event to remaining members
        await self._publish_member_event(channel_id, user_id, joined=False)

        # Refresh search-index member_count and notify visible mention chips
        await self._refresh_channel_live_state(channel)

    async def add_members(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        member_user_ids: list[UUID],
    ) -> list[ChatChannelMember]:
        """Add members to a channel. Requires admin/owner role.

        One ``INSERT ... VALUES (...) ON CONFLICT DO NOTHING RETURNING *``
        replaces the previous "SELECT existing + per-row session.add" loop.
        ON CONFLICT eats existing memberships and RETURNING tells us which
        rows actually inserted so we know who to publish MEMBER_JOINED for.
        """
        channel = await self.get_by_id(user_id, organization_id, channel_id)
        await self._require_edit(user_id, organization_id, channel)

        if channel.channel_type in (ChannelType.DIRECT, ChannelType.GROUP_DM):
            raise ValidationError("channel", "Cannot add members to DMs")

        if not member_user_ids:
            return []

        rows = [
            {
                "channel_id": channel_id,
                "subject_type": SubjectType.USER,
                "subject_id": mid,
                "user_id": mid,
                "role": ChannelRole.MEMBER,
            }
            for mid in member_user_ids
        ]

        stmt = (
            pg_insert(ChatChannelMember)
            .values(rows)
            .on_conflict_do_nothing(
                index_elements=["channel_id", "subject_type", "subject_id"]
            )
            .returning(ChatChannelMember)
        )
        result = await self.session.execute(stmt)
        added = list(result.scalars().all())

        if added:
            await self.session.execute(
                update(ChatChannelStats)
                .where(ChatChannelStats.channel_id == channel_id)
                .values(member_count=ChatChannelStats.member_count + len(added))
            )
            await self.session.commit()

            await invalidate_cached_member_ids(channel_id)

            await self._publish_members_changed(
                channel_id,
                [m.user_id for m in added if m.user_id is not None],
                added=True,
            )

            await self._refresh_channel_live_state(channel)

        return added

    async def remove_members(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        member_user_ids: list[UUID],
    ) -> None:
        """Remove members from a channel. Requires admin/owner role."""
        channel = await self.get_by_id(user_id, organization_id, channel_id)
        await self._require_edit(user_id, organization_id, channel)

        if channel.channel_type in (ChannelType.DIRECT, ChannelType.GROUP_DM):
            raise ValidationError("channel", "Cannot remove members from DMs")

        # Batch-fetch memberships to check roles
        members_result = await self.session.execute(
            select(ChatChannelMember).where(
                ChatChannelMember.channel_id == channel_id,
                ChatChannelMember.user_id.in_(member_user_ids),
            )
        )
        members = list(members_result.scalars().all())

        # Filter out owners (cannot be removed)
        removable_ids = [m.user_id for m in members if m.role != ChannelRole.OWNER]

        if removable_ids:
            await self.session.execute(
                delete(ChatChannelMember).where(
                    ChatChannelMember.channel_id == channel_id,
                    ChatChannelMember.user_id.in_(removable_ids),
                )
            )
            await self.session.execute(
                update(ChatChannelStats)
                .where(ChatChannelStats.channel_id == channel_id)
                .values(member_count=ChatChannelStats.member_count - len(removable_ids))
            )
            await self.session.commit()

            await invalidate_cached_member_ids(channel_id)

            await self._publish_members_changed(
                channel_id, removable_ids, added=False
            )

            await self._refresh_channel_live_state(channel)

    async def get_members(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        *,
        cursor: str | None = None,
        limit: int = DEFAULT_PAGE_SIZE,
    ) -> tuple[list[tuple[ChatChannelMember, User | None, Agent | None]], str | None]:
        """Get channel members with USER or AGENT identity info.

        LEFT JOINs on both User and Agent via ``subject_id``, so USER rows
        carry a User, AGENT rows carry an Agent, and the caller decides
        how to project.

        Keyset-paginated by ``(joined_at ASC, subject_id ASC)``. Callers
        loop on ``next_cursor`` until ``None``.

        Cursor payload: ``{"joined_at": ISO8601, "subject_id": UUID}``.
        """
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
            payload = _decode_cursor(cursor)
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

        page_size = _clamp_page_size(limit)
        result = await self.session.execute(base_query.limit(page_size + 1))
        rows = list(result.all())
        next_cursor: str | None = None
        if len(rows) > page_size:
            rows = rows[:page_size]
            last_member, _, _ = rows[-1]
            next_cursor = _encode_cursor(
                {
                    "joined_at": last_member.joined_at.isoformat(),
                    "subject_id": str(last_member.subject_id),
                }
            )
        return rows, next_cursor

    _MUTED_UNTIL_UNSET = object()

    async def update_member(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        target_user_id: UUID,
        is_muted: bool | None = None,
        notification_level: str | None = None,
        muted_until: object = _MUTED_UNTIL_UNSET,
        follow_all_threads: bool | None = None,
        badge_all_messages: bool | None = None,
    ) -> tuple[ChatChannelMember, User]:
        """Update a channel member's preferences.

        Users can update their own membership. Channel admin/owner or org admin
        can update any member.

        Parameters
        ----------
        muted_until
            Sentinel-defaulted. Pass a datetime for timed mute, None to clear,
            or omit (sentinel) to leave unchanged.

        """
        from uniffy.core.models.chat.channel_member import ChatNotificationLevel

        await self.get_by_id(user_id, organization_id, channel_id)

        if user_id != target_user_id:
            is_elevated = await self.access.require_elevated(
                user_id,
                organization_id,
                channel_id,
            )
            if not is_elevated:
                raise PermissionDeniedError("update_member", "Can only update your own membership")

        result = await self.session.execute(
            select(ChatChannelMember).where(
                ChatChannelMember.channel_id == channel_id,
                ChatChannelMember.user_id == target_user_id,
            )
        )
        member = result.scalar_one_or_none()
        if not member:
            raise NotFoundError("channel_member", target_user_id)

        if is_muted is not None:
            member.is_muted = is_muted
            if not is_muted:
                member.muted_until = None

        if muted_until is not self._MUTED_UNTIL_UNSET:
            if muted_until is not None:
                member.is_muted = True
                member.muted_until = muted_until
            else:
                member.muted_until = None

        if notification_level is not None:
            member.notification_level = ChatNotificationLevel(notification_level)
        if follow_all_threads is not None:
            member.follow_all_threads = follow_all_threads
        if badge_all_messages is not None:
            member.badge_all_messages = badge_all_messages

        await self.session.commit()
        await self.session.refresh(member)

        user_result = await self.session.execute(select(User).where(User.id == target_user_id))
        user = user_result.scalar_one()
        return member, user

    async def require_send(
        self,
        user_id: UUID,
        channel: ChatChannel,
    ) -> ChatChannelMember:
        """Verify user can send messages. Returns membership for role checks."""
        return await self.access.require_send(user_id, channel)

    # Internal helpers

    async def _publish_member_event(
        self,
        channel_id: UUID,
        member_user_id: UUID,
        *,
        joined: bool,
        member_ids: list[UUID] | None = None,
    ) -> None:
        """Publish a MEMBER_JOINED or MEMBER_LEFT event for ONE user.

        Used for self-join and leave only. Batch admin add/remove flows go
        through ``_publish_members_changed`` so a 50-user invite costs one
        Valkey fan-out, not 50.

        ``member_ids`` may be passed by callers that already fetched the
        list to avoid the extra round-trip; otherwise we fetch once.
        """
        try:
            from uniffy.domains.chat.streaming.events import (
                MEMBER_JOINED,
                MEMBER_LEFT,
                build_member_payload,
            )
            from uniffy.domains.chat.streaming.publisher import (
                publish_channel_event_to_members,
            )

            user = await self.session.get(User, member_user_id)
            display_name = user.full_name if user else ""

            recipients = (
                member_ids
                if member_ids is not None
                else await self._get_all_member_ids(channel_id)
            )
            await publish_channel_event_to_members(
                recipients,
                MEMBER_JOINED if joined else MEMBER_LEFT,
                build_member_payload(
                    user_id=member_user_id,
                    display_name=display_name,
                    role="MEMBER",
                ),
                channel_id=channel_id,
            )
        except Exception as exc:
            logger.warning(f"Failed to publish member event for channel {channel_id}: {exc}")

    async def _publish_members_changed(
        self,
        channel_id: UUID,
        affected_user_ids: list[UUID],
        *,
        added: bool,
    ) -> None:
        """Publish a single batched MEMBERS_ADDED / MEMBERS_REMOVED event.

        One ``_get_all_member_ids`` round-trip + one pipelined fan-out
        replaces the previous per-affected-user loop that re-fetched the
        channel member list every iteration.
        """
        if not affected_user_ids:
            return
        try:
            from uniffy.domains.chat.streaming.events import (
                MEMBERS_ADDED,
                MEMBERS_REMOVED,
                build_members_changed_payload,
            )
            from uniffy.domains.chat.streaming.publisher import (
                publish_channel_event_to_members,
            )

            recipients = await self._get_all_member_ids(channel_id)
            await publish_channel_event_to_members(
                recipients,
                MEMBERS_ADDED if added else MEMBERS_REMOVED,
                build_members_changed_payload(affected_user_ids),
                channel_id=channel_id,
            )
        except Exception as exc:
            logger.warning(
                f"Failed to publish members-changed event for channel {channel_id}: {exc}"
            )

    async def _get_all_member_ids(self, channel_id: UUID) -> list[UUID]:
        """Get all member user IDs for a channel via the member-id cache.

        Returns user ids of every member row (USER + AGENT). AGENT rows
        whose ``user_id`` is NULL are dropped so callers never publish
        events to a missing user.
        """
        members = await fetch_channel_members(self.session, channel_id)
        ids: list[UUID] = []
        for member in members:
            uid = member.get("user_id")
            if not uid:
                continue
            try:
                ids.append(UUID(uid))
            except ValueError:
                continue
        return ids

    async def _find_existing_dm(
        self,
        organization_id: UUID,
        user_a: UUID,
        user_b: UUID,
    ) -> ChatChannel | None:
        """Find an existing DM between two users using a double-JOIN."""
        from sqlalchemy.orm import aliased

        m1 = aliased(ChatChannelMember)
        m2 = aliased(ChatChannelMember)

        result = await self.session.execute(
            select(ChatChannel)
            .join(m1, (m1.channel_id == ChatChannel.id) & (m1.user_id == user_a))
            .join(m2, (m2.channel_id == ChatChannel.id) & (m2.user_id == user_b))
            .where(
                ChatChannel.organization_id == organization_id,
                ChatChannel.channel_type == ChannelType.DIRECT,
                ChatChannel.is_deleted == False,  # noqa: E712
            )
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def _build_dm_name(self, user_ids: list[UUID]) -> str:
        """Legacy USER-only DM name. Delegates to subject-aware builder."""
        return await self._build_dm_name_from_subjects([ChatSubject.user(uid) for uid in user_ids])

    async def _build_dm_name_from_subjects(self, subjects: list[ChatSubject]) -> str:
        """Build DM name for mixed USER + AGENT participants.

        Routes through SenderResolver so agents pick up their display names
        instead of falling back to "Unknown". The proto-exposed SubjectType
        maps 1:1 to SenderType here (both are USER or AGENT at this boundary).
        """
        from uniffy.core.models.chat.message import SenderType

        resolver = SenderResolver(self.session)
        refs = [
            (
                SenderType.USER if s.subject_type == SubjectType.USER else SenderType.AGENT,
                s.subject_id,
            )
            for s in subjects
        ]
        resolved = await resolver.resolve_many(refs)
        names = [
            resolved[s.subject_id].display_name if s.subject_id in resolved else "Unknown"
            for s in subjects
        ]
        if len(names) <= 3:
            return ", ".join(names)
        return f"{', '.join(names[:2])}, and {len(names) - 2} others"

    async def _find_existing_dm_by_subjects(
        self,
        organization_id: UUID,
        a: ChatSubject,
        b: ChatSubject,
    ) -> ChatChannel | None:
        """Find an existing DIRECT channel between two polymorphic subjects.

        Joins `chat_channel_members` twice on `(subject_type, subject_id)` so
        the lookup works for (USER, USER), (USER, AGENT), or any pair. Hits
        the polymorphic PK index directly.
        """
        from sqlalchemy.orm import aliased

        m1 = aliased(ChatChannelMember)
        m2 = aliased(ChatChannelMember)

        result = await self.session.execute(
            select(ChatChannel)
            .join(
                m1,
                (m1.channel_id == ChatChannel.id)
                & (m1.subject_type == a.subject_type)
                & (m1.subject_id == a.subject_id),
            )
            .join(
                m2,
                (m2.channel_id == ChatChannel.id)
                & (m2.subject_type == b.subject_type)
                & (m2.subject_id == b.subject_id),
            )
            .where(
                ChatChannel.organization_id == organization_id,
                ChatChannel.channel_type == ChannelType.DIRECT,
                ChatChannel.is_deleted == False,  # noqa: E712
            )
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def _require_agent_usable(
        self,
        user_id: UUID,
        organization_id: UUID,
        agent_id: UUID,
    ) -> None:
        """Gate: the actor must have VIEWER+ on the agent to add it to a channel.

        Distinct from the channel MANAGE check handled by `_require_edit`;
        this second gate enforces D4 ("actor has MANAGE on channel AND USE
        on the agent"). Raises NotFoundError if the agent doesn't exist and
        PermissionDeniedError if the actor lacks VIEWER role.
        """
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
        """Insert default `AgentChannelBinding` rows for new AGENT members.

        Idempotent via the `(channel_id, agent_id)` unique constraint -- safe to
        call on every AGENT membership write. The binding holds per-channel
        context state (`last_compacted_at`, `last_active_token_estimate`,
        `manual_reset_at`) consumed by the chat context bar (Phase 8d) and the
        runtime's `load_context_messages` filter (Phase 8c). `actor_user_id` is
        the channel owner / inviting user; the FK requires a real user.
        """
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

    def _build_member_row(
        self,
        channel_id: UUID,
        subject: ChatSubject,
        role: ChannelRole,
    ) -> ChatChannelMember:
        """Build a member row; mirrors user_id for USER subjects, NULL for AGENT.

        `user_id` remains populated during the transition period (see 0c) so
        the 15 legacy queries that filter by `user_id` keep returning USER
        rows unchanged. Agent rows set user_id to NULL.
        """
        return ChatChannelMember(
            channel_id=channel_id,
            subject_type=subject.subject_type,
            subject_id=subject.subject_id,
            user_id=(subject.subject_id if subject.subject_type == SubjectType.USER else None),
            role=role,
        )

    async def create_dm_with_subjects(
        self,
        user_id: UUID,
        organization_id: UUID,
        subjects: list[ChatSubject],
    ) -> ChatChannel:
        """Create / find a DM across mixed USER + AGENT subjects.

        `user_id` is the actor (always a USER) and becomes the channel OWNER.
        `subjects` must include the actor as a USER subject; additional
        subjects may be USER or AGENT. Dedup for 1:1 DMs is by sorted subject
        tuple, so repeat opens of the same (user, agent) pair return the
        same channel.
        """
        actor_subject = ChatSubject.user(user_id)
        dedup = {s.as_key: s for s in subjects}
        dedup[actor_subject.as_key] = actor_subject
        participants = sorted(dedup.values(), key=lambda s: s.as_key)

        if len(participants) < 2:
            raise ValidationError("members", "DM requires at least 2 participants")
        if len(participants) > 8:
            raise ValidationError("members", "Group DMs support up to 8 participants")

        is_direct = len(participants) == 2
        channel_type = ChannelType.DIRECT if is_direct else ChannelType.GROUP_DM

        if is_direct:
            existing = await self._find_existing_dm_by_subjects(
                organization_id, participants[0], participants[1]
            )
            if existing:
                return existing

        for s in participants:
            if s.subject_type == SubjectType.AGENT:
                await self._require_agent_usable(user_id, organization_id, s.subject_id)

        name = await self._build_dm_name_from_subjects(participants)
        slug = slugify(name)

        existing = await self.session.execute(
            select(ChatChannel.id).where(
                ChatChannel.organization_id == organization_id,
                ChatChannel.slug == slug,
                ChatChannel.is_deleted == False,  # noqa: E712
            )
        )
        if existing.scalar_one_or_none():
            slug = f"{slug}-{str(UUID(int=0))[:8]}"

        agent_subjects = [s for s in participants if s.subject_type == SubjectType.AGENT]
        is_agent_dm = is_direct and len(agent_subjects) == 1
        bound_agent_id = agent_subjects[0].subject_id if is_agent_dm else None

        channel = ChatChannel(
            organization_id=organization_id,
            owner_id=user_id,
            name=name,
            slug=slug,
            description="",
            channel_type=channel_type,
            is_agent_dm=is_agent_dm,
            agent_id=bound_agent_id,
        )
        self.session.add(channel)
        await self.session.flush()

        self.session.add(ChatChannelStats(channel_id=channel.id, member_count=len(participants)))

        for s in participants:
            role = ChannelRole.OWNER if s == actor_subject else ChannelRole.MEMBER
            self.session.add(self._build_member_row(channel.id, s, role))

        await self._ensure_agent_bindings(
            channel.id,
            [s.subject_id for s in participants if s.subject_type == SubjectType.AGENT],
            actor_user_id=user_id,
        )

        await self.session.commit()
        await self.session.refresh(channel)
        return channel

    async def create_agent_chat(
        self,
        user_id: UUID,
        organization_id: UUID,
        agent_id: UUID,
        custom_name: str | None = None,
    ) -> ChatChannel:
        """Create a new named chat between the user and an agent.

        Always creates a new channel; multiple chats per (user, agent) pair
        are allowed. The actor is recorded as the channel OWNER, the agent is
        added as a MEMBER, and an ``AgentChannelBinding`` row is created so
        the runtime context-window pipeline can attach to the channel.

        ``custom_name`` is optional. When unset the channel uses the agent's
        display name; if the user already has chats with this agent, the
        default name is suffixed with " (N)" so it remains scannable in the
        sidebar.
        """
        await self._require_agent_usable(user_id, organization_id, agent_id)

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

        slug = f"{slugify(default_name)}-{str(generate_id())[:8]}"

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

        return channel

    async def rename_agent_chat(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        custom_name: str | None,
    ) -> ChatChannel:
        """Set or clear the user's custom display name for an agent chat.

        Only the human member of the chat can rename it -- domain admins do
        not bypass this gate, since the name is a personal label on a
        personal conversation. ``custom_name`` may be ``None`` or whitespace
        only to clear the override; the auto-generated ``name`` stays
        untouched in either direction so resetting always restores the
        original label.
        """
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

        await invalidate_cached_channel(channel.id)

        await self._refresh_channel_live_state(channel)

        return channel

    async def backfill_agent_chat_search_index(
        self,
        organization_id: UUID,
    ) -> int:
        """Re-index every active agent chat in an organization.

        One-shot helper for backfilling the search index after the named-agent-
        chat feature shipped. Drops any legacy ``urn:uniffy:content:CHAT:{id}``
        entry the chat used to share with regular channels before re-indexing
        under the new ``AGENT_CHAT`` URN namespace, so the index doesn't carry
        duplicate documents pointing at the same chat.

        Idempotent -- safe to run repeatedly. Returns the number of channels
        indexed.
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
        """List the user's agent chats, optionally filtered by ``agent_id``.

        Same keyset shape as ``list_user_channels`` (sorted by last activity
        DESC, channel id ASC) but restricted to channels where the caller is
        the human member AND ``is_agent_dm`` is true.
        """
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
            payload = _decode_cursor(cursor)
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

        page_size = _clamp_page_size(limit)
        result = await self.session.execute(base_query.limit(page_size + 1))
        rows = list(result.all())
        next_cursor: str | None = None
        if len(rows) > page_size:
            rows = rows[:page_size]
            last_channel, last_stats = rows[-1]
            last_ts = last_stats.last_root_message_at or epoch_ts
            next_cursor = _encode_cursor(
                {"sort_ts": last_ts.isoformat(), "channel_id": str(last_channel.id)}
            )
        return rows, next_cursor

    async def add_members_with_subjects(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        subjects: list[ChatSubject],
    ) -> list[ChatChannelMember]:
        """Add USER or AGENT members. Actor requires channel MANAGE for all;
        AGENT subjects additionally require actor VIEWER+ on the agent.

        Single batched ``INSERT ... ON CONFLICT DO NOTHING RETURNING *`` so
        we don't pay one round-trip per subject.
        """
        channel = await self.get_by_id(user_id, organization_id, channel_id)
        await self._require_edit(user_id, organization_id, channel)

        if channel.channel_type in (ChannelType.DIRECT, ChannelType.GROUP_DM):
            raise ValidationError("channel", "Cannot add members to DMs")

        for s in subjects:
            if s.subject_type == SubjectType.AGENT:
                await self._require_agent_usable(user_id, organization_id, s.subject_id)

        if not subjects:
            return []

        rows = [
            {
                "channel_id": channel_id,
                "subject_type": s.subject_type,
                "subject_id": s.subject_id,
                "user_id": (
                    s.subject_id if s.subject_type == SubjectType.USER else None
                ),
                "role": ChannelRole.MEMBER,
            }
            for s in subjects
        ]
        stmt = (
            pg_insert(ChatChannelMember)
            .values(rows)
            .on_conflict_do_nothing(
                index_elements=["channel_id", "subject_type", "subject_id"]
            )
            .returning(ChatChannelMember)
        )
        result = await self.session.execute(stmt)
        added = list(result.scalars().all())

        if added:
            await self.session.execute(
                update(ChatChannelStats)
                .where(ChatChannelStats.channel_id == channel_id)
                .values(member_count=ChatChannelStats.member_count + len(added))
            )
            await self._ensure_agent_bindings(
                channel_id,
                [m.subject_id for m in added if m.subject_type == SubjectType.AGENT],
                actor_user_id=user_id,
            )
            await self.session.commit()

            await invalidate_cached_member_ids(channel_id)

            await self._publish_members_changed(
                channel_id,
                [
                    m.user_id
                    for m in added
                    if m.subject_type == SubjectType.USER and m.user_id is not None
                ],
                added=True,
            )

            await self._refresh_channel_live_state(channel)

        return added

    async def remove_members_with_subjects(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        subjects: list[ChatSubject],
    ) -> None:
        """Remove USER or AGENT members. Actor requires channel MANAGE.

        Owners can never be removed (parity with the user-only path). Agents
        don't hold OWNER role in practice but the filter handles both.
        """
        channel = await self.get_by_id(user_id, organization_id, channel_id)
        await self._require_edit(user_id, organization_id, channel)

        if channel.channel_type in (ChannelType.DIRECT, ChannelType.GROUP_DM):
            raise ValidationError("channel", "Cannot remove members from DMs")

        members_result = await self.session.execute(
            select(ChatChannelMember).where(
                ChatChannelMember.channel_id == channel_id,
                ChatChannelMember.subject_id.in_([s.subject_id for s in subjects]),
            )
        )
        members = list(members_result.scalars().all())
        removable = [(m.subject_type, m.subject_id) for m in members if m.role != ChannelRole.OWNER]

        if removable:
            from sqlalchemy import tuple_ as sa_tuple

            await self.session.execute(
                delete(ChatChannelMember).where(
                    ChatChannelMember.channel_id == channel_id,
                    sa_tuple(
                        ChatChannelMember.subject_type,
                        ChatChannelMember.subject_id,
                    ).in_([(t, i) for (t, i) in removable]),
                )
            )
            await self.session.execute(
                update(ChatChannelStats)
                .where(ChatChannelStats.channel_id == channel_id)
                .values(member_count=ChatChannelStats.member_count - len(removable))
            )
            await self.session.commit()

            await invalidate_cached_member_ids(channel_id)

            await self._publish_members_changed(
                channel_id,
                [sid for (t, sid) in removable if t == SubjectType.USER],
                added=False,
            )

            await self._refresh_channel_live_state(channel)

    async def _post_join_system_message(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel: ChatChannel,
    ) -> None:
        """Post a system message when a user joins a channel."""
        try:
            from uniffy.core.models.chat.message import SenderType
            from uniffy.domains.chat.messages.operations import ChatMessageOperations

            user_result = await self.session.execute(
                select(User.full_name).where(User.id == user_id)
            )
            user_name = user_result.scalar_one_or_none() or "Someone"

            mention = f"[[[{user_name}|urn:uniffy:content:USER:{user_id}]]]"
            content = f"{mention} joined the channel"

            msg_ops = ChatMessageOperations(self.session)
            await msg_ops.send_message(
                user_id=user_id,
                organization_id=organization_id,
                channel_id=channel.id,
                content=content,
                sender_type=SenderType.SYSTEM,
            )
        except Exception:
            logger.warning(f"Failed to post join system message for {user_id}")
