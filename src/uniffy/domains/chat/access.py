"""Shared chat access checking with request-scoped caching.

All chat operations classes use this to avoid duplicate membership and
org-admin queries within the same request.
"""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.models.chat.channel_member import ChannelRole, ChatChannelMember
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole


class ChatAccessChecker:
    """Request-scoped access checker with single-request caching.

    Caches channel lookups, membership lookups, and org-admin checks so
    that repeated calls within the same handler do not hit the database.
    """

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self._channel_cache: dict[UUID, ChatChannel] = {}
        self._membership_cache: dict[tuple[UUID, UUID], ChatChannelMember | None] = {}
        self._org_admin_cache: dict[tuple[UUID, UUID], bool] = {}

    async def get_channel(
        self, channel_id: UUID, organization_id: UUID
    ) -> ChatChannel:
        """Fetch channel or raise NotFoundError. Cached per request."""
        if channel_id in self._channel_cache:
            return self._channel_cache[channel_id]

        result = await self.session.execute(
            select(ChatChannel).where(
                ChatChannel.id == channel_id,
                ChatChannel.organization_id == organization_id,
                ChatChannel.is_deleted == False,  # noqa: E712
            )
        )
        channel = result.scalar_one_or_none()
        if not channel:
            raise NotFoundError("channel", channel_id)

        self._channel_cache[channel_id] = channel
        return channel

    async def get_membership(
        self, channel_id: UUID, user_id: UUID
    ) -> ChatChannelMember | None:
        """Get membership. Cached per request."""
        key = (channel_id, user_id)
        if key in self._membership_cache:
            return self._membership_cache[key]

        result = await self.session.execute(
            select(ChatChannelMember).where(
                ChatChannelMember.channel_id == channel_id,
                ChatChannelMember.user_id == user_id,
            )
        )
        member = result.scalar_one_or_none()
        self._membership_cache[key] = member
        return member

    async def is_org_admin(
        self, user_id: UUID, organization_id: UUID
    ) -> bool:
        """Check if user is org admin/owner. Cached per request."""
        key = (user_id, organization_id)
        if key in self._org_admin_cache:
            return self._org_admin_cache[key]

        result = await self.session.execute(
            select(OrganizationMember.role).where(
                OrganizationMember.user_id == user_id,
                OrganizationMember.organization_id == organization_id,
            )
        )
        role = result.scalar_one_or_none()
        is_admin = role in (OrganizationRole.ADMIN, OrganizationRole.OWNER)
        self._org_admin_cache[key] = is_admin
        return is_admin

    async def check_access(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel: ChatChannel,
    ) -> None:
        """Check channel access (membership-based). Raises PermissionDeniedError."""
        if await self.is_org_admin(user_id, organization_id):
            return
        if channel.channel_type == ChannelType.PUBLIC:
            return
        member = await self.get_membership(channel.id, user_id)
        if not member:
            raise PermissionDeniedError("access", "channel")

    async def require_send(
        self,
        user_id: UUID,
        channel: ChatChannel,
    ) -> ChatChannelMember:
        """Verify user can send messages. Returns membership for role checks."""
        from uniffy.core.errors import ValidationError

        if channel.is_archived:
            raise ValidationError("channel", "Channel is archived")

        member = await self.get_membership(channel.id, user_id)
        if not member:
            raise PermissionDeniedError(
                "send", "Must join channel to send messages"
            )
        return member

    async def require_elevated(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
    ) -> bool:
        """Check if user has elevated permissions (admin/owner of channel or org)."""
        if await self.is_org_admin(user_id, organization_id):
            return True
        member = await self.get_membership(channel_id, user_id)
        return bool(
            member and member.role in (ChannelRole.ADMIN, ChannelRole.OWNER)
        )

    def invalidate_membership(self, channel_id: UUID, user_id: UUID) -> None:
        """Invalidate a cached membership entry after mutation."""
        self._membership_cache.pop((channel_id, user_id), None)
