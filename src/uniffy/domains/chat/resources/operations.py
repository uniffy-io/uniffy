"""Chat channel resource tracking.

Parses [[[label|urn]]] mentions from message content and upserts into
chat_channel_resources for the auto-populated channel resource panel.
"""

from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.content.references import extract_urns_with_types
from uniffy.core.models.chat.channel_resource import ChatChannelResource
from uniffy.core.types import ContentType, generate_id

LOGGER_COMPONENT = "chat.resources"


class ChatResourceOperations:
    """Manage auto-populated channel resource tracking."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def update_resources_from_message(
        self,
        channel_id: UUID,
        content: str,
        sender_id: UUID,
    ) -> None:
        """Parse URN mentions from message and batch-upsert resources."""
        urns = extract_urns_with_types(content)
        if not urns:
            return

        now = datetime.now(UTC)

        # Build batch values for all URNs
        rows = []
        for urn, ct in urns:
            rows.append({
                "id": generate_id(),
                "channel_id": channel_id,
                "urn": urn,
                "content_type": ct,
                "first_mentioned_at": now,
                "last_mentioned_at": now,
                "mention_count": 1,
                "first_mentioned_by": sender_id,
            })

        try:
            stmt = insert(ChatChannelResource).values(rows)
            stmt = stmt.on_conflict_do_update(
                constraint="uq_chat_resources_channel_urn",
                set_={
                    "last_mentioned_at": now,
                    "mention_count": (
                        ChatChannelResource.mention_count + 1
                    ),
                },
            )
            await self.session.execute(stmt)
            await self.session.commit()
        except Exception:
            logger.warning(
                f"Failed to upsert resources for channel {channel_id}",
                component=LOGGER_COMPONENT,
            )

    async def decrement_resources_from_message(
        self,
        channel_id: UUID,
        content: str,
    ) -> None:
        """Decrement mention counts on message delete. Remove rows with count 0."""
        urns = extract_urns_with_types(content)
        if not urns:
            return

        urn_strings = [urn for urn, _ in urns]

        try:
            # Batch decrement all URNs at once
            await self.session.execute(
                update(ChatChannelResource)
                .where(
                    ChatChannelResource.channel_id == channel_id,
                    ChatChannelResource.urn.in_(urn_strings),
                )
                .values(
                    mention_count=ChatChannelResource.mention_count - 1
                )
            )

            # Remove rows with mention_count <= 0
            await self.session.execute(
                delete(ChatChannelResource).where(
                    ChatChannelResource.channel_id == channel_id,
                    ChatChannelResource.mention_count <= 0,
                )
            )
            await self.session.commit()
        except Exception:
            logger.warning(
                f"Failed to decrement resources for channel {channel_id}",
                component=LOGGER_COMPONENT,
            )

    async def get_channel_resources(
        self,
        channel_id: UUID,
        content_type_filter: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[ChatChannelResource], int]:
        """Get channel resources with optional type filter.

        Uses a window function to get total count in a single query.
        Returns (resources, total_count).
        """
        total_col = func.count().over().label("_total")

        query = select(ChatChannelResource, total_col).where(
            ChatChannelResource.channel_id == channel_id
        )

        if content_type_filter:
            type_upper = content_type_filter.upper()
            if type_upper in ContentType.__members__:
                ct = ContentType(type_upper)
                query = query.where(ChatChannelResource.content_type == ct)

        query = query.order_by(
            ChatChannelResource.last_mentioned_at.desc()
        ).offset(offset).limit(limit)

        result = await self.session.execute(query)
        rows = result.all()

        if not rows:
            return [], 0

        resources = [row[0] for row in rows]
        total = rows[0][1]  # Window count is same for all rows

        return resources, total
