"""Chat-domain feature flags, backed by the org chat policy blob."""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.domains.chat.policy import resolve_chat_policy


async def is_chat_agents_enabled(session: AsyncSession, organization_id: UUID) -> bool:
    """Org has the agents-in-chat integration switched on."""
    policy = await resolve_chat_policy(session, organization_id)
    return policy.agents_enabled
