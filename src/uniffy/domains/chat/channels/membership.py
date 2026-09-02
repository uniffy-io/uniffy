"""Stage system-managed channel memberships inside an owning transaction."""

from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.membership import get_active_membership
from uniffy.core.errors import PermissionDeniedError
from uniffy.core.models.chat.channel import ChatChannel, ChatChannelStats
from uniffy.core.models.chat.channel_member import ChannelRole, ChatChannelMember
from uniffy.core.types import SubjectType


async def stage_default_channel_memberships(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
) -> list[UUID]:
    if not await get_active_membership(session, user_id, organization_id):
        raise PermissionDeniedError("Requires organization membership")

    default_channel_ids = list(
        (
            await session.execute(
                select(ChatChannel.id).where(
                    ChatChannel.organization_id == organization_id,
                    ChatChannel.is_default.is_(True),
                    ChatChannel.is_deleted.is_(False),
                )
            )
        ).scalars()
    )
    if not default_channel_ids:
        return []

    existing_ids = set(
        (
            await session.execute(
                select(ChatChannelMember.channel_id).where(
                    ChatChannelMember.channel_id.in_(default_channel_ids),
                    ChatChannelMember.subject_type == SubjectType.USER,
                    ChatChannelMember.subject_id == user_id,
                )
            )
        ).scalars()
    )
    added_ids = [channel_id for channel_id in default_channel_ids if channel_id not in existing_ids]
    if added_ids:
        session.add_all([
            ChatChannelMember(
                channel_id=channel_id,
                subject_type=SubjectType.USER,
                subject_id=user_id,
                user_id=user_id,
                role=ChannelRole.MEMBER,
            )
            for channel_id in added_ids
        ])
        await session.execute(
            update(ChatChannelStats)
            .where(ChatChannelStats.channel_id.in_(added_ids))
            .values(member_count=ChatChannelStats.member_count + 1)
        )
        await session.flush()

    return default_channel_ids
