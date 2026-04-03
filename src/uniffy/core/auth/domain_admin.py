"""Domain admin check helpers.

Provides async functions to check if a user is a domain admin
for a given domain in an organization. These are the canonical
checks used by all domain-specific access checkers.
"""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.permissions.domain_admin import DomainAdmin
from uniffy.core.models.shared import DomainType


async def is_domain_admin(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
    domain: DomainType,
) -> bool:
    """
    Check if user is a domain admin for the given domain.

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
    result = await session.execute(
        select(DomainAdmin.id).where(
            DomainAdmin.user_id == user_id,
            DomainAdmin.organization_id == organization_id,
            DomainAdmin.domain == domain,
        )
    )
    return result.scalar_one_or_none() is not None


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
    result = await session.execute(
        select(DomainAdmin.domain).where(
            DomainAdmin.user_id == user_id,
            DomainAdmin.organization_id == organization_id,
        )
    )
    return [row[0] for row in result.all()]
