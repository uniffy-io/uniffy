"""Domain-admin check helpers used by per-domain access checkers."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.cache import get_or_load_domain_admin
from uniffy.core.types import DomainType

# DomainAdmin is imported lazily inside functions to avoid a circular import
# with core.models package initialization.


async def is_domain_admin(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
    domain: DomainType,
) -> bool:
    """Wrapped in the Valkey-backed perm cache so repeated probes skip the PG round-trip."""

    async def _load() -> bool:
        from uniffy.core.models.permissions.domain_admin import DomainAdmin

        result = await session.execute(
            select(DomainAdmin.id).where(
                DomainAdmin.user_id == user_id,
                DomainAdmin.organization_id == organization_id,
                DomainAdmin.domain == domain,
            )
        )
        return result.scalar_one_or_none() is not None

    return await get_or_load_domain_admin(organization_id, user_id, domain, _load)


async def get_user_domain_admins(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
) -> list[DomainType]:
    """Return every domain where the user is a domain admin."""
    from uniffy.core.models.permissions.domain_admin import DomainAdmin

    result = await session.execute(
        select(DomainAdmin.domain).where(
            DomainAdmin.user_id == user_id,
            DomainAdmin.organization_id == organization_id,
        )
    )
    return [row[0] for row in result.all()]
