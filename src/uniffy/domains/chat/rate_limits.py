"""Environment-tunable per-user limits for chat mutations."""

import os
from dataclasses import dataclass
from uuid import UUID

from uniffy.core.valkey.rate_limit import check_rate_limit


@dataclass(frozen=True)
class ChatMutationLimit:
    env_name: str
    default_limit: int
    resource: str


SEND = ChatMutationLimit("CHAT_SEND_RATE_LIMIT", 60, "chat messages")
CHANNEL_CREATE = ChatMutationLimit("CHAT_CHANNEL_CREATE_RATE_LIMIT", 10, "chat creation")
MEMBER_ADD = ChatMutationLimit("CHAT_MEMBER_ADD_RATE_LIMIT", 30, "chat member additions")
REACTION_ADD = ChatMutationLimit("CHAT_REACTION_ADD_RATE_LIMIT", 120, "chat reactions")


def _positive_env_int(name: str, default: int) -> int:
    try:
        return max(1, int(os.getenv(name, str(default))))
    except ValueError:
        return default


async def check_chat_mutation_limit(
    limit: ChatMutationLimit,
    *,
    user_id: UUID,
    organization_id: UUID,
) -> None:
    window_seconds = _positive_env_int("CHAT_RATE_LIMIT_WINDOW_SECONDS", 60)
    await check_rate_limit(
        key=f"rl:chat:{limit.resource.replace(' ', '_')}:{organization_id}:{user_id}",
        limit=_positive_env_int(limit.env_name, limit.default_limit),
        window_seconds=window_seconds,
        resource=limit.resource,
    )
