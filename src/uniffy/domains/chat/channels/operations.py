"""Chat channel operations; access is membership-based, not access_mode/baseline_role."""

import base64
import json
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import String, and_, cast, delete, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.auth.permissions import (
    PermissionChecker,
    invalidate_visible_sets_for_user,
    role_can_view,
)
from uniffy.core.content.base_operations import BaseContentOperations
from uniffy.core.content.references import sanitize_mention_label
from uniffy.core.errors import (
    NotFoundError,
    PermissionDeniedError,
    ValidationError,
)
from uniffy.core.events.bus import emit_notification
from uniffy.core.events.types import NotificationEvent
from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.agents.channel_binding import AgentChannelBinding
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.calls import CallEndReason
from uniffy.core.models.chat.channel import ChannelType, ChatChannel, ChatChannelStats
from uniffy.core.models.chat.channel_category import ChatChannelCategory
from uniffy.core.models.chat.channel_member import (
    ChannelRole,
    ChatChannelMember,
)
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.login.user import User
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import (
    AccessMode,
    ContentType,
    NotificationType,
    SubjectType,
    generate_id,
    slugify,
)
from uniffy.core.valkey.mentions import publish_mention_state
from uniffy.domains.calls.operations import (
    end_active_call_for_channel,
    kick_user_from_active_call,
)
from uniffy.domains.chat.access import ChatAccessChecker
from uniffy.domains.chat.cache import (
    fetch_channel_members,
    invalidate_cached_channel,
    invalidate_cached_dm_peers,
    invalidate_cached_member_ids,
)
from uniffy.domains.chat.rate_limits import (
    CHANNEL_CREATE,
    MEMBER_ADD,
    check_chat_mutation_limit,
)
from uniffy.domains.chat.search_acl import (
    enqueue_chat_search_acl_refresh,
    record_chat_search_acl_refresh,
)
from uniffy.domains.chat.sender_resolver import SenderResolver
from uniffy.domains.chat.subjects import ChatSubject
from uniffy.domains.tags import TagAssignment, TagOperations

logger = logger.bind(component="chat.channels.operations")

DEFAULT_PAGE_SIZE = 200
MAX_PAGE_SIZE = 500
# Past this size a group chat must become a channel.
GROUP_DM_MAX_PARTICIPANTS = 4


def _encode_cursor(payload: dict[str, Any]) -> str:
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _decode_cursor(cursor: str) -> dict[str, Any]:
    """Decode an opaque cursor; raises ValidationError on malformed input."""
    try:
        padding = "=" * (-len(cursor) % 4)
        raw = base64.urlsafe_b64decode(cursor + padding)
        return json.loads(raw.decode("utf-8"))
    except (ValueError, json.JSONDecodeError) as exc:
        raise ValidationError("cursor", "Invalid pagination cursor") from exc


def _clamp_page_size(limit: int | None) -> int:
    if limit is None or limit <= 0:
        return DEFAULT_PAGE_SIZE
    return min(limit, MAX_PAGE_SIZE)


