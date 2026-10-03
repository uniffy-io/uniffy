"""The actor's role on a loaded content row, as its owning domain resolves it."""

from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.content.registry import find_role_resolver
from uniffy.core.types import ContentRole, ContentType


async def resolve_content_role(
    session: AsyncSession,
    *,
    user_id: UUID,
    organization_id: UUID,
    content_type: ContentType,
    content_id: UUID,
    content: Any,
    checker: PermissionChecker | None = None,
) -> ContentRole | None:
    """A registered resolver wins, for content that also derives access from a container.

    Sharing surfaces (members, access requests, the policy the dialog renders) must
    agree with what the domain itself grants, so they all resolve through here.
    """
    resolver = find_role_resolver(content_type)
    if resolver is not None:
        return await resolver(session, user_id, organization_id, content)
    return await (checker or PermissionChecker(session)).effective_role(
        user_id=user_id,
        organization_id=organization_id,
        content_type=content_type,
        content_id=content_id,
        owner_id=content.owner_id,
        access_mode=content.access_mode,
        baseline_role=content.baseline_role,
    )
