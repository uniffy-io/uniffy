"""Focused chat channel updates behavior."""

from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import select

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.content.references import sanitize_mention_label
from uniffy.core.errors import (
    PermissionDeniedError,
    ValidationError,
)
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.models.chat.channel_member import (
    ChannelRole,
)
from uniffy.core.models.chat.message import SenderType
from uniffy.core.types import (
    slugify,
)
from uniffy.domains.chat.cache import (
    invalidate_cached_dm_peers,
    invalidate_cached_member_ids,
)
from uniffy.domains.chat.channels.slugs import slug_suffix
from uniffy.domains.chat.messages.operations import ChatMessageOperations
from uniffy.domains.chat.senders import SenderResolver

logger = logger.bind(component="chat.channels.updates")


class ChannelUpdates:
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
        # The unique constraint covers soft-deleted rows, so this check must too.
        existing = await self.session.execute(
            select(ChatChannel.id).where(
                ChatChannel.organization_id == organization_id,
                ChatChannel.slug == slug,
                ChatChannel.id != channel_id,
            )
        )
        if existing.scalar_one_or_none():
            slug = f"{slug}-{slug_suffix(channel_id)}"

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

        await invalidate_cached_member_ids(channel.id)
        await invalidate_cached_dm_peers(channel.id)

        await self._post_membership_conversion_message(
            user_id,
            organization_id,
            channel,
        )

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
            resolver = SenderResolver(self.session)
            info = await resolver.resolve_one(SenderType.USER, actor_user_id)
            actor_label = sanitize_mention_label(info.display_name)
            actor = f"[[[{actor_label}|urn:uniffy:content:USER:{actor_user_id}]]]"
            kind = "public" if channel.channel_type == ChannelType.PUBLIC else "private"
            msg_ops = ChatMessageOperations(
                self.session,
                storage=self.storage,
                search_indexer=self.search_indexer,
            )
            await msg_ops.send_message(
                user_id=actor_user_id,
                organization_id=organization_id,
                channel_id=channel.id,
                content=f"{actor} converted this conversation to the {kind} channel #{channel.name}",
                sender_type=SenderType.SYSTEM,
            )
        except Exception:
            logger.warning(f"Failed to post conversion message for channel {channel.id}")
