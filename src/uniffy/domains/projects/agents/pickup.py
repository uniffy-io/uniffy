"""New tasks in a project with an agent assignee go to that agent."""

from uuid import UUID

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.acting_agent import current_acting_agent
from uniffy.core.errors import ValidationError
from uniffy.core.models.agents.task_assignment import TaskAssignmentReason
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.task import Task
from uniffy.domains.agents.tasks.admission import (
    StagedAssignment,
    require_budget_headroom,
    require_usable_agent,
    stage_task_assignment,
)
from uniffy.domains.projects.agents.policy import (
    load_agent_policy,
    require_agent_assignment_enabled,
)


async def stage_project_pickup(
    session: AsyncSession, *, task: Task, project: Project
) -> StagedAssignment | None:
    """Runs as the task's creator, never the person who chose the agent: that would let anyone
    who can create a task borrow the chooser's access. Agent-made tasks never trigger one."""
    if project.agent_assignee_id is None or current_acting_agent() is not None:
        return None
    policy = await load_agent_policy(session, task.organization_id)
    if not policy.agent_assignment_enabled:
        return None
    return await stage_task_assignment(
        session,
        organization_id=task.organization_id,
        task_id=task.id,
        agent_id=project.agent_assignee_id,
        assigned_by=task.owner_id,
        reason=TaskAssignmentReason.PROJECT,
    )


async def stage_new_task_agent(
    session: AsyncSession,
    *,
    task: Task,
    project: Project,
    user_id: UUID,
    agent_id: UUID | None,
    skip_project_agent: bool,
) -> tuple[StagedAssignment | None, UUID | None]:
    """The agent a new task starts with: the one its creator picked, or the project's."""
    if agent_id is None:
        if skip_project_agent:
            return None, None
        staged = await stage_project_pickup(session, task=task, project=project)
        return staged, project.agent_assignee_id if staged else None
    if current_acting_agent() is not None:
        raise ValidationError("agent_id", "Agents cannot assign tasks to agents")
    require_agent_assignment_enabled(await load_agent_policy(session, task.organization_id))
    await require_usable_agent(session, user_id, task.organization_id, agent_id)
    await require_budget_headroom(session, user_id, task.organization_id)
    staged = await stage_task_assignment(
        session,
        organization_id=task.organization_id,
        task_id=task.id,
        agent_id=agent_id,
        assigned_by=user_id,
        reason=TaskAssignmentReason.TASK,
    )
    return staged, agent_id


async def stage_clear_agent_assignee(
    session: AsyncSession, *, organization_id: UUID, agent_id: UUID
) -> None:
    """A deleted agent stops being any project's agent assignee."""
    await session.execute(
        update(Project)
        .where(Project.organization_id == organization_id, Project.agent_assignee_id == agent_id)
        .values(agent_assignee_id=None, agent_assignee_set_by=None, agent_assignee_set_at=None)
    )
