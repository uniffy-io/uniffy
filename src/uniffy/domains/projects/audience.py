"""Realtime audience of a project."""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions.defaults import (
    resolve_content_defaults,
    resolve_effective_policy,
)
from uniffy.core.models.projects.project import Project
from uniffy.core.types import AccessMode, ContentType
from uniffy.domains.permissions.access import ResourceAudienceResolver


async def resolve_project_audience(
    session: AsyncSession,
    organization_id: UUID,
    project: Project,
) -> list[UUID] | None:
    """User ids that can view ``project``, or ``None`` for an org-wide broadcast when it is
    OPEN_TO_ORG.

    Targeting members directly keeps a private project's id off the org-wide channel;
    OPEN_TO_ORG projects are visible to everyone anyway.
    """
    default_mode, default_baseline = await resolve_content_defaults(
        session,
        organization_id,
        ContentType.PROJECT,
    )
    effective_mode, _ = resolve_effective_policy(
        project.access_mode,
        project.baseline_role,
        default_mode,
        default_baseline,
    )
    if effective_mode == AccessMode.OPEN_TO_ORG:
        return None

    return await ResourceAudienceResolver(session).standard_audience(
        organization_id=organization_id,
        content_type=ContentType.PROJECT,
        content_id=project.id,
        owner_id=project.owner_id,
        access_mode=project.access_mode,
        baseline_role=project.baseline_role,
    )
