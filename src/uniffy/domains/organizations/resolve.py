"""Find which of the caller's organizations holds a content item, so a client can offer a switch."""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.content.references import parse_urn
from uniffy.core.content.registry import find_content_loader
from uniffy.core.models import Organization
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.domains.permissions.access import (
    ResourceAccessPurpose,
    ResourceAccessResolver,
    ResourceKey,
    ResourceRowState,
)


async def resolve_content_organization(
    session: AsyncSession,
    user_id: UUID,
    urn: str,
) -> tuple[Organization, OrganizationMember] | None:
    """Probes only the caller's active memberships, so a miss never reveals another tenant's rows."""
    parsed = parse_urn(urn)
    if parsed is None:
        return None
    content_type, content_id = parsed
    loader = find_content_loader(content_type)
    if loader is None:
        return None

    memberships = await OrganizationOperations(session).get_user_organizations(user_id)
    for organization, membership in memberships:
        if organization.is_suspended:
            continue
        if await loader(session, organization.id, content_id) is None:
            continue
        # Content ids are global, so the first organization holding the row is the only one.
        # The resource resolver decides view because tasks inherit their project's policy and
        # attachment copies their parent's, which the row's own columns do not carry.
        key = ResourceKey(content_type, content_id)
        decision = (
            await ResourceAccessResolver(session).resolve(
                actor_id=user_id,
                organization_id=organization.id,
                keys=[key],
                purpose=ResourceAccessPurpose.REFERENCE,
            )
        )[key]
        if decision.row_state == ResourceRowState.LIVE and decision.can_view:
            return organization, membership
        return None
    return None
