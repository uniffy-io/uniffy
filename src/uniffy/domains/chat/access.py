"""Shared chat access checking with request-scoped caching."""

from collections.abc import Collection
from uuid import UUID

from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.membership import get_active_membership, is_active_member
from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.models.chat.channel_member import ChannelRole, ChatChannelMember
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.login.user import User
from uniffy.core.models.permissions.domain_admin import DomainAdmin
from uniffy.core.types import DomainType, SubjectType

PERSONAL_CHANNEL_TYPES = frozenset({ChannelType.DIRECT, ChannelType.GROUP_DM})


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
        if channel_id in self._channel_cache:
            return self._channel_cache[channel_id]

        channel = (
            await self.session.execute(
                select(ChatChannel).where(
                    ChatChannel.id == channel_id,
                    ChatChannel.organization_id == organization_id,
                    ChatChannel.is_deleted.is_(False),
                )
            )
        ).scalar_one_or_none()
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
        """Check if user is an active org admin/owner."""
        key = (user_id, organization_id)
        if key in self._org_admin_cache:
            return self._org_admin_cache[key]

        membership = await get_active_membership(self.session, user_id, organization_id)
        role = membership.role if membership is not None else None
        is_admin = role in (OrganizationRole.ADMIN, OrganizationRole.OWNER)
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

    async def require_org_member(self, user_id: UUID, organization_id: UUID) -> None:
        if not await self.is_org_member(user_id, organization_id):
            raise PermissionDeniedError("access", "organization")

    async def check_access(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel: ChatChannel,
    ) -> None:
        await self.require_org_member(user_id, organization_id)
        if await self.is_org_admin(user_id, organization_id):
            return
        if await self.is_chat_domain_admin(user_id, organization_id):
            return
        if channel.channel_type == ChannelType.PUBLIC:
            return
        member = await self.get_membership(channel.id, user_id)
        if not member:
            raise PermissionDeniedError("access", "channel")

    async def filter_viewers(
        self,
        organization_id: UUID,
        channel: ChatChannel,
        candidate_user_ids: Collection[UUID],
    ) -> list[UUID]:
        return await self._filter_viewers(
            organization_id,
            channel,
            candidate_user_ids,
            personal_membership_only=False,
        )

    async def filter_forward_source_viewers(
        self,
        organization_id: UUID,
        channel: ChatChannel,
        candidate_user_ids: Collection[UUID],
    ) -> list[UUID]:
        """Keep personal-conversation snapshots participant-only when forwarded elsewhere."""
        return await self._filter_viewers(
            organization_id,
            channel,
            candidate_user_ids,
            personal_membership_only=True,
        )

    async def _filter_viewers(
        self,
        organization_id: UUID,
        channel: ChatChannel,
        candidate_user_ids: Collection[UUID],
        *,
        personal_membership_only: bool,
    ) -> list[UUID]:
        candidates = tuple(dict.fromkeys(candidate_user_ids))
        if not candidates:
            return []
        channel_member = exists(
            select(ChatChannelMember.subject_id).where(
                ChatChannelMember.channel_id == channel.id,
                ChatChannelMember.subject_type == SubjectType.USER,
                ChatChannelMember.subject_id == OrganizationMember.user_id,
            )
        )
        chat_admin = exists(
            select(DomainAdmin.id).where(
                DomainAdmin.organization_id == organization_id,
                DomainAdmin.user_id == OrganizationMember.user_id,
                DomainAdmin.domain == DomainType.CHAT,
            )
        )
        rows = (
            await self.session.execute(
                select(
                    OrganizationMember.user_id,
                    OrganizationMember.role,
                    channel_member.label("channel_member"),
                    chat_admin.label("chat_admin"),
                )
                .join(User, User.id == OrganizationMember.user_id)
                .join(Organization, Organization.id == OrganizationMember.organization_id)
                .where(
                    OrganizationMember.organization_id == organization_id,
                    OrganizationMember.user_id.in_(candidates),
                    OrganizationMember.is_active.is_(True),
                    User.is_active.is_(True),
                    Organization.deleted_at.is_(None),
                    Organization.is_suspended.is_(False),
                )
            )
        ).all()
        allowed = {
            row.user_id
            for row in rows
            if row.channel_member
            or channel.channel_type == ChannelType.PUBLIC
            or (
                not (personal_membership_only and channel.channel_type in PERSONAL_CHANNEL_TYPES)
                and (row.role in (OrganizationRole.OWNER, OrganizationRole.ADMIN) or row.chat_admin)
            )
        }
        return [user_id for user_id in candidates if user_id in allowed]

    async def filter_forward_source_channel_ids(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_ids: Collection[UUID],
    ) -> set[UUID]:
        candidates = tuple(dict.fromkeys(channel_ids))
        if not candidates or not await self.is_org_member(user_id, organization_id):
            return set()

        channels = list(
            (
                await self.session.execute(
                    select(ChatChannel).where(
                        ChatChannel.id.in_(candidates),
                        ChatChannel.organization_id == organization_id,
                        ChatChannel.is_deleted.is_(False),
                    )
                )
            )
            .scalars()
            .all()
        )
        for channel in channels:
            self._channel_cache[channel.id] = channel

        allowed = {channel.id for channel in channels if channel.channel_type == ChannelType.PUBLIC}
        moderation_access = await self.is_org_admin(
            user_id, organization_id
        ) or await self.is_chat_domain_admin(user_id, organization_id)
        if moderation_access:
            allowed.update(
                channel.id
                for channel in channels
                if channel.channel_type not in PERSONAL_CHANNEL_TYPES
            )

        membership_required_ids = [channel.id for channel in channels if channel.id not in allowed]
        if membership_required_ids:
            member_ids = (
                await self.session.execute(
                    select(ChatChannelMember.channel_id).where(
                        ChatChannelMember.channel_id.in_(membership_required_ids),
                        ChatChannelMember.subject_type == SubjectType.USER,
                        ChatChannelMember.subject_id == user_id,
                    )
                )
            ).scalars()
            allowed.update(member_ids)
        return allowed

    async def require_send(
        self,
        user_id: UUID,
        channel: ChatChannel,
    ) -> ChatChannelMember:
        """Verify user can send messages; returns membership for role checks."""
        from uniffy.core.errors import ValidationError

        await self.require_org_member(user_id, channel.organization_id)

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
        await self.require_org_member(user_id, organization_id)
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
