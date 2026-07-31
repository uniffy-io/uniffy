"""Domain-admin check helpers used by per-domain access checkers."""

from typing import Any
from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import Select

from uniffy.core.auth.cache import get_or_load_domain_admin
from uniffy.core.types import DomainType

# DomainAdmin is imported lazily inside functions to avoid a circular import
# with core.models package initialization.


def _active_membership_join(stmt: Select[Any]) -> Select[Any]:
    """Domain powers follow org membership: a deactivated member keeps the
    DomainAdmin row but loses the grant. Joined rather than pre-checked so the
    cache-miss path stays a single round-trip.
    """
    from uniffy.core.models.login.organization_member import OrganizationMember
    from uniffy.core.models.permissions.domain_admin import DomainAdmin

    return stmt.join(
        OrganizationMember,
        and_(
            OrganizationMember.user_id == DomainAdmin.user_id,
            OrganizationMember.organization_id == DomainAdmin.organization_id,
        ),
    ).where(OrganizationMember.is_active == True)  # noqa: E712


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
            _active_membership_join(select(DomainAdmin.id)).where(
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
        _active_membership_join(select(DomainAdmin.domain)).where(
            DomainAdmin.user_id == user_id,
            DomainAdmin.organization_id == organization_id,
        )
    )
    return [row[0] for row in result.all()]
