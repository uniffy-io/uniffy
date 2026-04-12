"""Chat channel operations with membership-based permission model.

Chat uses channel membership as the permission. The BaseContentOperations
``_require_*`` helpers are overridden to delegate to ``ChatAccessChecker``.
Channels do not participate in the generic access_mode / baseline_role
model -- channel_type (PUBLIC / PRIVATE / DIRECT / GROUP_DM) drives access.
"""

from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.content.base_operations import BaseContentOperations
from uniffy.core.errors import (
    NotFoundError,
    PermissionDeniedError,
    ValidationError,
)
from uniffy.core.models.chat.channel import ChannelType, ChatChannel, ChatChannelStats
from uniffy.core.models.chat.channel_member import (
    ChannelRole,
    ChatChannelMember,
)
from uniffy.core.models.login.user import User
from uniffy.core.types import AccessMode, ContentType, slugify
from uniffy.domains.chat.access import ChatAccessChecker


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
        return f"{model.name} {model.description}"

    def _get_search_title(self, model: ChatChannel) -> str:
        return model.name

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
        DMs and group DMs are excluded from search entirely.
        """
        del skip_member_lookup  # membership is always the source of truth
        if model.channel_type in (ChannelType.DIRECT, ChannelType.GROUP_DM):
            return

        if model.channel_type == ChannelType.PUBLIC:
            access_mode = AccessMode.OPEN_TO_ORG.value
            shared_user_ids = None
        else:
            access_mode = AccessMode.EXPLICIT_MEMBERS.value
            member_ids = await self._get_all_member_ids(model.id)
            shared_user_ids = member_ids if member_ids else None

        await self.search_indexer.index(
            urn=f"urn:uniffy:content:CHAT:{model.id}",
            organization_id=model.organization_id,
            title=self._get_search_title(model),
            entity_type=self.content_type.value,
            url_path=self._get_url_path(model),
            access_mode=access_mode,
            baseline_role=None,
            owner_id=model.owner_id,
            keywords=self._build_search_keywords(model),
            description=self._get_search_description(model),
            shared_user_ids=shared_user_ids,
        )

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
            raise ValidationError(
                "members", "Group DMs support up to 8 participants"
            )

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
    ) -> list[tuple[ChatChannel, ChatChannelStats, ChannelRole]]:
        """List channels the user is a member of (sidebar query)."""
        result = await self.session.execute(
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
            )
            .order_by(ChatChannelStats.last_root_message_at.desc().nullslast())
        )
        return list(result.all())

    async def list_public_channels(
        self,
        organization_id: UUID,
    ) -> list[tuple[ChatChannel, ChatChannelStats]]:
        """List all public channels for browse view."""
        result = await self.session.execute(
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
            .order_by(ChatChannelStats.member_count.desc())
        )
        return list(result.all())

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

        # Publish MEMBER_JOINED event to existing members
        await self._publish_member_event(channel_id, user_id, joined=True)

        # Post a system message announcing the join
        await self._post_join_system_message(user_id, organization_id, channel)

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

        # Publish MEMBER_LEFT event to remaining members
        await self._publish_member_event(channel_id, user_id, joined=False)

    async def add_members(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        member_user_ids: list[UUID],
    ) -> list[ChatChannelMember]:
        """Add members to a channel. Requires admin/owner role."""
        channel = await self.get_by_id(user_id, organization_id, channel_id)
        await self._require_edit(user_id, organization_id, channel)

        if channel.channel_type in (ChannelType.DIRECT, ChannelType.GROUP_DM):
            raise ValidationError(
                "channel", "Cannot add members to DMs"
            )

        # Batch-fetch existing memberships
        existing_result = await self.session.execute(
            select(ChatChannelMember.user_id).where(
                ChatChannelMember.channel_id == channel_id,
                ChatChannelMember.user_id.in_(member_user_ids),
            )
        )
        existing_ids = {r[0] for r in existing_result.all()}

        added = []
        for mid in member_user_ids:
            if mid in existing_ids:
                continue
            m = ChatChannelMember(
                channel_id=channel_id,
                user_id=mid,
                role=ChannelRole.MEMBER,
            )
            self.session.add(m)
            added.append(m)

        if added:
            await self.session.execute(
                update(ChatChannelStats)
                .where(ChatChannelStats.channel_id == channel_id)
                .values(
                    member_count=ChatChannelStats.member_count + len(added)
                )
            )
            await self.session.commit()

            # Publish MEMBER_JOINED events for each added member
            for m in added:
                await self._publish_member_event(channel_id, m.user_id, joined=True)

            # Re-index search for private channels (shared_user_ids changed)
            if channel.channel_type != ChannelType.PUBLIC:
                try:
                    await self._index_for_search(channel)
                except Exception:
                    logger.warning(f"Failed to re-index channel {channel_id}")

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
            raise ValidationError(
                "channel", "Cannot remove members from DMs"
            )

        # Batch-fetch memberships to check roles
        members_result = await self.session.execute(
            select(ChatChannelMember).where(
                ChatChannelMember.channel_id == channel_id,
                ChatChannelMember.user_id.in_(member_user_ids),
            )
        )
        members = list(members_result.scalars().all())

        # Filter out owners (cannot be removed)
        removable_ids = [
            m.user_id for m in members if m.role != ChannelRole.OWNER
        ]

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
                .values(
                    member_count=ChatChannelStats.member_count - len(removable_ids)
                )
            )
            await self.session.commit()

            # Publish MEMBER_LEFT events for each removed member
            for rid in removable_ids:
                await self._publish_member_event(channel_id, rid, joined=False)

            if channel.channel_type != ChannelType.PUBLIC:
                try:
                    await self._index_for_search(channel)
                except Exception:
                    logger.warning(f"Failed to re-index channel {channel_id}")

    async def get_members(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
    ) -> list[tuple[ChatChannelMember, User]]:
        """Get channel members with user info."""
        # Permission check: get_by_id verifies access
        await self.get_by_id(user_id, organization_id, channel_id)

        result = await self.session.execute(
            select(ChatChannelMember, User)
            .join(User, User.id == ChatChannelMember.user_id)
            .where(ChatChannelMember.channel_id == channel_id)
            .order_by(ChatChannelMember.joined_at)
        )
        return list(result.all())

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
    ) -> None:
        """Publish a MEMBER_JOINED or MEMBER_LEFT event to channel members."""
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

            member_ids = await self._get_all_member_ids(channel_id)
            await publish_channel_event_to_members(
                member_ids,
                MEMBER_JOINED if joined else MEMBER_LEFT,
                build_member_payload(
                    user_id=member_user_id,
                    display_name=display_name,
                    role="MEMBER",
                ),
                channel_id=channel_id,
            )
        except Exception as exc:
            logger.warning(
                f"Failed to publish member event for channel {channel_id}: {exc}"
            )

    async def _get_all_member_ids(self, channel_id: UUID) -> list[UUID]:
        """Get all member user IDs for a channel."""
        result = await self.session.execute(
            select(ChatChannelMember.user_id).where(
                ChatChannelMember.channel_id == channel_id
            )
        )
        return [row[0] for row in result.all()]

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
        """Build DM name from participant display names."""
        result = await self.session.execute(
            select(User.full_name).where(User.id.in_(user_ids))
        )
        names = [row[0] or "Unknown" for row in result.all()]
        if len(names) <= 3:
            return ", ".join(names)
        return f"{', '.join(names[:2])}, and {len(names) - 2} others"

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
            user_name = (user_result.scalar_one_or_none() or "Someone")

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
