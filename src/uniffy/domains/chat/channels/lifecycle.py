"""Focused chat channel lifecycle behavior."""

from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import and_, delete, func, select, update

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.errors import (
    NotFoundError,
    PermissionDeniedError,
    ValidationError,
)
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.chat.channel import ChannelType, ChatChannel, ChatChannelStats
from uniffy.core.models.chat.channel_member import (
    ChannelRole,
    ChatChannelMember,
)
from uniffy.core.models.chat.message import ChatMessage
from uniffy.core.models.files.attachment import Attachment
from uniffy.core.search.engine import SearchTerm, all_of
from uniffy.core.types import (
    ContentType,
    SubjectType,
)
from uniffy.domains.chat.cache import (
    invalidate_cached_dm_peers,
    invalidate_cached_member_ids,
)
from uniffy.domains.chat.streaming.events import CHANNEL_UPDATED
from uniffy.domains.chat.streaming.publisher import publish_channel_event_to_members
from uniffy.domains.chat.subjects import ChatSubject
from uniffy.domains.files.attachments.operations import AttachmentOperations

logger = logger.bind(component="chat.channels.lifecycle")


class ChannelLifecycle:
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

        await self.call_lifecycle.end_for_channel_archive(self.session, channel.id)

        await self._broadcast_channel_removed(channel)

    async def unarchive_channel(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
    ) -> ChatChannel:
        """Restore an archived channel with its members and history intact."""
        channel = await self.get_by_id(user_id, organization_id, channel_id)
        await self._require_delete(user_id, organization_id, channel)

        if not channel.is_archived:
            raise ValidationError("channel", "Channel is not archived")

        channel.is_archived = False
        channel.updated_at = datetime.now(UTC)

        await write_audit_event(
            self.session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=Action.CHAT_CHANNEL_UNARCHIVED,
            resource_type=AuditResourceType.CHAT,
            resource_id=channel.id,
            details={"name": channel.name},
        )

        await self.session.commit()
        await self.session.refresh(channel)

        # Members never changed, so the row clients dropped on archive is the one
        # they re-add; the metadata-edit broadcast carries the cleared flag.
        await self._publish_channel_updated(channel)

        return channel

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

        # Channel delete has no restore path, so message attachments (rows,
        # file copies, bytes) go with it; only messages that actually carry
        # attachments are loaded.
        attachment_parent_ids = list(
            (
                await self.session.execute(
                    select(ChatMessage.id)
                    .join(
                        Attachment,
                        and_(
                            Attachment.content_id == ChatMessage.id,
                            Attachment.content_type == ContentType.CHAT_MESSAGE,
                        ),
                    )
                    .where(ChatMessage.channel_id == channel.id)
                    .distinct()
                )
            )
            .scalars()
            .all()
        )
        if attachment_parent_ids:
            await AttachmentOperations(
                self.session,
                self.storage,
                self.search_indexer,
            ).purge_attachments_for_content(
                organization_id,
                ContentType.CHAT_MESSAGE,
                attachment_parent_ids,
            )
            await self.session.commit()

        await invalidate_cached_member_ids(channel.id)
        await invalidate_cached_dm_peers(channel.id)

        await self.call_lifecycle.end_for_channel_archive(self.session, channel.id)

        await self._broadcast_channel_removed(channel)

        try:
            # Agent DMs are indexed under AGENT_CHAT (see _index_for_search);
            # removing the wrong URN type leaves the doc searchable forever.
            urn_type = ContentType.AGENT_CHAT if channel.is_agent_dm else ContentType.CHAT
            urn = f"urn:uniffy:content:{urn_type.value}:{channel.id}"
            await self.search_indexer.remove(urn)
            # Cascade: drop chat_message docs under this channel so global search excludes them.
            await self.search_indexer.remove_by_filter(
                all_of(
                    SearchTerm("entity_type", "chat_message"),
                    SearchTerm("metadata.channel_id", str(channel.id)),
                )
            )
        except Exception:
            logger.warning(f"Search remove failed for channel {channel.id}")

    async def _broadcast_channel_removed(
        self,
        channel: ChatChannel,
    ) -> None:
        try:
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

        await self._publish_member_event(channel_id, user_id, joined=True)
        await self._post_join_system_message(user_id, organization_id, channel)
        await self._refresh_channel_live_state(channel)

        return channel

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

        await self.call_lifecycle.remove_member(self.session, channel_id, user_id)

        await self._publish_member_event(channel_id, user_id, joined=False)
        await self._refresh_channel_live_state(channel)
