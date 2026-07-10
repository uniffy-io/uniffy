"""Shared chat access checking with request-scoped caching."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.cache import get_or_load_org_admin
from uniffy.core.auth.membership import is_active_member
from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.models.chat.channel_member import ChannelRole, ChatChannelMember
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.types import SubjectType
from uniffy.domains.chat.cache import get_or_load_channel


class ChatAccessChecker:
    """Request-scoped access checker with single-request caching."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self._channel_cache: dict[UUID, ChatChannel] = {}
        self._membership_cache: dict[tuple[UUID, SubjectType, UUID], ChatChannelMember | None] = {}
        self._org_admin_cache: dict[tuple[UUID, UUID], bool] = {}
        self._domain_admin_cache: dict[tuple[UUID, UUID], bool] = {}
        self._org_member_cache: dict[tuple[UUID, UUID], bool] = {}

    async def get_channel(self, channel_id: UUID, organization_id: UUID) -> ChatChannel:
        """Fetch channel via L0 request cache -> L1 Valkey (stampede-protected) -> PG."""
        if channel_id in self._channel_cache:
            return self._channel_cache[channel_id]

        channel = await get_or_load_channel(
            self.session, channel_id, organization_id
        )
        if not channel:
            raise NotFoundError("channel", channel_id)

        self._channel_cache[channel_id] = channel
        return channel

    async def get_membership_by_subject(
        self,
        channel_id: UUID,
        subject_type: SubjectType,
        subject_id: UUID,
    ) -> ChatChannelMember | None:
        """Membership lookup keyed on the polymorphic PK; hits ix_chat_members_subject_covering."""
        key = (channel_id, subject_type, subject_id)
        if key in self._membership_cache:
            return self._membership_cache[key]

        result = await self.session.execute(
            select(ChatChannelMember).where(
                ChatChannelMember.channel_id == channel_id,
                ChatChannelMember.subject_type == subject_type,
                ChatChannelMember.subject_id == subject_id,
            )
        )
        member = result.scalar_one_or_none()
        self._membership_cache[key] = member
        return member

    async def get_membership(self, channel_id: UUID, user_id: UUID) -> ChatChannelMember | None:
        return await self.get_membership_by_subject(channel_id, SubjectType.USER, user_id)

    async def is_org_admin(self, user_id: UUID, organization_id: UUID) -> bool:
        """Check if user is org admin/owner via L0 request cache -> L1 Valkey -> PG."""
        key = (user_id, organization_id)
        if key in self._org_admin_cache:
            return self._org_admin_cache[key]

        async def _load() -> bool:
            result = await self.session.execute(
                select(OrganizationMember.role).where(
                    OrganizationMember.user_id == user_id,
                    OrganizationMember.organization_id == organization_id,
                )
            )
            role = result.scalar_one_or_none()
            return role in (OrganizationRole.ADMIN, OrganizationRole.OWNER)

        is_admin = await get_or_load_org_admin(organization_id, user_id, _load)
        self._org_admin_cache[key] = is_admin
        return is_admin

    async def is_chat_domain_admin(self, user_id: UUID, organization_id: UUID) -> bool:
        key = (user_id, organization_id)
        if key in self._domain_admin_cache:
            return self._domain_admin_cache[key]

        from uniffy.core.auth.domain_admin import is_domain_admin
        from uniffy.core.models.shared import DomainType

        result = await is_domain_admin(self.session, user_id, organization_id, DomainType.CHAT)
        self._domain_admin_cache[key] = result
        return result

    async def is_org_member(self, user_id: UUID, organization_id: UUID) -> bool:
        key = (user_id, organization_id)
        if key in self._org_member_cache:
            return self._org_member_cache[key]
        result = await is_active_member(user_id, organization_id, session=self.session)
        self._org_member_cache[key] = result
        return result

    async def check_access(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel: ChatChannel,
    ) -> None:
        if await self.is_org_admin(user_id, organization_id):
            return
        if await self.is_chat_domain_admin(user_id, organization_id):
            return
        if channel.channel_type == ChannelType.PUBLIC:
            # Open to the org means the org, not any authenticated user:
            # the request org id is caller-supplied, so membership is the gate.
            if await self.is_org_member(user_id, organization_id):
                return
            raise PermissionDeniedError("access", "channel")
        member = await self.get_membership(channel.id, user_id)
        if not member:
            raise PermissionDeniedError("access", "channel")

    async def require_send(
        self,
        user_id: UUID,
        channel: ChatChannel,
    ) -> ChatChannelMember:
        """Verify user can send messages; returns membership for role checks."""
        from uniffy.core.errors import ValidationError

        if channel.is_archived:
            raise ValidationError("channel", "Channel is archived")

        member = await self.get_membership(channel.id, user_id)
        if not member:
            raise PermissionDeniedError("send", "Must join channel to send messages")
        return member

    async def require_elevated(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
    ) -> bool:
        """User has admin/owner of the channel or org."""
        if await self.is_org_admin(user_id, organization_id):
            return True
        if await self.is_chat_domain_admin(user_id, organization_id):
            return True
        member = await self.get_membership(channel_id, user_id)
        return bool(member and member.role in (ChannelRole.ADMIN, ChannelRole.OWNER))

    def invalidate_membership(
        self,
        channel_id: UUID,
        user_id: UUID | None = None,
        *,
        subject_type: SubjectType | None = None,
        subject_id: UUID | None = None,
    ) -> None:
        """Invalidate a cached membership entry after mutation."""
        if subject_type is not None and subject_id is not None:
            self._membership_cache.pop((channel_id, subject_type, subject_id), None)
            return
        if user_id is not None:
            self._membership_cache.pop((channel_id, SubjectType.USER, user_id), None)
