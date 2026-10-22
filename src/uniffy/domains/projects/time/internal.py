"""The organization's internal time project: standing tasks for time that belongs to no project."""

from __future__ import annotations

from dataclasses import dataclass, replace
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.projects.project import Project
from uniffy.core.realtime.buffer import UpdateBuffer
from uniffy.core.search import SearchIndexer
from uniffy.core.storage import ObjectStorage
from uniffy.core.types import AccessMode, ContentRole
from uniffy.domains.projects.projects import ProjectOperations
from uniffy.domains.projects.tasks.operations import TaskOperations
from uniffy.domains.projects.time.access import TimeAccess
from uniffy.domains.projects.time.policy import (
    ResolvedTimePolicy,
    load_time_policy,
    save_time_policy,
)

logger = logger.bind(component="projects.time.internal")

INTERNAL_PROJECT_NAME = "Internal"
INTERNAL_PROJECT_SLUG = "INT"
INTERNAL_PROJECT_DESCRIPTION = (
    "Standing tasks for time that belongs to no project: meetings, leave, training and the rest."
)
INTERNAL_PROJECT_ICON = "target"
INTERNAL_TASK_TITLES: tuple[str, ...] = (
    "Meetings",
    "Vacation",
    "Sick leave",
    "Training",
    "Support rotation",
    "Admin",
)


@dataclass(frozen=True)
class InternalProject:
    project: Project
    created: bool
    policy: ResolvedTimePolicy


class InternalProjectOperations:
    """Timekeeping admins create it once; a later call returns the project the policy names."""

    def __init__(
        self,
        session: AsyncSession,
        storage: ObjectStorage,
        search_indexer: SearchIndexer,
        buffer: UpdateBuffer,
    ) -> None:
        self.session = session
        self.storage = storage
        self.search_indexer = search_indexer
        self.buffer = buffer

    async def _live_project(self, organization_id: UUID, project_id: UUID) -> Project | None:
        result = await self.session.execute(
            select(Project).where(
                Project.id == project_id,
                Project.organization_id == organization_id,
                Project.is_deleted == False,  # noqa: E712
            )
        )
        return result.scalar_one_or_none()

    async def ensure(self, actor_id: UUID, organization_id: UUID) -> InternalProject:
        await TimeAccess(self.session).require_timekeeping_admin(actor_id, organization_id)
        policy = await load_time_policy(self.session, organization_id)
        if policy.internal_project_id is not None:
            existing = await self._live_project(organization_id, policy.internal_project_id)
            if existing is not None:
                return InternalProject(project=existing, created=False, policy=policy)

        # Each create commits on its own; a trashed or missing project is simply created afresh.
        project = await ProjectOperations(self.session, self.storage, self.search_indexer).create(
            actor_id,
            organization_id,
            INTERNAL_PROJECT_NAME,
            description=INTERNAL_PROJECT_DESCRIPTION,
            icon=INTERNAL_PROJECT_ICON,
            access_mode=AccessMode.OPEN_TO_ORG,
            baseline_role=ContentRole.EDITOR,
            slug=INTERNAL_PROJECT_SLUG,
        )
        task_ops = TaskOperations(self.session, self.storage, self.search_indexer, self.buffer)
        for title in INTERNAL_TASK_TITLES:
            await task_ops.create(actor_id, organization_id, project.id, title)

        updated = replace(policy, internal_project_id=project.id)
        await save_time_policy(self.session, policy=updated, updated_by_user_id=actor_id)
        await write_audit_event(
            self.session,
            organization_id=organization_id,
            actor_user_id=actor_id,
            action=Action.INTERNAL_TIME_PROJECT_CREATED,
            resource_type=AuditResourceType.PROJECT,
            resource_id=project.id,
            details={"slug": project.slug, "tasks": list(INTERNAL_TASK_TITLES)},
        )
        await self.session.commit()
        logger.info(f"Internal time project {project.slug} created for {organization_id}")
        return InternalProject(project=project, created=True, policy=updated)