class ChatChannelOperations(BaseContentOperations[ChatChannel]):
    """Channel CRUD; permission gates delegate to ChatAccessChecker via _require_* overrides."""

    content_type = ContentType.CHAT
    model_class = ChatChannel

    def __init__(self, session: AsyncSession, access: ChatAccessChecker | None = None) -> None:
        super().__init__(session)
        self.access = access or ChatAccessChecker(session)

    def _build_search_keywords(self, model: ChatChannel) -> str:
        # Include both auto-name and custom override so renamed agent chats stay findable.
        if model.custom_name:
            return f"{model.custom_name} {model.name} {model.description}"
        return f"{model.name} {model.description}"

    def _get_search_title(self, model: ChatChannel) -> str:
        return model.effective_name

    def _get_url_path(self, model: ChatChannel) -> str:
        return f"/chat/{model.id}"

    def _get_search_description(self, model: ChatChannel) -> str | None:
        return model.description[:200] if model.description else None

    async def _get_search_tags_async(self, model: ChatChannel) -> list[str] | None:
        """Tag slug list for this channel; skipped for DM/agent-DM (no tags)."""
        if model.channel_type in (ChannelType.DIRECT, ChannelType.GROUP_DM):
            return None
        tag_ops = TagOperations(self.session)
        urn = build_content_urn(self.content_type, model.id)
        bulk = await tag_ops.get_for_urns(
            organization_id=model.organization_id,
            content_urns=[urn],
        )
        slugs = sorted({tag.slug for tag in bulk.get(urn, [])})
        return slugs or None

    def _tag_filter_subquery(self, tag_ids: list[UUID]):
        """Subquery returning channel ids carrying every tag in tag_ids (AND via HAVING COUNT)."""
        urn_prefix = "urn:uniffy:content:CHAT:"
        urn_expr = func.concat(urn_prefix, cast(ChatChannel.id, String))
        return (
            select(ChatChannel.id)
            .join(TagAssignment, TagAssignment.content_urn == urn_expr)
            .where(TagAssignment.tag_id.in_(tag_ids))
            .group_by(ChatChannel.id)
            .having(func.count(func.distinct(TagAssignment.tag_id)) == len(tag_ids))
        )

    async def _sync_channel_tags(
        self,
        *,
        actor_id: UUID,
        channel: ChatChannel,
        tag_ids: list[UUID] | None,
    ) -> None:
        # tag_ids=None leaves manual assignments untouched; DMs are skipped entirely.
        if tag_ids is None:
            return
        if channel.channel_type in (ChannelType.DIRECT, ChannelType.GROUP_DM):
            return
        tag_ops = TagOperations(self.session)
        await tag_ops.replace_manual_tags(
            actor_id=actor_id,
            organization_id=channel.organization_id,
            content_urn=build_content_urn(self.content_type, channel.id),
            tag_ids=tag_ids,
        )

    async def _require_view(
        self,
        user_id: UUID,
        organization_id: UUID,
        content: ChatChannel,
    ) -> None:
        await self.access.check_access(user_id, organization_id, content)

    async def _require_edit(
        self,
        user_id: UUID,
        organization_id: UUID,
        content: ChatChannel,
    ) -> None:
        """Channel admins/owners, org admins, or chat domain admins can edit."""
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
        """Only channel owner, org admin, or chat domain admin can delete."""
        if await self.access.is_org_admin(user_id, organization_id):
            return
        if await self.access.is_chat_domain_admin(user_id, organization_id):
            return
        member = await self.access.get_membership(content.id, user_id)
        if not member or member.role != ChannelRole.OWNER:
            raise PermissionDeniedError("delete", "channel")

    async def _index_for_search(
        self,
        model: ChatChannel,
        skip_member_lookup: bool = False,
    ) -> None:
        """Index PUBLIC as OPEN_TO_ORG, PRIVATE/agent-DM as EXPLICIT_MEMBERS; user DMs excluded."""
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
            select(ChatChannelStats.member_count).where(ChatChannelStats.channel_id == model.id)
        )
        member_count = stats_result.scalar_one_or_none() or 0

        category_name = ""
        if model.category_id:
            cat_result = await self.session.execute(
                select(ChatChannelCategory.name).where(ChatChannelCategory.id == model.category_id)
            )
            category_name = cat_result.scalar_one_or_none() or ""

        # Agent DMs use their own content type so search UI can filter/style them distinctly.
        urn_type = ContentType.AGENT_CHAT if model.is_agent_dm else ContentType.CHAT
        entity_type = urn_type.value

        metadata = {
            "channel_type": model.channel_type.value,
            "member_count": str(member_count),
            "parent_label": category_name,
        }
        if model.is_agent_dm and model.agent_id is not None:
            metadata["agent_id"] = str(model.agent_id)
            # Agent identity rides the doc so search rows render the same
            # avatar (emoji or name-keyed gradient) as the chat sidebar.
            agent_row = await self.session.execute(
                select(Agent.name, Agent.avatar_emoji).where(Agent.id == model.agent_id)
            )
            agent_identity = agent_row.first()
            if agent_identity:
                metadata["agent_name"] = agent_identity[0]
                if agent_identity[1]:
                    metadata["emoji"] = agent_identity[1]

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
        """Re-index the channel and broadcast a mention-state change so chips reflect new state."""
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
        tag_ids: list[UUID] | None = None,
    ) -> ChatChannel:
        """Create a channel with stats row and initial membership."""
        await self.access.require_org_member(user_id, organization_id)
        initial_member_ids = list(dict.fromkeys(member_ids or []))
        await self._require_active_user_subjects(organization_id, initial_member_ids)
        if category_id is not None:
            category = await self.session.execute(
                select(ChatChannelCategory.id).where(
                    ChatChannelCategory.id == category_id,
                    ChatChannelCategory.organization_id == organization_id,
                )
            )
            if category.scalar_one_or_none() is None:
                raise NotFoundError("category", category_id)
        await check_chat_mutation_limit(
            CHANNEL_CREATE,
            user_id=user_id,
            organization_id=organization_id,
        )
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

        stats = ChatChannelStats(channel_id=channel.id, member_count=1)
        self.session.add(stats)

        creator_member = ChatChannelMember(
            channel_id=channel.id,
            subject_type=SubjectType.USER,
            subject_id=user_id,
            user_id=user_id,
            role=ChannelRole.OWNER,
        )
        self.session.add(creator_member)

        if initial_member_ids:
            count = 1
            for mid in initial_member_ids:
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

        await write_audit_event(
            self.session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=Action.CHAT_CHANNEL_CREATED,
            resource_type=AuditResourceType.CHAT,
            resource_id=channel.id,
            details={
                "name": channel.name,
                "channel_type": channel_type.value,
                "is_default": is_default,
            },
        )

        await self.session.commit()
        await self.session.refresh(channel)

        await self._sync_channel_tags(
            actor_id=user_id,
            channel=channel,
            tag_ids=tag_ids,
        )

        try:
            await self._index_for_search(channel)
        except Exception:
            logger.warning(f"Failed to index channel {channel.id}")

        await self._publish_channel_created(channel.id)
        await self._notify_membership_changed(
            channel,
            actor_user_id=user_id,
            target_user_ids=[mid for mid in initial_member_ids if mid != user_id],
            added=True,
        )

        return channel

    async def create_dm(
        self,
        user_id: UUID,
        organization_id: UUID,
        target_user_ids: list[UUID],
    ) -> ChatChannel:
        """Create or find existing DM (1:1) / GROUP_DM (3+)."""
        await self.access.require_org_member(user_id, organization_id)
        await self._require_active_user_subjects(organization_id, target_user_ids)
        all_user_ids = sorted(set([user_id] + target_user_ids))

        if len(all_user_ids) < 2:
            raise ValidationError("members", "DM requires at least 2 participants")
        if len(all_user_ids) > GROUP_DM_MAX_PARTICIPANTS:
            raise ValidationError(
                "members",
                f"Group chats are limited to {GROUP_DM_MAX_PARTICIPANTS} people. "
                "Create a channel for a bigger group.",
            )

        is_direct = len(all_user_ids) == 2
        channel_type = ChannelType.DIRECT if is_direct else ChannelType.GROUP_DM

        if is_direct:
            existing = await self._find_existing_dm(
                organization_id, all_user_ids[0], all_user_ids[1]
            )
            if existing:
                return existing

        # Name carries ALL participant names; the frontend strips the current user.
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
            last_channel, last_stats, _, _ = rows[-1]
            last_ts = last_stats.last_root_message_at or epoch_ts
            next_cursor = _encode_cursor({
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
            next_cursor = _encode_cursor({
                "member_count": last_stats.member_count,
                "channel_id": str(last_channel.id),
            })
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
        tag_ids: list[UUID] | None = None,
    ) -> ChatChannel:
        """Update channel metadata; slug stays fixed, only non-None kwargs apply."""
        channel = await self.get_by_id(user_id, organization_id, channel_id)
        is_elevated = await self.access.require_elevated(
            user_id,
            organization_id,
            channel_id,
        )
        if not is_elevated:
            raise PermissionDeniedError("update", "channel")

        changed_keys: list[str] = []
        if name is not None and channel.name != name:
            channel.name = name
            changed_keys.append("name")
        if description is not None and channel.description != description:
            channel.description = description
            changed_keys.append("description")
        if icon is not None and channel.icon != icon:
            channel.icon = icon
            changed_keys.append("icon")
        if is_default is not None and channel.is_default != is_default:
            channel.is_default = is_default
            changed_keys.append("is_default")

        channel.updated_at = datetime.now(UTC)

        if changed_keys:
            await write_audit_event(
                self.session,
                organization_id=organization_id,
                actor_user_id=user_id,
                action=Action.CHAT_CHANNEL_UPDATED,
                resource_type=AuditResourceType.CHAT,
                resource_id=channel.id,
                details={"changed_keys": changed_keys},
            )

        await self.session.commit()
        await self.session.refresh(channel)

        await self._sync_channel_tags(
            actor_id=user_id,
            channel=channel,
            tag_ids=tag_ids,
        )

        await invalidate_cached_channel(channel.id)

        await self._refresh_channel_live_state(channel)
        await self._publish_channel_updated(channel)

        return channel

    async def convert_group_dm_to_channel(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        name: str,
        target_type: ChannelType = ChannelType.PRIVATE,
    ) -> ChatChannel:
        """Owner-only GROUP_DM -> PUBLIC/PRIVATE channel; members and history carry over."""
        channel = await self.get_by_id(user_id, organization_id, channel_id)
        if channel.channel_type != ChannelType.GROUP_DM:
            raise ValidationError("channel", "Only group chats can be converted to a channel")
        if target_type not in (ChannelType.PUBLIC, ChannelType.PRIVATE):
            raise ValidationError("channel_type", "Converted channels must be public or private")

        membership = await self.access.get_membership(channel_id, user_id)
        if membership is None or membership.role != ChannelRole.OWNER:
            raise PermissionDeniedError(
                "convert", "Only the conversation owner can convert to a channel"
            )

        clean = name.strip()
        if not clean:
            raise ValidationError("name", "Channel name is required")
        if len(clean) > 100:
            raise ValidationError("name", "Channel name too long (max 100)")

        slug = slugify(clean)
        existing = await self.session.execute(
            select(ChatChannel.id).where(
                ChatChannel.organization_id == organization_id,
                ChatChannel.slug == slug,
                ChatChannel.id != channel_id,
                ChatChannel.is_deleted == False,  # noqa: E712
            )
        )
        if existing.scalar_one_or_none():
            slug = f"{slug}-{str(channel_id)[:8]}"

        channel.channel_type = target_type
        channel.name = clean
        channel.slug = slug
        channel.custom_name = None
        channel.updated_at = datetime.now(UTC)

        await write_audit_event(
            self.session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=Action.CHAT_CHANNEL_UPDATED,
            resource_type=AuditResourceType.CHAT,
            resource_id=channel.id,
            details={"converted_from": "GROUP_DM", "name": clean, "channel_type": target_type.value},
        )

        await self.session.commit()
        await self.session.refresh(channel)

        await invalidate_cached_channel(channel.id)
        await invalidate_cached_member_ids(channel.id)
        await invalidate_cached_dm_peers(channel.id)

        await self._post_membership_conversion_message(user_id, organization_id, channel)

        # PRIVATE channels index as EXPLICIT_MEMBERS; the GROUP_DM never was indexed.
        await self._refresh_channel_live_state(channel)

        # Every member's client refetches the channel on a self-inclusive
        # MEMBERS_ADDED, moving it from the DM section to Channels live.
        member_ids = await self._get_all_member_ids(channel.id)
        await self._publish_members_changed(channel.id, member_ids, added=True)

        return channel

    async def _post_membership_conversion_message(
        self,
        actor_user_id: UUID,
        organization_id: UUID,
        channel: ChatChannel,
    ) -> None:
        try:
            from uniffy.core.models.chat.message import SenderType
            from uniffy.domains.chat.messages.operations import ChatMessageOperations

            resolver = SenderResolver(self.session)
            info = await resolver.resolve_one(SenderType.USER, actor_user_id)
            actor_label = sanitize_mention_label(info.display_name)
            actor = f"[[[{actor_label}|urn:uniffy:content:USER:{actor_user_id}]]]"
            kind = "public" if channel.channel_type == ChannelType.PUBLIC else "private"
            msg_ops = ChatMessageOperations(self.session)
            await msg_ops.send_message(
                user_id=actor_user_id,
                organization_id=organization_id,
                channel_id=channel.id,
                content=f"{actor} converted this conversation to the {kind} channel #{channel.name}",
                sender_type=SenderType.SYSTEM,
            )
        except Exception:
            logger.warning(f"Failed to post conversion message for channel {channel.id}")

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

        await write_audit_event(
            self.session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=Action.CHAT_CHANNEL_ARCHIVED,
            resource_type=AuditResourceType.CHAT,
            resource_id=channel.id,
            details={"name": channel.name},
        )

        await self.session.commit()

        await invalidate_cached_channel(channel.id)

        await end_active_call_for_channel(self.session, channel.id, CallEndReason.CHANNEL_ARCHIVED)

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

        await write_audit_event(
            self.session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=Action.CHAT_CHANNEL_DELETED,
            resource_type=AuditResourceType.CHAT,
            resource_id=channel.id,
            details={
                "name": channel.name,
                "channel_type": channel.channel_type.value,
            },
        )

        await self.session.commit()

        await invalidate_cached_channel(channel.id)
        await invalidate_cached_member_ids(channel.id)
        await invalidate_cached_dm_peers(channel.id)

        await end_active_call_for_channel(self.session, channel.id, CallEndReason.CHANNEL_ARCHIVED)

        await self._broadcast_channel_removed(channel)

        try:
            from uniffy.core.search.indexer import SearchIndexer

            indexer = SearchIndexer(self.session)
            # Agent DMs are indexed under AGENT_CHAT (see _index_for_search);
            # removing the wrong URN type leaves the doc searchable forever.
            urn_type = ContentType.AGENT_CHAT if channel.is_agent_dm else ContentType.CHAT
            urn = f"urn:uniffy:content:{urn_type.value}:{channel.id}"
            await indexer.remove(urn)
            # Cascade: drop chat_message docs under this channel so global search excludes them.
            await indexer.remove_by_filter(
                f'entity_type = "chat_message" AND metadata.channel_id = "{channel.id}"'
            )
        except Exception:
            logger.warning(f"Search remove failed for channel {channel.id}")

    async def _broadcast_channel_removed(
        self,
        channel: ChatChannel,
    ) -> None:
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
        await self.access.require_org_member(user_id, organization_id)
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
        await invalidate_visible_sets_for_user(organization_id, user_id)

        await self._publish_member_event(channel_id, user_id, joined=True)
        await self._post_join_system_message(user_id, organization_id, channel)
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
        await self.access.require_org_member(user_id, organization_id)
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

        if member.role == ChannelRole.OWNER:
            counts = await self.session.execute(
                select(
                    func.count().filter(ChatChannelMember.role == ChannelRole.OWNER),
                    func.count(),
                ).where(
                    ChatChannelMember.channel_id == channel_id,
                    ChatChannelMember.subject_type == SubjectType.USER,
                )
            )
            owner_count, user_member_count = counts.one()
            if owner_count <= 1 and user_member_count > 1:
                raise ValidationError("channel", "Promote another member to owner before leaving")

        # send_message requires membership, so the departure notice posts
        # while the row still exists.
        await self._post_membership_system_message(
            user_id,
            organization_id,
            channel,
            [ChatSubject(SubjectType.USER, user_id)],
            added=False,
        )

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
        if channel.channel_type == ChannelType.GROUP_DM:
            await self._refresh_group_dm_name(channel)
        await self.session.commit()
        self.access.invalidate_membership(channel_id, user_id)
        await invalidate_cached_member_ids(channel_id)
        if channel.channel_type == ChannelType.GROUP_DM:
            await invalidate_cached_dm_peers(channel_id)
        await invalidate_visible_sets_for_user(organization_id, user_id)

        await kick_user_from_active_call(self.session, channel_id, user_id)

        await self._publish_member_event(channel_id, user_id, joined=False)
        await self._refresh_channel_live_state(channel)

    async def add_members(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        member_user_ids: list[UUID],
    ) -> list[ChatChannelMember]:
        """Add members; one ON CONFLICT DO NOTHING RETURNING tells us who was actually inserted."""
        channel = await self.get_by_id(user_id, organization_id, channel_id)
        await self._require_edit(user_id, organization_id, channel)

        if channel.channel_type in (ChannelType.DIRECT, ChannelType.GROUP_DM):
            raise ValidationError("channel", "Cannot add members to DMs")

        if not member_user_ids:
            return []

        await self._require_active_user_subjects(organization_id, member_user_ids)
        await check_chat_mutation_limit(
            MEMBER_ADD,
            user_id=user_id,
            organization_id=organization_id,
        )

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
            .on_conflict_do_nothing(index_elements=["channel_id", "subject_type", "subject_id"])
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

            for member in added:
                if member.user_id is not None:
                    await write_audit_event(
                        self.session,
                        organization_id=organization_id,
                        actor_user_id=user_id,
                        action=Action.CHAT_CHANNEL_MEMBER_ADDED,
                        resource_type=AuditResourceType.CHAT,
                        resource_id=channel_id,
                        details={
                            "target_user_id": str(member.user_id),
                            "role": member.role.value,
                        },
                    )

            if channel.channel_type != ChannelType.PUBLIC:
                await record_chat_search_acl_refresh(
                    self.session,
                    organization_id=organization_id,
                    channel_id=channel_id,
                )

            await self.session.commit()

            if channel.channel_type != ChannelType.PUBLIC:
                await enqueue_chat_search_acl_refresh(channel_id)

            await invalidate_cached_member_ids(channel_id)

            for member in added:
                if member.user_id is not None:
                    await invalidate_visible_sets_for_user(organization_id, member.user_id)

            await self._publish_members_changed(
                channel_id,
                [m.user_id for m in added if m.user_id is not None],
                added=True,
            )
            await self._notify_membership_changed(
                channel,
                actor_user_id=user_id,
                target_user_ids=[m.user_id for m in added if m.user_id is not None],
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
        """Remove members; requires admin/owner role.

        Group DMs: the conversation owner can remove others; anyone can remove
        themselves (leave). 1:1 DMs stay immutable.
        """
        channel = await self.get_by_id(user_id, organization_id, channel_id)

        if channel.channel_type == ChannelType.DIRECT:
            raise ValidationError("channel", "Cannot remove members from a 1:1 DM")

        if channel.channel_type == ChannelType.GROUP_DM:
            is_self_leave = set(member_user_ids) == {user_id}
            if not is_self_leave:
                membership = await self.access.get_membership(channel_id, user_id)
                if membership is None or membership.role != ChannelRole.OWNER:
                    raise PermissionDeniedError(
                        "members", "Only the conversation owner can remove people"
                    )
        else:
            await self._require_edit(user_id, organization_id, channel)

        members_result = await self.session.execute(
            select(ChatChannelMember).where(
                ChatChannelMember.channel_id == channel_id,
                ChatChannelMember.user_id.in_(member_user_ids),
            )
        )
        members = list(members_result.scalars().all())

        # Owners can never be removed.
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

            for removed_id in removable_ids:
                if removed_id is None:
                    continue
                self_removal = removed_id == user_id
                await write_audit_event(
                    self.session,
                    organization_id=organization_id,
                    actor_user_id=user_id,
                    action=(
                        Action.CHAT_CHANNEL_MEMBER_REMOVED
                        if self_removal
                        else Action.CHAT_CHANNEL_MEMBER_KICKED
                    ),
                    resource_type=AuditResourceType.CHAT,
                    resource_id=channel_id,
                    details={"target_user_id": str(removed_id)},
                )

            if channel.channel_type == ChannelType.GROUP_DM:
                await self._refresh_group_dm_name(channel)
            if channel.channel_type != ChannelType.PUBLIC:
                await record_chat_search_acl_refresh(
                    self.session,
                    organization_id=organization_id,
                    channel_id=channel_id,
                )
            await self.session.commit()

            if channel.channel_type != ChannelType.PUBLIC:
                await enqueue_chat_search_acl_refresh(channel_id)

            await invalidate_cached_member_ids(channel_id)
            if channel.channel_type == ChannelType.GROUP_DM:
                await invalidate_cached_dm_peers(channel_id)

            for removed_id in removable_ids:
                if removed_id is not None:
                    await invalidate_visible_sets_for_user(organization_id, removed_id)
                    await kick_user_from_active_call(self.session, channel_id, removed_id)

            await self._publish_members_changed(channel_id, removable_ids, added=False)
            await self._notify_membership_changed(
                channel,
                actor_user_id=user_id,
                target_user_ids=[uid for uid in removable_ids if uid is not None],
                added=False,
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
            next_cursor = _encode_cursor({
                "joined_at": last_member.joined_at.isoformat(),
                "subject_id": str(last_member.subject_id),
            })
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
        """Update a member's preferences; muted_until uses a sentinel to
        distinguish unset vs clear.
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

    async def update_member_role(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        target_user_id: UUID,
        role: ChannelRole,
    ) -> tuple[ChatChannelMember, User]:
        """Change a USER member's channel role.

        Channel admins move members between MEMBER and ADMIN; granting or
        revoking OWNER takes an owner (or chat moderation) actor, and the
        last owner can never be demoted.
        """
        channel = await self.get_by_id(user_id, organization_id, channel_id)

        if channel.channel_type == ChannelType.DIRECT:
            raise ValidationError("channel", "1:1 DMs have no roles")

        actor_member = await self.access.get_membership(channel_id, user_id)
        actor_is_owner = bool(actor_member and actor_member.role == ChannelRole.OWNER)
        if not actor_is_owner:
            actor_is_owner = await self.access.is_org_admin(
                user_id, organization_id
            ) or await self.access.is_chat_domain_admin(user_id, organization_id)
        actor_is_admin = actor_is_owner or bool(
            actor_member and actor_member.role == ChannelRole.ADMIN
        )
        if not actor_is_admin:
            raise PermissionDeniedError("members", "Only channel admins can change roles")

        result = await self.session.execute(
            select(ChatChannelMember).where(
                ChatChannelMember.channel_id == channel_id,
                ChatChannelMember.subject_type == SubjectType.USER,
                ChatChannelMember.subject_id == target_user_id,
            )
        )
        member = result.scalar_one_or_none()
        if not member:
            raise NotFoundError("channel_member", target_user_id)

        touches_owner = ChannelRole.OWNER in (role, member.role)
        if touches_owner and not actor_is_owner:
            raise PermissionDeniedError("members", "Only an owner can grant or revoke ownership")

        if member.role == ChannelRole.OWNER and role != ChannelRole.OWNER:
            owners_result = await self.session.execute(
                select(func.count())
                .select_from(ChatChannelMember)
                .where(
                    ChatChannelMember.channel_id == channel_id,
                    ChatChannelMember.subject_type == SubjectType.USER,
                    ChatChannelMember.role == ChannelRole.OWNER,
                )
            )
            if owners_result.scalar_one() <= 1:
                raise ValidationError("role", "Promote another member to owner first")

        user_result = await self.session.execute(select(User).where(User.id == target_user_id))
        user = user_result.scalar_one()

        if member.role == role:
            return member, user

        old_role = member.role
        member.role = role

        await write_audit_event(
            self.session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=Action.CHAT_CHANNEL_MEMBER_ROLE_CHANGED,
            resource_type=AuditResourceType.CHAT,
            resource_id=channel_id,
            details={
                "target_user_id": str(target_user_id),
                "old_role": old_role.value,
                "new_role": role.value,
            },
        )

        await self.session.commit()
        await self.session.refresh(member)

        self.access.invalidate_membership(channel_id, target_user_id)
        await invalidate_cached_member_ids(channel_id)

        await self._publish_member_role_changed(
            channel_id, target_user_id, role, user.full_name or ""
        )

        return member, user

    async def _publish_member_role_changed(
        self,
        channel_id: UUID,
        member_user_id: UUID,
        role: ChannelRole,
        display_name: str,
    ) -> None:
        try:
            from uniffy.domains.chat.streaming.events import (
                MEMBER_UPDATED,
                build_member_payload,
            )
            from uniffy.domains.chat.streaming.publisher import (
                publish_channel_event_to_members,
            )

            recipients = await self._get_all_member_ids(channel_id)
            await publish_channel_event_to_members(
                recipients,
                MEMBER_UPDATED,
                build_member_payload(
                    user_id=member_user_id,
                    display_name=display_name,
                    role=role.value,
                ),
                channel_id=channel_id,
            )
        except Exception as exc:
            logger.warning(f"Failed to publish member role change for channel {channel_id}: {exc}")

    async def require_send(
        self,
        user_id: UUID,
        channel: ChatChannel,
    ) -> ChatChannelMember:
        return await self.access.require_send(user_id, channel)

    async def _publish_member_event(
        self,
        channel_id: UUID,
        member_user_id: UUID,
        *,
        joined: bool,
        member_ids: list[UUID] | None = None,
    ) -> None:
        """Publish MEMBER_JOINED/LEFT for ONE user; batch admin flows use
        _publish_members_changed.
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
                member_ids if member_ids is not None else await self._get_all_member_ids(channel_id)
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

    async def _publish_channel_created(self, channel_id: UUID) -> None:
        """Announce a new channel to everyone in it, the creator included.

        Every member's other sessions learn about the channel here; without it
        a channel only appears after a reload, and the creator's own second
        device never hears about it at all.
        """
        try:
            from uniffy.domains.chat.streaming.events import CHANNEL_CREATED
            from uniffy.domains.chat.streaming.publisher import (
                publish_channel_event_to_members,
            )

            recipients = await self._get_all_member_ids(channel_id)
            await publish_channel_event_to_members(
                recipients,
                CHANNEL_CREATED,
                {"channel_id": str(channel_id)},
                channel_id=channel_id,
            )
        except Exception as exc:
            logger.warning(f"Failed to publish channel-created for {channel_id}: {exc}")

    async def _publish_channel_updated(self, channel: ChatChannel) -> None:
        """Announce a metadata edit (name, description, icon) to every member."""
        try:
            from uniffy.domains.chat.streaming.events import CHANNEL_UPDATED
            from uniffy.domains.chat.streaming.publisher import (
                publish_channel_event_to_members,
            )

            recipients = await self._get_all_member_ids(channel.id)
            await publish_channel_event_to_members(
                recipients,
                CHANNEL_UPDATED,
                {
                    "channel_id": str(channel.id),
                    "is_archived": channel.is_archived,
                    "is_deleted": channel.is_deleted,
                },
                channel_id=channel.id,
            )
        except Exception as exc:
            logger.warning(f"Failed to publish channel-updated for {channel.id}: {exc}")

    async def _publish_members_changed(
        self,
        channel_id: UUID,
        affected_user_ids: list[UUID],
        *,
        added: bool,
        agents_affected: bool = False,
    ) -> None:
        """Publish one batched MEMBERS_ADDED / MEMBERS_REMOVED event.

        Agents carry no `user_id`, so an agent-only batch has nothing to put in
        `user_ids` - it still fans out, because the roster and member count on
        every member's screen changed all the same.
        """
        if not affected_user_ids and not agents_affected:
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
            if not added:
                recipients = list(dict.fromkeys([*recipients, *affected_user_ids]))
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

    async def _notify_membership_changed(
        self,
        channel: ChatChannel,
        *,
        actor_user_id: UUID,
        target_user_ids: list[UUID],
        added: bool,
    ) -> None:
        recipients = list(
            dict.fromkeys(user_id for user_id in target_user_ids if user_id != actor_user_id)
        )
        if not recipients:
            return
        await emit_notification(
            NotificationEvent(
                notification_type=(
                    NotificationType.CHAT_CHANNEL_INVITE
                    if added
                    else NotificationType.CHAT_CHANNEL_REMOVED
                ),
                organization_id=channel.organization_id,
                actor_id=actor_user_id,
                title=(
                    f"Added you to {channel.effective_name}"
                    if added
                    else f"Removed you from {channel.effective_name}"
                ),
                source_urn=f"urn:uniffy:content:CHAT:{channel.id}",
                target_user_ids=recipients,
                metadata={
                    "channel_id": str(channel.id),
                    "channel_name": channel.effective_name,
                    "channel_type": channel.channel_type.value,
                },
            )
        )

    async def _get_all_member_ids(self, channel_id: UUID) -> list[UUID]:
        """Member user_ids via the cache; AGENT rows with NULL user_id are dropped."""
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
        return await self._build_dm_name_from_subjects([ChatSubject.user(uid) for uid in user_ids])

    async def _refresh_group_dm_name(self, channel: ChatChannel) -> None:
        """Group-DM names carry the participant list; rebuild after membership changes.

        Caller owns the commit and the live-state refresh.
        """
        member_rows = await self.session.execute(
            select(ChatChannelMember.user_id).where(
                ChatChannelMember.channel_id == channel.id,
                ChatChannelMember.subject_type == SubjectType.USER,
                ChatChannelMember.user_id.is_not(None),
            )
        )
        user_ids = sorted({row[0] for row in member_rows.all()})
        if user_ids:
            channel.name = await self._build_dm_name(user_ids)

    async def _build_dm_name_from_subjects(self, subjects: list[ChatSubject]) -> str:
        """DM name for mixed USER + AGENT participants via SenderResolver."""
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
        """Existing DIRECT channel between two polymorphic subjects (USER/AGENT pair)."""
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

    def _build_member_row(
        self,
        channel_id: UUID,
        subject: ChatSubject,
        role: ChannelRole,
    ) -> ChatChannelMember:
        """Mirror subject_id into user_id for USER subjects; NULL for AGENT."""
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
        """Create / find a DM across mixed USER + AGENT subjects; 1:1 dedup
        by sorted subject tuple.
        """
        await self.access.require_org_member(user_id, organization_id)
        await self._require_active_user_subjects(
            organization_id,
            [s.subject_id for s in subjects if s.subject_type == SubjectType.USER],
        )
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

        await check_chat_mutation_limit(
            CHANNEL_CREATE,
            user_id=user_id,
            organization_id=organization_id,
        )

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
        await self._publish_channel_created(channel.id)
        await self._notify_membership_changed(
            channel,
            actor_user_id=user_id,
            target_user_ids=[
                subject.subject_id
                for subject in participants
                if subject.subject_type == SubjectType.USER and subject.subject_id != user_id
            ],
            added=True,
        )
        return channel

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

        await invalidate_cached_channel(channel.id)

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
            next_cursor = _encode_cursor({
                "sort_ts": last_ts.isoformat(),
                "channel_id": str(last_channel.id),
            })
        return rows, next_cursor

    async def add_members_with_subjects(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        subjects: list[ChatSubject],
    ) -> list[ChatChannelMember]:
        """Add USER/AGENT members; actor needs channel MANAGE plus VIEWER+ on each AGENT.

        Group DMs: any participant can add people (users only, 8-person cap);
        1:1 DMs stay immutable - adding a third person means a new conversation.
        """
        channel = await self.get_by_id(user_id, organization_id, channel_id)

        if channel.channel_type == ChannelType.DIRECT:
            raise ValidationError("channel", "Cannot add members to a 1:1 DM")

        if channel.channel_type == ChannelType.GROUP_DM:
            membership = await self.access.get_membership(channel_id, user_id)
            if membership is None:
                raise PermissionDeniedError("members", "Only participants can add people")
            if any(s.subject_type != SubjectType.USER for s in subjects):
                raise ValidationError("members", "Group DMs only contain users")
            count_result = await self.session.execute(
                select(func.count()).where(
                    ChatChannelMember.channel_id == channel_id,
                    ChatChannelMember.subject_type == SubjectType.USER,
                )
            )
            current_count = count_result.scalar_one()
            if current_count + len({s.subject_id for s in subjects}) > GROUP_DM_MAX_PARTICIPANTS:
                raise ValidationError(
                    "members",
                    f"Group chats are limited to {GROUP_DM_MAX_PARTICIPANTS} people. "
                    "Convert this conversation to a channel to add more.",
                )
        else:
            await self._require_edit(user_id, organization_id, channel)

        if not subjects:
            return []

        await self._require_active_user_subjects(
            organization_id,
            [s.subject_id for s in subjects if s.subject_type == SubjectType.USER],
        )

        for s in subjects:
            if s.subject_type == SubjectType.AGENT:
                await self._require_agent_usable(user_id, organization_id, s.subject_id)

        await check_chat_mutation_limit(
            MEMBER_ADD,
            user_id=user_id,
            organization_id=organization_id,
        )

        rows = [
            {
                "channel_id": channel_id,
                "subject_type": s.subject_type,
                "subject_id": s.subject_id,
                "user_id": (s.subject_id if s.subject_type == SubjectType.USER else None),
                "role": ChannelRole.MEMBER,
            }
            for s in subjects
        ]
        stmt = (
            pg_insert(ChatChannelMember)
            .values(rows)
            .on_conflict_do_nothing(index_elements=["channel_id", "subject_type", "subject_id"])
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
            for member in added:
                await write_audit_event(
                    self.session,
                    organization_id=organization_id,
                    actor_user_id=user_id,
                    action=Action.CHAT_CHANNEL_MEMBER_ADDED,
                    resource_type=AuditResourceType.CHAT,
                    resource_id=channel_id,
                    details={
                        "target_subject_type": member.subject_type.value,
                        "target_subject_id": str(member.subject_id),
                        "role": member.role.value,
                    },
                )
            if channel.channel_type == ChannelType.GROUP_DM:
                await self._refresh_group_dm_name(channel)
            if channel.channel_type != ChannelType.PUBLIC and any(
                member.subject_type == SubjectType.USER for member in added
            ):
                await record_chat_search_acl_refresh(
                    self.session,
                    organization_id=organization_id,
                    channel_id=channel_id,
                )
            await self.session.commit()

            if channel.channel_type != ChannelType.PUBLIC and any(
                member.subject_type == SubjectType.USER for member in added
            ):
                await enqueue_chat_search_acl_refresh(channel_id)

            await invalidate_cached_member_ids(channel_id)
            if channel.channel_type == ChannelType.GROUP_DM:
                await invalidate_cached_dm_peers(channel_id)

            await self._publish_members_changed(
                channel_id,
                [
                    m.user_id
                    for m in added
                    if m.subject_type == SubjectType.USER and m.user_id is not None
                ],
                added=True,
                agents_affected=any(m.subject_type == SubjectType.AGENT for m in added),
            )
            await self._notify_membership_changed(
                channel,
                actor_user_id=user_id,
                target_user_ids=[
                    member.subject_id for member in added if member.subject_type == SubjectType.USER
                ],
                added=True,
            )

            await self._post_membership_system_message(
                user_id,
                organization_id,
                channel,
                [ChatSubject(m.subject_type, m.subject_id) for m in added],
                added=True,
            )

            await self._refresh_channel_live_state(channel)

        return added

    async def _require_active_user_subjects(
        self,
        organization_id: UUID,
        user_ids: list[UUID],
    ) -> None:
        unique_ids = set(user_ids)
        if not unique_ids:
            return
        result = await self.session.execute(
            select(OrganizationMember.user_id).where(
                OrganizationMember.organization_id == organization_id,
                OrganizationMember.user_id.in_(unique_ids),
                OrganizationMember.is_active.is_(True),
            )
        )
        active_ids = set(result.scalars().all())
        if active_ids != unique_ids:
            raise ValidationError(
                "members",
                "Every user subject must be an active member of the organization",
            )

    async def remove_members_with_subjects(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        subjects: list[ChatSubject],
    ) -> None:
        """Remove USER/AGENT members; owners cannot be removed.

        Group DMs: the conversation owner can remove others; anyone can remove
        themselves (leave). 1:1 DMs stay immutable.
        """
        channel = await self.get_by_id(user_id, organization_id, channel_id)

        if channel.channel_type == ChannelType.DIRECT:
            raise ValidationError("channel", "Cannot remove members from a 1:1 DM")

        if channel.channel_type == ChannelType.GROUP_DM:
            is_self_leave = {s.subject_id for s in subjects} == {user_id}
            if not is_self_leave:
                membership = await self.access.get_membership(channel_id, user_id)
                if membership is None or membership.role != ChannelRole.OWNER:
                    raise PermissionDeniedError(
                        "members", "Only the conversation owner can remove people"
                    )
        else:
            await self._require_edit(user_id, organization_id, channel)

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
            for subject_type, subject_id in removable:
                self_removal = subject_type == SubjectType.USER and subject_id == user_id
                await write_audit_event(
                    self.session,
                    organization_id=organization_id,
                    actor_user_id=user_id,
                    action=(
                        Action.CHAT_CHANNEL_MEMBER_REMOVED
                        if self_removal
                        else Action.CHAT_CHANNEL_MEMBER_KICKED
                    ),
                    resource_type=AuditResourceType.CHAT,
                    resource_id=channel_id,
                    details={
                        "target_subject_type": subject_type.value,
                        "target_subject_id": str(subject_id),
                    },
                )
            if channel.channel_type == ChannelType.GROUP_DM:
                await self._refresh_group_dm_name(channel)
            if channel.channel_type != ChannelType.PUBLIC and any(
                subject_type == SubjectType.USER for subject_type, _ in removable
            ):
                await record_chat_search_acl_refresh(
                    self.session,
                    organization_id=organization_id,
                    channel_id=channel_id,
                )
            await self.session.commit()

            if channel.channel_type != ChannelType.PUBLIC and any(
                subject_type == SubjectType.USER for subject_type, _ in removable
            ):
                await enqueue_chat_search_acl_refresh(channel_id)

            await invalidate_cached_member_ids(channel_id)
            if channel.channel_type == ChannelType.GROUP_DM:
                await invalidate_cached_dm_peers(channel_id)

            removed_user_ids = [sid for (t, sid) in removable if t == SubjectType.USER]
            for removed_user_id in removed_user_ids:
                await kick_user_from_active_call(self.session, channel_id, removed_user_id)

            await self._publish_members_changed(
                channel_id,
                removed_user_ids,
                added=False,
                agents_affected=any(t == SubjectType.AGENT for (t, _sid) in removable),
            )
            await self._notify_membership_changed(
                channel,
                actor_user_id=user_id,
                target_user_ids=removed_user_ids,
                added=False,
            )

            await self._post_membership_system_message(
                user_id,
                organization_id,
                channel,
                [ChatSubject(t, i) for (t, i) in removable],
                added=False,
            )

            await self._refresh_channel_live_state(channel)

    async def _post_membership_system_message(
        self,
        actor_user_id: UUID,
        organization_id: UUID,
        channel: ChatChannel,
        subjects: list[ChatSubject],
        *,
        added: bool,
    ) -> None:
        """Post "Actor added/removed X, Y" as a SYSTEM message; non-fatal."""
        try:
            from uniffy.core.models.chat.message import SenderType
            from uniffy.domains.chat.messages.operations import ChatMessageOperations

            resolver = SenderResolver(self.session)
            refs = [(SenderType.USER, actor_user_id)] + [
                (
                    SenderType.USER if s.subject_type == SubjectType.USER else SenderType.AGENT,
                    s.subject_id,
                )
                for s in subjects
            ]
            # resolve_many keys its result by bare id.
            infos = await resolver.resolve_many(refs)

            def mention(sender_type: SenderType, subject_id: UUID) -> str:
                info = infos.get(subject_id)
                name = sanitize_mention_label(info.display_name if info else "Someone")
                urn_type = "USER" if sender_type == SenderType.USER else "AGENT"
                return f"[[[{name}|urn:uniffy:content:{urn_type}:{subject_id}]]]"

            actor = mention(SenderType.USER, actor_user_id)
            targets = ", ".join(mention(t, i) for t, i in refs[1:])
            is_self = len(subjects) == 1 and subjects[0].subject_id == actor_user_id
            place = (
                "the conversation" if channel.channel_type == ChannelType.GROUP_DM else "the channel"
            )
            action = "added" if added else "removed"
            if is_self and not added:
                content = f"{actor} left {place}"
            elif added:
                content = f"{actor} {action} {targets} to {place}"
            else:
                content = f"{actor} {action} {targets} from {place}"

            msg_ops = ChatMessageOperations(self.session)
            await msg_ops.send_message(
                user_id=actor_user_id,
                organization_id=organization_id,
                channel_id=channel.id,
                content=content,
                sender_type=SenderType.SYSTEM,
            )
        except Exception:
            logger.warning(f"Failed to post membership system message for channel {channel.id}")

    async def _post_join_system_message(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel: ChatChannel,
    ) -> None:
        try:
            from uniffy.core.models.chat.message import SenderType
            from uniffy.domains.chat.messages.operations import ChatMessageOperations

            user_result = await self.session.execute(
                select(User.full_name).where(User.id == user_id)
            )
            user_name = sanitize_mention_label(user_result.scalar_one_or_none() or "Someone")

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
