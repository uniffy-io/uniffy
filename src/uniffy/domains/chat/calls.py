"""Chat capabilities used by calls without exposing chat implementation modules."""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.chat.message import ChatMessageMetadataKind, SenderType
from uniffy.core.search import SearchIndexer
from uniffy.core.storage import ObjectStorage
from uniffy.core.types import SubjectType
from uniffy.domains.chat.cache import fetch_channel_members
from uniffy.domains.chat.messages.operations import ChatMessageOperations
from uniffy.domains.chat.senders import SenderInfo, SenderResolver
from uniffy.domains.chat.streaming.events import (
    CALL_ENDED,
    CALL_HOST_CHANGED,
    CALL_PARTICIPANT_JOINED,
    CALL_PARTICIPANT_LEFT,
    CALL_PARTICIPANT_STATE,
    CALL_RING,
    CALL_STARTED,
    build_call_host_changed_payload,
    build_call_lifecycle_payload,
    build_call_participant_payload,
    build_call_ring_payload,
)
from uniffy.domains.chat.streaming.publisher import publish_channel_event_to_members

__all__ = [
    "CALL_ENDED",
    "CALL_HOST_CHANGED",
    "CALL_PARTICIPANT_JOINED",
    "CALL_PARTICIPANT_LEFT",
    "CALL_PARTICIPANT_STATE",
    "CALL_RING",
    "CALL_STARTED",
    "CallChat",
    "SenderInfo",
    "build_call_host_changed_payload",
    "build_call_lifecycle_payload",
    "build_call_participant_payload",
    "build_call_ring_payload",
]


class CallChat:
    def __init__(
        self,
        session: AsyncSession,
        *,
        storage: ObjectStorage | None = None,
        search_indexer: SearchIndexer | None = None,
    ) -> None:
        self.session = session
        self.storage = storage
        self.search_indexer = search_indexer
        self._senders = SenderResolver(session)

    async def resolve_profiles(self, user_ids: list[UUID]) -> dict[UUID, SenderInfo]:
        return await self._senders.resolve_many([(SenderType.USER, user_id) for user_id in user_ids])

    async def resolve_profile(self, user_id: UUID) -> SenderInfo:
        return await self._senders.resolve_one(SenderType.USER, user_id)

    async def member_user_ids(self, channel_id: UUID) -> list[UUID]:
        members = await fetch_channel_members(self.session, channel_id)
        ids: list[UUID] = []
        for member in members:
            if member.get("subject_type") != SubjectType.USER.value:
                continue
            user_id = member.get("user_id")
            if not user_id:
                continue
            try:
                ids.append(UUID(user_id))
            except ValueError:
                continue
        return ids

    async def publish(
        self,
        member_ids: list[UUID],
        event_type: str,
        payload: dict,
        *,
        channel_id: UUID | None = None,
    ) -> None:
        await publish_channel_event_to_members(
            member_ids,
            event_type,
            payload,
            channel_id=channel_id,
        )

    async def post_system_message(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        content: str,
        kind: ChatMessageMetadataKind,
    ) -> None:
        await ChatMessageOperations(
            self.session,
            storage=self.storage,
            search_indexer=self.search_indexer,
        ).send_message(
            user_id=user_id,
            organization_id=organization_id,
            channel_id=channel_id,
            content=content,
            message_metadata={"kind": kind.value},
            sender_type=SenderType.SYSTEM,
        )
