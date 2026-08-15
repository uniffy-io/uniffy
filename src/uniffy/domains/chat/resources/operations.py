"""Auto-populated channel resource tracking from [[[label|urn]]] mentions."""

from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.content.references import extract_urns_with_types
from uniffy.core.models.chat.channel_resource import ChatChannelResource
from uniffy.core.types import ContentType, generate_id
from uniffy.domains.chat.cache import (
    RESOURCES_HEAD_LIMIT,
    get_cached_channel_resources_head,
    invalidate_cached_channel_resources,
    set_cached_channel_resources_head,
)

LOGGER_COMPONENT = "chat.resources"


class ChatResourceOperations:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def update_resources_from_message(
        self,
        channel_id: UUID,
        content: str,
        sender_id: UUID,
    ) -> None:
        """Parse URN mentions and batch-upsert resources."""
        urns = extract_urns_with_types(content)
        if not urns:
            return

        now = datetime.now(UTC)

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
                    "mention_count": (ChatChannelResource.mention_count + 1),
                },
            )
            await self.session.execute(stmt)
            await self.session.commit()
        except Exception:
            logger.warning(
                f"Failed to upsert resources for channel {channel_id}",
                component=LOGGER_COMPONENT,
            )
            return

        touched_types = sorted({ct.value for _, ct in urns})
        await invalidate_cached_channel_resources(channel_id, touched_types)

    async def decrement_resources_from_message(
        self,
        channel_id: UUID,
        content: str,
    ) -> None:
        """Decrement mention counts on delete; drop rows that reach zero."""
        urns = extract_urns_with_types(content)
        if not urns:
            return

        urn_strings = [urn for urn, _ in urns]

        try:
            await self.session.execute(
                update(ChatChannelResource)
                .where(
                    ChatChannelResource.channel_id == channel_id,
                    ChatChannelResource.urn.in_(urn_strings),
                )
                .values(mention_count=ChatChannelResource.mention_count - 1)
            )

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
            return

        touched_types = sorted({ct.value for _, ct in urns})
        await invalidate_cached_channel_resources(channel_id, touched_types)

    async def get_channel_resources(
        self,
        channel_id: UUID,
        content_type_filter: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[ChatChannelResource], int]:
        """Channel resources with optional type filter; head served from Valkey when eligible."""
        head_eligible = offset == 0 and limit <= RESOURCES_HEAD_LIMIT
        if head_eligible:
            cached = await get_cached_channel_resources_head(channel_id, content_type_filter)
            if cached is not None:
                head_payloads, total = cached
                resources = [_resource_from_payload(channel_id, p) for p in head_payloads]
                return resources[:limit], total

        total_col = func.count().over().label("_total")

        query = select(ChatChannelResource, total_col).where(
            ChatChannelResource.channel_id == channel_id
        )

        if content_type_filter:
            type_upper = content_type_filter.upper()
            if type_upper in ContentType.__members__:
                ct = ContentType(type_upper)
                query = query.where(ChatChannelResource.content_type == ct)

        if head_eligible:
            head_query = (
                query
                .order_by(ChatChannelResource.last_mentioned_at.desc())
                .offset(0)
                .limit(RESOURCES_HEAD_LIMIT)
            )
            head_result = await self.session.execute(head_query)
            head_rows = head_result.all()
            if not head_rows:
                await set_cached_channel_resources_head(channel_id, content_type_filter, [], 0)
                return [], 0

            head_resources = [row[0] for row in head_rows]
            total = head_rows[0][1]
            await set_cached_channel_resources_head(
                channel_id,
                content_type_filter,
                [_resource_to_payload(r) for r in head_resources],
                total,
            )
            return head_resources[:limit], total

        query = (
            query.order_by(ChatChannelResource.last_mentioned_at.desc()).offset(offset).limit(limit)
        )

        result = await self.session.execute(query)
        rows = result.all()

        if not rows:
            return [], 0

        resources = [row[0] for row in rows]
        total = rows[0][1]

        return resources, total


def _resource_to_payload(row: ChatChannelResource) -> dict:
    return {
        "id": str(row.id),
        "urn": row.urn,
        "content_type": row.content_type.value,
        "first_mentioned_at": (
            row.first_mentioned_at.isoformat() if row.first_mentioned_at else None
        ),
        "last_mentioned_at": (row.last_mentioned_at.isoformat() if row.last_mentioned_at else None),
        "mention_count": row.mention_count,
        "first_mentioned_by": (str(row.first_mentioned_by) if row.first_mentioned_by else None),
    }


def _resource_from_payload(
    channel_id: UUID,
    payload: dict,
) -> ChatChannelResource:
    return ChatChannelResource(
        id=UUID(payload["id"]),
        channel_id=channel_id,
        urn=payload["urn"],
        content_type=ContentType(payload["content_type"]),
        first_mentioned_at=(
            datetime.fromisoformat(payload["first_mentioned_at"])
            if payload.get("first_mentioned_at")
            else None
        ),
        last_mentioned_at=(
            datetime.fromisoformat(payload["last_mentioned_at"])
            if payload.get("last_mentioned_at")
            else None
        ),
        mention_count=payload.get("mention_count", 0),
        first_mentioned_by=(
            UUID(payload["first_mentioned_by"]) if payload.get("first_mentioned_by") else None
        ),
    )
