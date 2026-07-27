"""Builder gate: org admins and AGENTS domain admins manage the org-wide agent surface."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.cache import get_or_load_org_admin
from uniffy.core.auth.domain_admin import is_domain_admin
from uniffy.core.errors import PermissionDeniedError
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.types import DomainType


async def is_org_admin(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
) -> bool:
    async def _load() -> bool:
        result = await session.execute(
            select(OrganizationMember.role).where(
                OrganizationMember.user_id == user_id,
                OrganizationMember.organization_id == organization_id,
                OrganizationMember.is_active == True,  # noqa: E712
            )
        )
        role = result.scalar_one_or_none()
        return role in (OrganizationRole.ADMIN, OrganizationRole.OWNER)

    return await get_or_load_org_admin(organization_id, user_id, _load)


async def is_agents_builder(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
) -> bool:
    if await is_org_admin(session, user_id, organization_id):
        return True
    return await is_domain_admin(session, user_id, organization_id, DomainType.AGENTS)


async def require_agents_builder(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
) -> None:
    if not await is_agents_builder(session, user_id, organization_id):
        raise PermissionDeniedError("Requires agents builder privileges")
