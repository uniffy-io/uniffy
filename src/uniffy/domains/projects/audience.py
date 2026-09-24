"""Realtime audience of a project."""

from uuid import UUID

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions.defaults import (
    resolve_content_defaults,
    resolve_effective_policy,
)
from uniffy.core.converters.common_proto import content_type_to_proto
from uniffy.core.events.realtime import ContentAccessAction, publish_content_access_changed
from uniffy.core.models.projects.project import Project
from uniffy.core.types import AccessMode, ContentType
from uniffy.domains.permissions.access import ResourceAudienceResolver

logger = logger.bind(component="projects.audience")


async def resolve_project_audience(
    session: AsyncSession,
    organization_id: UUID,
    project: Project,
) -> list[UUID] | None:
    """Keep private project ids off the org-wide channel."""
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


async def publish_views_changed(session: AsyncSession, project: Project) -> None:
    """Runs after commit; a failed publish leaves clients to refetch on their next load."""
    try:
        audience = await resolve_project_audience(session, project.organization_id, project)
        await publish_content_access_changed(
            content_type=content_type_to_proto(ContentType.PROJECT),
            content_id=project.id,
            action=ContentAccessAction.VIEWS_CHANGED,
            organization_id=project.organization_id,
            target_user_ids=audience,
        )
    except Exception:
        logger.opt(exception=True).warning(
            "Publishing a project view change failed", project_id=str(project.id)
        )
