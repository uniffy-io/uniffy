"""Agent assignees on tasks and projects: who may hand work to which agent."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.auth.acting_agent import current_acting_agent
from uniffy.core.errors import ValidationError
from uniffy.core.events.realtime import publish_content_changed
from uniffy.core.models.agents.task_assignment import (
    OPEN_ASSIGNMENT_STATUSES,
    TaskAssignmentReason,
)
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.projects.activity import TaskActivityAction
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.task import Task
from uniffy.core.types import ContentType
from uniffy.domains.agents.tasks.admission import (
    START_NOW,
    RunStart,
    StagedAssignment,
    after_commit,
    lock_task_assignments,
    read_current_assignment,
    require_budget_headroom,
    require_usable_agent,
    stage_follow_up,
    stage_start,
    stage_stop,
    stage_task_assignment,
    stage_unassign,
)
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.domains.projects.agents.policy import (
    ResolvedAgentPolicy,
    load_agent_policy,
    require_agent_assignment_enabled,
    save_agent_policy,
)
from uniffy.domains.projects.projects import ProjectOperations
from uniffy.domains.projects.tasks.notifications import TaskNotifications
from uniffy.domains.projects.tasks.reader import TaskReader


class TaskAgentOperations:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def assign(
        self,
        user_id: UUID,
        organization_id: UUID,
        task_id: UUID,
        agent_id: UUID | None,
        start: RunStart = START_NOW,
    ) -> Task:
        """Hand the task to an agent (or take it back); EDIT on the task and use of the agent."""
        task = await self._editable_task(user_id, organization_id, task_id)
        if agent_id is not None:
            await self._require_can_run(user_id, organization_id, agent_id)

        await lock_task_assignments(self.session, organization_id, task_id)
        current = await read_current_assignment(self.session, organization_id, task_id)
        if (
            agent_id is not None
            and current is not None
            and current.agent_id == agent_id
            and current.status in OPEN_ASSIGNMENT_STATUSES
        ):
            return task
        if agent_id is None and current is None:
            return task

        staged: StagedAssignment
        if agent_id is None:
            staged = await stage_unassign(
                self.session, organization_id=organization_id, task_id=task_id
            )
        else:
            staged = await stage_task_assignment(
                self.session,
                organization_id=organization_id,
                task_id=task_id,
                agent_id=agent_id,
                assigned_by=user_id,
                reason=TaskAssignmentReason.TASK,
                start=start,
            )

        notifications = TaskNotifications(self.session)
        if staged.previous_agent_id is not None and staged.previous_agent_id != agent_id:
            await notifications.log_activity(
                task_id,
                user_id,
                TaskActivityAction.AGENT_UNASSIGNED,
                previous_value=str(staged.previous_agent_id),
            )
        if agent_id is not None:
            await notifications.log_activity(
                task_id,
                user_id,
                TaskActivityAction.AGENT_ASSIGNED,
                previous_value=str(staged.previous_agent_id) if staged.previous_agent_id else None,
                new_value=str(agent_id),
            )
        await write_audit_event(
            self.session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=Action.TASK_AGENT_ASSIGNED if agent_id else Action.TASK_AGENT_UNASSIGNED,
            resource_type=AuditResourceType.TASK,
            resource_id=task_id,
            details={
                "agent_id": str(agent_id) if agent_id else None,
                "previous_agent_id": (
                    str(staged.previous_agent_id) if staged.previous_agent_id else None
                ),
                "start": start.mode.value,
            },
        )
        return await self._commit(organization_id, task, staged)

    async def start(self, user_id: UUID, organization_id: UUID, task_id: UUID) -> Task:
        """Start a waiting or scheduled run now; it runs as the person who starts it."""
        task = await self._editable_task(user_id, organization_id, task_id)
        await lock_task_assignments(self.session, organization_id, task_id)
        current = await read_current_assignment(self.session, organization_id, task_id)
        if current is None:
            raise ValidationError("task_id", "No agent is assigned to this task")
        await self._require_can_run(user_id, organization_id, current.agent_id)
        staged = await stage_start(
            self.session, organization_id=organization_id, task_id=task_id, started_by=user_id
        )
        await self._audit(user_id, organization_id, task_id, Action.TASK_AGENT_STARTED, {})
        return await self._commit(organization_id, task, staged)

    async def stop(self, user_id: UUID, organization_id: UUID, task_id: UUID) -> Task:
        """Stop the run and keep the agent on the task, so it can run again later."""
        task = await self._editable_task(user_id, organization_id, task_id)
        staged = await stage_stop(self.session, organization_id=organization_id, task_id=task_id)
        await self._audit(user_id, organization_id, task_id, Action.TASK_AGENT_STOPPED, {})
        return await self._commit(organization_id, task, staged)

    async def request_changes(
        self, user_id: UUID, organization_id: UUID, task_id: UUID, changes: str
    ) -> Task:
        """Continue the ended run's session with the changes its owner asks for."""
        task = await self._editable_task(user_id, organization_id, task_id)
        await lock_task_assignments(self.session, organization_id, task_id)
        current = await read_current_assignment(self.session, organization_id, task_id)
        if current is None:
            raise ValidationError("task_id", "No agent is assigned to this task")
        await self._require_can_run(user_id, organization_id, current.agent_id)
        staged = await stage_follow_up(
            self.session,
            organization_id=organization_id,
            task_id=task_id,
            requested_by=user_id,
            changes=changes,
        )
        # The text stays in the session; the audit trail records that it happened, not what.
        await self._audit(
            user_id,
            organization_id,
            task_id,
            Action.TASK_AGENT_CHANGES_REQUESTED,
            {"agent_id": str(current.agent_id)},
        )
        return await self._commit(organization_id, task, staged)

    async def _editable_task(self, user_id: UUID, organization_id: UUID, task_id: UUID) -> Task:
        if current_acting_agent() is not None:
            raise ValidationError("agent_id", "Agents cannot assign tasks to agents")
        return await TaskReader(self.session).get_for_edit(user_id, organization_id, task_id)

    async def _require_can_run(self, user_id: UUID, organization_id: UUID, agent_id: UUID) -> None:
        require_agent_assignment_enabled(await load_agent_policy(self.session, organization_id))
        await require_usable_agent(self.session, user_id, organization_id, agent_id)
        await require_budget_headroom(self.session, user_id, organization_id)

    async def _audit(
        self,
        user_id: UUID,
        organization_id: UUID,
        task_id: UUID,
        action: Action,
        details: dict[str, str | None],
    ) -> None:
        await write_audit_event(
            self.session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=action,
            resource_type=AuditResourceType.TASK,
            resource_id=task_id,
            details=details,
        )

    async def _commit(self, organization_id: UUID, task: Task, staged: StagedAssignment) -> Task:
        task_id = task.id
        await self.session.commit()
        await after_commit([staged])
        await publish_content_changed(ContentType.TASK, task_id, organization_id)
        await self.session.refresh(task)
        return task


