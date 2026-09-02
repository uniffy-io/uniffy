"""PostgreSQL-authoritative active organization membership checks."""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

if TYPE_CHECKING:
    from uniffy.core.models.login.organization_member import OrganizationMember


async def get_active_membership(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
) -> OrganizationMember | None:
    from uniffy.core.models.login.organization import Organization
    from uniffy.core.models.login.organization_member import OrganizationMember
    from uniffy.core.models.login.user import User

    return (
        await session.execute(
            select(OrganizationMember)
            .join(User, User.id == OrganizationMember.user_id)
            .join(Organization, Organization.id == OrganizationMember.organization_id)
            .where(
                OrganizationMember.user_id == user_id,
                OrganizationMember.organization_id == organization_id,
                OrganizationMember.is_active.is_(True),
                User.is_active.is_(True),
                Organization.deleted_at.is_(None),
                Organization.is_suspended.is_(False),
            )
        )
    ).scalar_one_or_none()


async def is_active_member(
    user_id: UUID,
    organization_id: UUID,
    session: AsyncSession | None = None,
) -> bool:
    if session is not None:
        return await get_active_membership(session, user_id, organization_id) is not None

    from uniffy.infrastructure.database import open_session

    async with open_session() as owned:
        return await get_active_membership(owned, user_id, organization_id) is not None
