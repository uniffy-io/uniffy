"""Domain-admin check helpers used by per-domain access checkers."""

from typing import Any
from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import Select

from uniffy.core.types import DomainType

# DomainAdmin is imported lazily inside functions to avoid a circular import
# with core.models package initialization.


def _active_membership_join(stmt: Select[Any]) -> Select[Any]:
    """Keep the domain grant conditional on a fully active organization identity."""
    from uniffy.core.models.login.organization import Organization
    from uniffy.core.models.login.organization_member import OrganizationMember
    from uniffy.core.models.login.user import User
    from uniffy.core.models.permissions.domain_admin import DomainAdmin

    return (
        stmt
        .join(
            OrganizationMember,
            and_(
                OrganizationMember.user_id == DomainAdmin.user_id,
                OrganizationMember.organization_id == DomainAdmin.organization_id,
            ),
        )
        .join(User, User.id == OrganizationMember.user_id)
        .join(Organization, Organization.id == OrganizationMember.organization_id)
        .where(
            OrganizationMember.is_active.is_(True),
            User.is_active.is_(True),
            Organization.deleted_at.is_(None),
            Organization.is_suspended.is_(False),
        )
    )


async def is_domain_admin(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
    domain: DomainType,
) -> bool:
    from uniffy.core.models.permissions.domain_admin import DomainAdmin

    result = await session.execute(
        _active_membership_join(select(DomainAdmin.id)).where(
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
    """Return every domain where the user is a domain admin."""
    from uniffy.core.models.permissions.domain_admin import DomainAdmin

    result = await session.execute(
        _active_membership_join(select(DomainAdmin.domain)).where(
            DomainAdmin.user_id == user_id,
            DomainAdmin.organization_id == organization_id,
        )
    )
    return [row[0] for row in result.all()]
