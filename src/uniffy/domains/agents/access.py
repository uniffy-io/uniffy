"""Builder gate: org admins and AGENTS domain admins manage the org-wide agent surface."""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.domain_admin import is_domain_admin
from uniffy.core.auth.membership import get_active_membership
from uniffy.core.errors import PermissionDeniedError
from uniffy.core.models.login.organization_member import OrganizationRole
from uniffy.core.types import DomainType


async def is_org_admin(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
) -> bool:
    membership = await get_active_membership(session, user_id, organization_id)
    role = membership.role if membership is not None else None
    return role in (OrganizationRole.ADMIN, OrganizationRole.OWNER)


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
