"""Domain admin check helpers.

Provides async functions to check if a user is a domain admin
for a given domain in an organization. These are the canonical
checks used by all domain-specific access checkers.
"""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.cache import get_or_load_domain_admin
from uniffy.core.types import DomainType

# Lazy import inside functions to avoid circular dependency with
# core.models package initialization.


async def is_domain_admin(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
    domain: DomainType,
) -> bool:
    """
    Check if user is a domain admin for the given domain.

    Wrapped in the Valkey-backed perm cache (TTL 600s) so repeated
    domain-admin probes across requests skip the PG round-trip. The
    cache is invalidated on group-membership changes and on the
    organization-side admin grant/revoke operations.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    user_id : UUID
        User to check.
    organization_id : UUID
        Organization context.
    domain : DomainType
        Domain to check (CHAT, FILES, etc.).

    Returns
    -------
    bool
        True if the user has a domain admin row for this domain.

    """

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
    """
    Get all domains where the user is a domain admin.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    user_id : UUID
        User to check.
    organization_id : UUID
        Organization context.

    Returns
    -------
    list[DomainType]
        List of domains where the user is admin.

    """
    from uniffy.core.models.permissions.domain_admin import DomainAdmin

    result = await session.execute(
        select(DomainAdmin.domain).where(
            DomainAdmin.user_id == user_id,
            DomainAdmin.organization_id == organization_id,
        )
    )
    return [row[0] for row in result.all()]
