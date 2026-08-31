"""Call lifecycle required by destructive chat channel mutations."""

from typing import Protocol
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession


class ChannelCallLifecycle(Protocol):
    async def end_for_channel_archive(
        self,
        session: AsyncSession,
        channel_id: UUID,
    ) -> None: ...

    async def remove_member(
        self,
        session: AsyncSession,
        channel_id: UUID,
        user_id: UUID,
    ) -> None: ...
