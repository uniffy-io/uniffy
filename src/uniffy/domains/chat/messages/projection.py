from collections.abc import Collection
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uniffy_proto.chat.v1.chat_pb import ForwardContext as ProtoForwardContext

from uniffy.core.models.chat.channel import ChatChannel
from uniffy.core.models.chat.message import ChatMessage, ChatMessageMetadataKey
from uniffy.domains.chat.access import ChatAccessChecker
from uniffy.domains.chat.messages.converters import (
    forward_context_to_proto,
    get_forward_metadata,
)


class ForwardProjectionResolver:
    def __init__(self, session: AsyncSession, access: ChatAccessChecker | None = None) -> None:
        self.session = session
        self.access = access or ChatAccessChecker(session)

    async def resolve(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        messages: Collection[ChatMessage],
    ) -> dict[UUID, ProtoForwardContext]:
        references: dict[UUID, tuple[UUID, UUID, dict]] = {}
        for message in messages:
            raw = get_forward_metadata(message.message_metadata)
            if raw is None:
                continue
            try:
                source_message_id = UUID(str(raw["message_id"]))
                source_channel_id = UUID(str(raw["channel_id"]))
            except KeyError, TypeError, ValueError:
                continue
            references[message.id] = (source_message_id, source_channel_id, raw)

        if not references:
            return {}

        source_message_ids = {reference[0] for reference in references.values()}
        source_rows = (
            await self.session.execute(
                select(ChatMessage.id, ChatMessage.channel_id)
                .join(ChatChannel, ChatChannel.id == ChatMessage.channel_id)
                .where(
                    ChatMessage.id.in_(source_message_ids),
                    ChatMessage.is_deleted.is_(False),
                    ChatChannel.organization_id == organization_id,
                    ChatChannel.is_deleted.is_(False),
                )
            )
        ).all()
        live_sources = {(row.id, row.channel_id) for row in source_rows}
        live_channel_ids = {
            source_channel_id
            for source_message_id, source_channel_id, _raw in references.values()
            if (source_message_id, source_channel_id) in live_sources
        }
        accessible_channel_ids = await self.access.filter_forward_source_channel_ids(
            user_id,
            organization_id,
            live_channel_ids,
        )

        projections: dict[UUID, ProtoForwardContext] = {}
        for message_id, (source_message_id, source_channel_id, raw) in references.items():
            if (
                source_message_id,
                source_channel_id,
            ) not in live_sources or source_channel_id not in accessible_channel_ids:
                continue
            context = forward_context_to_proto({ChatMessageMetadataKey.FORWARD.value: raw})
            if context is not None:
                projections[message_id] = context
        return projections
