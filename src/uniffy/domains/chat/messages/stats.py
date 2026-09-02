"""Chat message aggregate counters."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.chat.channel import ChatChannelStats


async def bump_channel_message_stats(
    session: AsyncSession,
    channel_id: UUID,
    *,
    at: datetime,
    is_root: bool,
) -> None:
    """Advance the channel's message counters and activity timestamps.

    Every persisted chat row - human or agent - must run through this so the
    sidebar's last-activity ordering stays truthful. Caller owns the commit.
    """
    if is_root:
        await session.execute(
            update(ChatChannelStats)
            .where(ChatChannelStats.channel_id == channel_id)
            .values(
                message_count=ChatChannelStats.message_count + 1,
                root_message_count=ChatChannelStats.root_message_count + 1,
                last_message_at=at,
                last_root_message_at=at,
            )
        )
    else:
        await session.execute(
            update(ChatChannelStats)
            .where(ChatChannelStats.channel_id == channel_id)
            .values(
                message_count=ChatChannelStats.message_count + 1,
                last_message_at=at,
            )
        )
