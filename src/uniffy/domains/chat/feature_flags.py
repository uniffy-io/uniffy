"""Chat-domain feature flags sourced from Organization.settings; missing keys default False."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.login.organization import Organization


def is_chat_agents_enabled_on(org: Organization) -> bool:
    """Org has opted into the agents-in-chat integration (org.settings['chat']['agents_enabled'])."""
    settings = org.settings or {}
    chat = settings.get("chat") or {}
    return bool(chat.get("agents_enabled", False))


async def is_chat_agents_enabled(session: AsyncSession, organization_id: UUID) -> bool:
    """Session-backed variant; resolves the flag by org id in one query."""
    result = await session.execute(
        select(Organization.settings).where(Organization.id == organization_id)
    )
    row = result.scalar_one_or_none()
    if row is None:
        return False
    chat = (row or {}).get("chat") or {}
    return bool(chat.get("agents_enabled", False))
