"""Chat-domain feature flags sourced from Organization.settings.

Organization.settings is a JSONB column without schema. We nest chat-specific
flags under the "chat" key so keys don't collide with other domains that may
start using the blob. Missing keys / missing blobs default to False -- never
fail open.
"""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.login.organization import Organization


def is_chat_agents_enabled_on(org: Organization) -> bool:
    """Return True iff org has opted into the agents-in-chat integration.

    Source of truth: `org.settings["chat"]["agents_enabled"]`. Any level of
    the path may be missing; all missing paths return False.
    """
    settings = org.settings or {}
    chat = settings.get("chat") or {}
    return bool(chat.get("agents_enabled", False))


async def is_chat_agents_enabled(session: AsyncSession, organization_id: UUID) -> bool:
    """Session-backed variant: resolves the flag by org id in one query.

    Use this from operations/handlers that don't already have the Organization
    loaded. Returns False when the org row is missing.
    """
    result = await session.execute(
        select(Organization.settings).where(Organization.id == organization_id)
    )
    row = result.scalar_one_or_none()
    if row is None:
        return False
    chat = (row or {}).get("chat") or {}
    return bool(chat.get("agents_enabled", False))
