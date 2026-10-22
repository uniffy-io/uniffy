"""Bind the user-scoped chat stream to the one organization its client serves."""

from collections.abc import Awaitable, Callable
from typing import Any
from uuid import UUID

from sqlalchemy import select

from uniffy.core.models.chat.channel import ChatChannel
from uniffy.infrastructure.database import open_session

ChannelOrganizationLookup = Callable[[UUID], Awaitable[UUID | None]]


async def load_channel_organization(channel_id: UUID) -> UUID | None:
    async with open_session() as session:
        return await session.scalar(
            select(ChatChannel.organization_id).where(ChatChannel.id == channel_id)
        )


class ChannelOrganizationFilter:
    """Admits events of the stream organization's channels; `chat:user:{user_id}` carries every org.

    A channel never moves between organizations, so each answer holds for the stream's life.
    """

    def __init__(
        self,
        organization_id: UUID,
        lookup: ChannelOrganizationLookup = load_channel_organization,
    ) -> None:
        self._organization_id = organization_id
        self._lookup = lookup
        self._admitted: dict[str, bool] = {}

    async def admits(self, payload: dict[str, Any]) -> bool:
        raw_channel_id = payload.get("channel_id")
        if not isinstance(raw_channel_id, str) or not raw_channel_id:
            return False
        known = self._admitted.get(raw_channel_id)
        if known is not None:
            return known
        try:
            channel_id = UUID(raw_channel_id)
        except ValueError:
            return False
        organization_id = await self._lookup(channel_id)
        if organization_id is None:
            # A missing row is not remembered, so a later event can still
            # resolve the channel once its creating transaction is visible.
            return False
        admitted = organization_id == self._organization_id
        self._admitted[raw_channel_id] = admitted
        return admitted
