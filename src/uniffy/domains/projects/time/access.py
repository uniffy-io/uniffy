"""Gates for time records.

Worklogs, timers and timesheets are member-record data, like people profiles:
they carry no access mode and never enter the content path. A task's entries are
readable by whoever can view the task; a person's entries across tasks are readable
by that person, their reviewers (manager from the people profile, lead of any TEAM
they belong to) and timekeeping admins (org admins and PROJECTS domain admins).
"""

from __future__ import annotations

from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.domain_admin import is_domain_admin
from uniffy.core.auth.membership import get_active_membership
from uniffy.core.errors import PermissionDeniedError, ValidationError
from uniffy.core.models.login.group import Group, GroupKind
from uniffy.core.models.login.group_member import GroupMember
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.login.user import User
from uniffy.core.models.people.profile import PeopleProfile
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.task import Task
from uniffy.core.types import DomainType
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.domains.projects.projects import ProjectOperations
from uniffy.domains.projects.tasks.content import TaskContentOperations

logger = logger.bind(component="projects.time.access")


class TimeAccess:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def is_timekeeping_admin(self, user_id: UUID, organization_id: UUID) -> bool:
        try:
            await OrganizationOperations(self.session).require_org_admin(user_id, organization_id)
        except PermissionDeniedError:
            return await is_domain_admin(self.session, user_id, organization_id, DomainType.PROJECTS)
        return True

    async def require_timekeeping_admin(self, user_id: UUID, organization_id: UUID) -> None:
        if not await self.is_timekeeping_admin(user_id, organization_id):
            raise PermissionDeniedError("manage time tracking")

    async def require_active_member(self, user_id: UUID, organization_id: UUID) -> None:
        """For a subject named in a request; the actor's own membership is a permission matter."""
        if await get_active_membership(self.session, user_id, organization_id) is None:
            raise ValidationError("user_id", "not an active member of this organization")

    async def require_active_actor(self, actor_id: UUID, organization_id: UUID) -> None:
        if await get_active_membership(self.session, actor_id, organization_id) is None:
            raise PermissionDeniedError("act in this organization")

    async def reviewers_of(self, organization_id: UUID, subject_id: UUID) -> set[UUID]:
        """Manager plus every TEAM lead, minus the person, active members only; one query."""
        manager = select(PeopleProfile.manager_user_id.label("reviewer_id")).where(
            PeopleProfile.organization_id == organization_id,
            PeopleProfile.user_id == subject_id,
            PeopleProfile.manager_user_id.is_not(None),
        )
        leads = (
            select(Group.lead_user_id.label("reviewer_id"))
            .join(GroupMember, GroupMember.group_id == Group.id)
            .where(
                Group.organization_id == organization_id,
                Group.kind == GroupKind.TEAM,
                Group.lead_user_id.is_not(None),
                GroupMember.user_id == subject_id,
                GroupMember.is_active.is_(True),
            )
        )
        candidates = manager.union(leads).subquery()
        result = await self.session.execute(
            select(OrganizationMember.user_id)
            .join(User, User.id == OrganizationMember.user_id)
            .where(
                OrganizationMember.organization_id == organization_id,
                OrganizationMember.is_active.is_(True),
                User.is_active.is_(True),
                OrganizationMember.user_id != subject_id,
                OrganizationMember.user_id.in_(select(candidates.c.reviewer_id)),
            )
        )
        return {row[0] for row in result.all()}

    async def is_reviewer_of(self, actor_id: UUID, organization_id: UUID, subject_id: UUID) -> bool:
        """True for a named reviewer; when nobody is named, timekeeping admins review."""
        reviewers = await self.reviewers_of(organization_id, subject_id)
        if reviewers:
            return actor_id in reviewers
        return await self.is_timekeeping_admin(actor_id, organization_id)

    async def require_person_scope(
        self, actor_id: UUID, organization_id: UUID, subject_id: UUID
    ) -> None:
        """Self or a reviewer of the subject; admins review only people nobody else reviews."""
        await self.require_active_actor(actor_id, organization_id)
        if actor_id == subject_id:
            return
        if await self.is_reviewer_of(actor_id, organization_id, subject_id):
            return
        raise PermissionDeniedError("view another person's time records")

    async def require_task_view(self, actor_id: UUID, organization_id: UUID, task_id: UUID) -> Task:
        return await TaskContentOperations(self.session).get_by_id(
            actor_id, organization_id, task_id
        )

    async def require_project_view(
        self, actor_id: UUID, organization_id: UUID, project_id: UUID
    ) -> Project:
        return await ProjectOperations(self.session).get_by_id(actor_id, organization_id, project_id)
