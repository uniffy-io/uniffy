"""Durable scheduling for task search ACL refreshes."""

from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.jobs import enqueue_job
from uniffy.core.models.projects.search_acl_refresh import ProjectSearchAclRefresh
from uniffy.domains.projects.jobs.contracts import REFRESH_PROJECT_SEARCH_ACL

logger = logger.bind(component="projects.search.access")


async def record_project_search_acl_refresh(
    session: AsyncSession,
    organization_id: UUID,
    project_id: UUID,
) -> None:
    stmt = (
        pg_insert(ProjectSearchAclRefresh)
        .values(
            project_id=project_id,
            organization_id=organization_id,
            version=1,
            attempts=0,
            created_at=datetime.now(UTC),
        )
        .on_conflict_do_update(
            index_elements=["project_id"],
            set_={
                "organization_id": organization_id,
                "version": ProjectSearchAclRefresh.version + 1,
                "attempts": 0,
                "created_at": datetime.now(UTC),
            },
        )
    )
    await session.execute(stmt)


async def enqueue_project_search_acl_refresh(project_id: UUID) -> None:
    try:
        await enqueue_job(REFRESH_PROJECT_SEARCH_ACL, str(project_id))
    except RuntimeError:
        logger.warning(f"Search ACL refresh queued in DB only for project {project_id}")
    except Exception:
        logger.opt(exception=True).warning(
            f"Failed to enqueue search ACL refresh for project {project_id}"
        )