class ProjectAgentOperations:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def set_agent_assignee(
        self,
        user_id: UUID,
        organization_id: UUID,
        project_id: UUID,
        agent_id: UUID | None,
    ) -> Project:
        """Project managers choose the agent that picks up new tasks."""
        if current_acting_agent() is not None:
            raise ValidationError("agent_id", "Agents cannot choose a project's agent")
        projects = ProjectOperations(self.session)
        project = await projects.get_for_view_mutation(user_id, organization_id, project_id)
        await projects._require_manage(user_id, organization_id, project)
        if agent_id is not None:
            require_agent_assignment_enabled(await load_agent_policy(self.session, organization_id))
            await require_usable_agent(self.session, user_id, organization_id, agent_id)
        previous = project.agent_assignee_id
        if previous == agent_id:
            return project
        project.agent_assignee_id = agent_id
        project.agent_assignee_set_by = user_id if agent_id else None
        project.agent_assignee_set_at = datetime.now(UTC) if agent_id else None
        project.version += 1
        project.updated_at = datetime.now(UTC)
        await write_audit_event(
            self.session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=Action.PROJECT_AGENT_ASSIGNEE_CHANGED,
            resource_type=AuditResourceType.PROJECT,
            resource_id=project_id,
            details={
                "agent_id": str(agent_id) if agent_id else None,
                "previous_agent_id": str(previous) if previous else None,
            },
        )
        await self.session.commit()
        await self.session.refresh(project)
        await publish_content_changed(ContentType.PROJECT, project_id, organization_id)
        return project


async def read_agent_policy(
    session: AsyncSession, user_id: UUID, organization_id: UUID
) -> ResolvedAgentPolicy:
    await OrganizationOperations(session).require_org_member(user_id, organization_id)
    return await load_agent_policy(session, organization_id)


async def update_agent_policy(
    session: AsyncSession, user_id: UUID, organization_id: UUID, *, enabled: bool
) -> ResolvedAgentPolicy:
    await OrganizationOperations(session).require_org_admin(user_id, organization_id)
    policy = ResolvedAgentPolicy(organization_id=organization_id, agent_assignment_enabled=enabled)
    await save_agent_policy(session, policy=policy, updated_by_user_id=user_id)
    await write_audit_event(
        session,
        organization_id=organization_id,
        actor_user_id=user_id,
        action=Action.AGENT_ASSIGNMENT_POLICY_UPDATED,
        resource_type=AuditResourceType.ORGANIZATION,
        resource_id=organization_id,
        details={"agent_assignment_enabled": enabled},
    )
    await session.commit()
    return policy
