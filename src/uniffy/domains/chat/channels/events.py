"""Focused chat channel events behavior."""

from uuid import UUID

from loguru import logger

from uniffy.core.events.bus import emit_notification
from uniffy.core.events.types import NotificationEvent
from uniffy.core.models.chat.channel import ChatChannel
from uniffy.core.models.chat.channel_member import (
    ChannelRole,
    ChatChannelMember,
)
from uniffy.core.models.login.user import User
from uniffy.core.types import (
    NotificationType,
)
from uniffy.domains.chat.cache import (
    fetch_channel_members,
)
from uniffy.domains.chat.streaming.events import (
    CHANNEL_CREATED,
    CHANNEL_UPDATED,
    MEMBER_JOINED,
    MEMBER_LEFT,
    MEMBER_UPDATED,
    MEMBERS_ADDED,
    MEMBERS_REMOVED,
    build_member_payload,
    build_members_changed_payload,
)
from uniffy.domains.chat.streaming.publisher import publish_channel_event_to_members

logger = logger.bind(component="chat.channels.events")


class ChannelEvents:
    async def _publish_member_role_changed(
        self,
        channel_id: UUID,
        member_user_id: UUID,
        role: ChannelRole,
        display_name: str,
    ) -> None:
        try:
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
                source_urn=(f"urn:uniffy:content:CHAT:{channel.id}" if added else None),
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
