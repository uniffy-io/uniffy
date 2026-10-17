"""Realtime audience of a project."""

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.converters.common_proto import content_type_to_proto
from uniffy.core.events.realtime import ContentAccessAction, publish_content_access_changed
from uniffy.core.models.projects.project import Project
from uniffy.core.types import ContentType
from uniffy.domains.permissions.access import ResourceAudienceResolver

logger = logger.bind(component="projects.audience")


async def publish_project_access(
    session: AsyncSession, project: Project, action: ContentAccessAction
) -> None:
    """Keeps private project ids off the org-wide channel."""
    await publish_content_access_changed(
        content_type=content_type_to_proto(ContentType.PROJECT),
        content_id=project.id,
        action=action,
        organization_id=project.organization_id,
        target_user_ids=await ResourceAudienceResolver(session).fanout_audience(
            organization_id=project.organization_id,
            content_type=ContentType.PROJECT,
            content_id=project.id,
            owner_id=project.owner_id,
            access_mode=project.access_mode,
            baseline_role=project.baseline_role,
        ),
    )


async def publish_views_changed(session: AsyncSession, project: Project) -> None:
    """Runs after commit; a failed publish leaves clients to refetch on their next load."""
    try:
        await publish_project_access(session, project, ContentAccessAction.VIEWS_CHANGED)
    except Exception:
        logger.opt(exception=True).warning(
            "Publishing a project view change failed", project_id=str(project.id)
        )
