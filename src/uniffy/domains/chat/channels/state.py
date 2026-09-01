"""Staged chat channel transaction facts."""

from dataclasses import dataclass
from uuid import UUID

from uniffy.core.models.chat.channel import ChatChannel
from uniffy.core.models.chat.channel_member import ChatChannelMember


@dataclass(frozen=True)
class StagedChatMembersAdd:
    channel: ChatChannel
    actor_user_id: UUID
    organization_id: UUID
    added: tuple[ChatChannelMember, ...]


@dataclass(frozen=True)
class StagedChatMembersRemove:
    channel: ChatChannel
    actor_user_id: UUID
    organization_id: UUID
    removed_user_ids: tuple[UUID, ...]


@dataclass(frozen=True)
class StagedChatChannelCreate:
    channel: ChatChannel
    actor_user_id: UUID
    initial_member_ids: tuple[UUID, ...]
    tag_ids: tuple[UUID, ...] | None
