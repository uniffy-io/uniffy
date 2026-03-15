"""Business logic for agent cron task management."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from croniter import croniter
from sqlalchemy import func, select

from uniffy.core.content.base_operations import BaseContentOperations
from uniffy.core.errors import NotFoundError, ValidationError
from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.agents.cron_run_log import AgentCronRunLog
from uniffy.core.models.agents.cron_task import AgentCronTask
from uniffy.core.types import ContentType, VisibilityScope
from uniffy.core.valkey import get_queue
from uniffy.domains.agents.agents.operations import AgentOperations

MAX_CRON_TASKS_PER_USER = 20
MIN_INTERVAL_SECONDS = 300  # 5 minutes


class CronTaskOperations(BaseContentOperations[AgentCronTask]):
    """Operations for managing agent cron tasks.

    Extends BaseContentOperations to provide automatic 3-layer
    permission checking, search indexing, and soft-delete.

    Parameters
    ----------
    session : AsyncSession
        Database session.

    """

    content_type = ContentType.AGENT_CRON_TASK
    model_class = AgentCronTask

    def _build_search_keywords(self, model: AgentCronTask) -> str:
        """Build search keywords from task name and prompt.

        Parameters
        ----------
        model : AgentCronTask
            The cron task model.

        Returns
        -------
        str
            Keywords string for search indexing.

        """
        parts = [model.name]
        if model.description:
            parts.append(model.description[:300])
        if model.prompt:
            parts.append(model.prompt[:200])
        return " ".join(parts)

    def _get_search_title(self, model: AgentCronTask) -> str:
        """Get task name as search title.

        Parameters
        ----------
        model : AgentCronTask
            The cron task model.

        Returns
        -------
        str
            The task name.

        """
        return model.name

    def _get_url_path(self, model: AgentCronTask) -> str:
        """Get frontend URL path for the cron task.

        Parameters
        ----------
        model : AgentCronTask
            The cron task model.

        Returns
        -------
        str
            URL path.

        """
        return f"/agents/{model.agent_id}/cron/{model.id}"

    def _get_search_description(self, model: AgentCronTask) -> str | None:
        """Get task description for search results.

        Parameters
        ----------
        model : AgentCronTask
            The cron task model.

        Returns
        -------
        str | None
            First 200 chars of description, or None.

        """
        if model.description:
            return model.description[:200]
        return model.prompt[:200] if model.prompt else None

    async def create_cron_task(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        agent_id: UUID,
        name: str,
        prompt: str,
        cron_expression: str,
        timezone: str = "UTC",
        description: str = "",
        visibility: VisibilityScope = VisibilityScope.PRIVATE,
        group_ids: list[UUID] | None = None,
    ) -> AgentCronTask:
        """Create a scheduled agent task.

        Permission checks:
        1. User must be able to ACCESS the target agent (3-layer check)
        2. Per-user limit enforced (max 20 per org)
        3. Cron expression validated
        4. Minimum interval enforced (>= 5 minutes)

        Parameters
        ----------
        user_id : UUID
            The user creating the task.
        organization_id : UUID
            Organization context.
        agent_id : UUID
            Agent that will execute the task.
        name : str
            Human-readable task name.
        prompt : str
            Message sent to the agent on each execution.
        cron_expression : str
            5-field cron expression.
        timezone : str
            IANA timezone for schedule interpretation.
        description : str
            Optional longer description.
        visibility : VisibilityScope
            Content visibility scope.
        group_ids : list[UUID] | None
            Group IDs when visibility is GROUP.

        Returns
        -------
        AgentCronTask
            The created cron task.

        Raises
        ------
        ValidationError
            If validation fails (name, cron, timezone, limit).
        PermissionDeniedError
            If user cannot access the target agent.

        """
        if not name or not name.strip():
            raise ValidationError("name", "Task name cannot be empty")
        if not prompt or not prompt.strip():
            raise ValidationError("prompt", "Task prompt cannot be empty")

        # Verify user can access the agent (3-layer permission check)
        agent_ops = AgentOperations(self.session)
        await agent_ops.get_by_id(user_id, organization_id, agent_id)

        # Enforce per-user limit
        await self._enforce_user_limit(user_id, organization_id)

        # Validate cron expression
        _validate_cron_expression(cron_expression)

        # Validate minimum interval
        _validate_minimum_interval(cron_expression)

        # Validate timezone
        _validate_timezone(timezone)

        # Compute next run
        next_run = _compute_next_run(cron_expression, timezone)

        task = AgentCronTask(
            agent_id=agent_id,
            execution_user_id=user_id,
            name=name.strip(),
            description=description,
            prompt=prompt,
            cron_expression=cron_expression,
            timezone=timezone,
            is_enabled=True,
            next_run_at=next_run,
            visibility=visibility,
        )

        return await self.create(user_id, organization_id, task, group_ids)

    async def update_cron_task(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        task_id: UUID,
        name: str | None = None,
        description: str | None = None,
        prompt: str | None = None,
        cron_expression: str | None = None,
        timezone: str | None = None,
        is_enabled: bool | None = None,
        visibility: VisibilityScope | None = None,
        group_ids: list[UUID] | None = None,
    ) -> AgentCronTask:
        """Update a cron task. Requires EDIT permission (3-layer check).

        Parameters
        ----------
        user_id : UUID
            The requesting user.
        organization_id : UUID
            Organization context.
        task_id : UUID
            Task to update.
        name : str | None
            New name (None = no change).
        description : str | None
            New description (None = no change).
        prompt : str | None
            New prompt (None = no change).
        cron_expression : str | None
            New cron expression (None = no change).
        timezone : str | None
            New timezone (None = no change).
        is_enabled : bool | None
            New enabled state (None = no change).
        visibility : VisibilityScope | None
            New visibility (None = no change).
        group_ids : list[UUID] | None
            New group IDs for GROUP visibility.

        Returns
        -------
        AgentCronTask
            The updated cron task.

        """
        if name is not None and not name.strip():
            raise ValidationError("name", "Task name cannot be empty")

        updates: dict[str, Any] = {}
        if name is not None:
            updates["name"] = name.strip()
        if description is not None:
            updates["description"] = description
        if prompt is not None:
            updates["prompt"] = prompt

        if cron_expression is not None:
            _validate_cron_expression(cron_expression)
            _validate_minimum_interval(cron_expression)
            updates["cron_expression"] = cron_expression

        if timezone is not None:
            _validate_timezone(timezone)
            updates["timezone"] = timezone

        if is_enabled is not None:
            updates["is_enabled"] = is_enabled
            if is_enabled:
                updates["consecutive_failures"] = 0

        if visibility is not None:
            updates["visibility"] = visibility

        # Handle group links for GROUP visibility changes
        if visibility is not None and group_ids is not None:
            await self._remove_group_links(task_id)
            if visibility == VisibilityScope.GROUP and group_ids:
                await self._create_group_links(task_id, group_ids, user_id, organization_id)

        # Recompute next_run if schedule changed or task is being re-enabled
        needs_next_run = cron_expression is not None or timezone is not None
        if is_enabled and not needs_next_run:
            # Re-enabling a task that was auto-disabled: next_run_at is None,
            # so we must recompute it or the worker will never pick it up.
            needs_next_run = True
        if needs_next_run:
            task = await self.get_by_id(user_id, organization_id, task_id)
            expr = cron_expression or task.cron_expression
            tz = timezone or task.timezone
            updates["next_run_at"] = _compute_next_run(expr, tz)

        return await self.update(user_id, organization_id, task_id, **updates)

    async def list_cron_tasks(
        self,
        user_id: UUID,
        organization_id: UUID,
        agent_id: UUID | None = None,
        personal_only: bool = False,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[list[AgentCronTask], int]:
        """List cron tasks accessible to user with permission filtering.

        When ``agent_id`` is provided and the user can access that agent,
        all cron tasks for the agent are returned regardless of the cron
        task's own visibility. This makes automations inherit the parent
        agent's permission model.

        Parameters
        ----------
        user_id : UUID
            User requesting the list.
        organization_id : UUID
            Organization context.
        agent_id : UUID | None
            Filter by agent. When set, permissions are checked against
            the agent rather than individual cron tasks.
        personal_only : bool
            Only return tasks owned by the user.
        page : int
            Page number (1-based).
        page_size : int
            Items per page.

        Returns
        -------
        tuple[list[AgentCronTask], int]
            List of tasks and total count.

        """
        query = select(AgentCronTask).where(
            AgentCronTask.organization_id == organization_id,
            AgentCronTask.is_deleted == False,  # noqa: E712
        )

        if agent_id:
            # When scoped to an agent, verify access to the agent itself.
            # If the user can access the agent, they can see all its automations.
            agent_ops = AgentOperations(self.session)
            await agent_ops.get_by_id(user_id, organization_id, agent_id)
            query = query.where(AgentCronTask.agent_id == agent_id)
        elif personal_only:
            # Apply visibility/access filter on cron tasks themselves
            personal_filter = self.access_query.build_personal_filter(
                user_id=user_id,
                owner_id_column=AgentCronTask.owner_id,
                visibility_column=AgentCronTask.visibility,
            )
            query = query.where(personal_filter)
        else:
            # No agent filter: show tasks on agents the user can access.
            accessible_agent_ids = select(Agent.id).where(
                Agent.organization_id == organization_id,
                Agent.is_deleted == False,  # noqa: E712
                self.access_query.build_accessible_filter(
                    user_id=user_id,
                    organization_id=organization_id,
                    content_type=ContentType.AGENT,
                    content_id_column=Agent.id,
                    owner_id_column=Agent.owner_id,
                    visibility_column=Agent.visibility,
                ),
            )
            query = query.where(AgentCronTask.agent_id.in_(accessible_agent_ids))

        # Count total
        count_query = select(func.count()).select_from(query.subquery())
        total = (await self.session.execute(count_query)).scalar() or 0

        # Sort and paginate
        query = query.order_by(AgentCronTask.created_at.desc())
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self.session.execute(query)
        tasks = list(result.scalars().all())

        return tasks, total

    async def get_due_tasks(self) -> list[AgentCronTask]:
        """Get all enabled, non-deleted tasks where next_run_at <= now.

        This is called by the worker cron job - no permission check
        since it operates at system level.

        Returns
        -------
        list[AgentCronTask]
            Due tasks ready for execution.

        """
        now = datetime.now(UTC)
        result = await self.session.execute(
            select(AgentCronTask)
            .where(
                AgentCronTask.is_enabled == True,  # noqa: E712
                AgentCronTask.is_deleted == False,  # noqa: E712
                AgentCronTask.next_run_at <= now,
            )
            .order_by(AgentCronTask.next_run_at.asc())
            .limit(100)
        )
        return list(result.scalars().all())

    async def mark_completed(
        self,
        task_id: UUID,
        status: str,
        error: str | None = None,
    ) -> None:
        """Update task state after execution. System-level, no permission check.

        Parameters
        ----------
        task_id : UUID
            The task that was executed.
        status : str
            Execution status: "success" or "error".
        error : str | None
            Error message if status is "error".

        """
        result = await self.session.execute(select(AgentCronTask).where(AgentCronTask.id == task_id))
        task = result.scalar_one_or_none()
        if not task:
            return

        now = datetime.now(UTC)
        task.last_run_at = now
        task.last_run_status = status
        task.updated_at = now

        if status == "success":
            task.run_count += 1
            task.consecutive_failures = 0
            task.last_run_error = None
        else:
            task.consecutive_failures += 1
            task.last_run_error = error
            # Auto-disable after max consecutive failures
            if task.consecutive_failures >= task.max_consecutive_failures:
                task.is_enabled = False

        # Recompute next run (only if still enabled)
        if task.is_enabled:
            task.next_run_at = _compute_next_run(task.cron_expression, task.timezone)
        else:
            task.next_run_at = None

        await self.session.commit()

    async def get_run_logs(
        self,
        user_id: UUID,
        organization_id: UUID,
        task_id: UUID,
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[AgentCronRunLog], int]:
        """Get execution history for a cron task.

        Requires ACCESS permission on the parent cron task (3-layer check).

        Parameters
        ----------
        user_id : UUID
            User requesting the logs.
        organization_id : UUID
            Organization context.
        task_id : UUID
            The cron task to get logs for.
        page : int
            Page number (1-based).
        page_size : int
            Items per page.

        Returns
        -------
        tuple[list[AgentCronRunLog], int]
            List of run logs and total count.

        """
        # Verify access to the parent cron task (3-layer check)
        await self.get_by_id(user_id, organization_id, task_id)

        # Count total
        count_result = await self.session.execute(
            select(func.count()).where(AgentCronRunLog.cron_task_id == task_id)
        )
        total = count_result.scalar() or 0

        # Fetch paginated logs
        result = await self.session.execute(
            select(AgentCronRunLog)
            .where(AgentCronRunLog.cron_task_id == task_id)
            .order_by(AgentCronRunLog.started_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        logs = list(result.scalars().all())

        return logs, total

    async def transfer_ownership(
        self,
        *,
        admin_user_id: UUID,
        organization_id: UUID,
        task_id: UUID,
        new_owner_id: UUID,
    ) -> AgentCronTask:
        """Transfer task ownership. Requires org ADMIN role.

        Updates both owner_id and execution_user_id atomically.
        Verifies the new owner can access the agent.

        Parameters
        ----------
        admin_user_id : UUID
            The admin performing the transfer.
        organization_id : UUID
            Organization context.
        task_id : UUID
            Task to transfer.
        new_owner_id : UUID
            The new owner's user ID.

        Returns
        -------
        AgentCronTask
            The updated cron task.

        Raises
        ------
        PermissionDeniedError
            If the requesting user is not an org admin.
        NotFoundError
            If the task does not exist.
        ValidationError
            If the new owner cannot access the agent.

        """
        from uniffy.domains.organizations.operations import OrganizationOperations

        # Verify admin role
        org_ops = OrganizationOperations(self.session)
        membership = await org_ops.require_org_member(admin_user_id, organization_id)
        role_value = (
            membership.role.value if hasattr(membership.role, "value") else str(membership.role)
        )
        if role_value not in ("ADMIN", "OWNER"):
            from uniffy.core.errors import PermissionDeniedError

            raise PermissionDeniedError("transfer_ownership", "AGENT_CRON_TASK")

        # Get the task (no permission filter - admin bypass)
        result = await self.session.execute(
            select(AgentCronTask).where(
                AgentCronTask.id == task_id,
                AgentCronTask.organization_id == organization_id,
                AgentCronTask.is_deleted == False,  # noqa: E712
            )
        )
        task = result.scalar_one_or_none()
        if not task:
            raise NotFoundError("AGENT_CRON_TASK", task_id)

        # Verify new owner can access the agent
        agent_ops = AgentOperations(self.session)
        try:
            await agent_ops.get_by_id(new_owner_id, organization_id, task.agent_id)
        except Exception:
            raise ValidationError(
                "new_owner_id",
                "New owner does not have access to the agent",
            )

        # Transfer both owner and execution identity atomically
        task.owner_id = new_owner_id
        task.execution_user_id = new_owner_id
        task.updated_at = datetime.now(UTC)

        await self.session.commit()
        await self.session.refresh(task)

        # Re-index for search (ownership changed)
        group_ids = await self._get_content_group_ids(task_id)
        await self._index_for_search(task, group_ids)
        await self.session.commit()

        return task

    async def trigger_now(
        self,
        user_id: UUID,
        organization_id: UUID,
        task_id: UUID,
    ) -> tuple[AgentCronTask, AgentCronRunLog]:
        """Trigger immediate execution of a cron task via the worker.

        Creates a "pending" run log entry and enqueues a background
        job to execute the task through the same worker path as
        scheduled execution. The run log is updated by the worker
        once execution completes.

        Requires ACCESS permission on the cron task (3-layer check).

        Parameters
        ----------
        user_id : UUID
            User triggering the run.
        organization_id : UUID
            Organization context.
        task_id : UUID
            The cron task to execute.

        Returns
        -------
        tuple[AgentCronTask, AgentCronRunLog]
            The task and the pending run log entry.

        Raises
        ------
        NotFoundError
            If the task does not exist.
        PermissionDeniedError
            If the user cannot access the cron task.
        ValidationError
            If the queue is unavailable.

        """
        # Permission check via get_by_id (3-layer on the cron task)
        task = await self.get_by_id(user_id, organization_id, task_id)

        # Create a "pending" run log so the UI has immediate feedback
        run_log = AgentCronRunLog(
            cron_task_id=task.id,
            organization_id=task.organization_id,
            session_id=task.session_id or task.id,
            status="pending",
            started_at=datetime.now(UTC),
        )
        self.session.add(run_log)
        await self.session.commit()
        await self.session.refresh(run_log)

        # Enqueue execution to the background worker
        try:
            queue = get_queue()
            await queue.enqueue_job(
                "execute_single_agent_cron_task",
                str(task.id),
                str(run_log.id),
            )
        except RuntimeError as exc:
            # Queue not available - mark run log as error
            run_log.status = "error"
            run_log.error = "Background worker unavailable. Please try again later."
            run_log.completed_at = datetime.now(UTC)
            await self.session.commit()
            raise ValidationError("queue", "Background worker is not available") from exc

        await self.session.refresh(task)
        return task, run_log

    async def _enforce_user_limit(self, user_id: UUID, organization_id: UUID) -> None:
        """Enforce maximum cron tasks per user per organization.

        Parameters
        ----------
        user_id : UUID
            The user to check.
        organization_id : UUID
            Organization context.

        Raises
        ------
        ValidationError
            If the user has reached the maximum number of cron tasks.

        """
        count_result = await self.session.execute(
            select(func.count()).where(
                AgentCronTask.owner_id == user_id,
                AgentCronTask.organization_id == organization_id,
                AgentCronTask.is_deleted == False,  # noqa: E712
            )
        )
        count = count_result.scalar() or 0
        if count >= MAX_CRON_TASKS_PER_USER:
            raise ValidationError(
                "limit",
                f"Maximum of {MAX_CRON_TASKS_PER_USER} scheduled tasks per user",
            )


def _validate_cron_expression(expr: str) -> None:
    """Validate a 5-field cron expression.

    Parameters
    ----------
    expr : str
        Cron expression to validate.

    Raises
    ------
    ValidationError
        If the expression is invalid.

    """
    if not expr or not expr.strip():
        raise ValidationError("cron_expression", "Cron expression cannot be empty")

    if not croniter.is_valid(expr):
        raise ValidationError("cron_expression", f"Invalid cron expression: {expr}")


def _validate_minimum_interval(expr: str) -> None:
    """Validate that a cron expression does not run more often than every 5 minutes.

    Parameters
    ----------
    expr : str
        Cron expression to validate.

    Raises
    ------
    ValidationError
        If the interval is too short.

    """
    now = datetime.now(UTC)
    cron = croniter(expr, now)
    first = cron.get_next(datetime)
    second = cron.get_next(datetime)
    interval = (second - first).total_seconds()

    if interval < MIN_INTERVAL_SECONDS:
        raise ValidationError(
            "cron_expression",
            f"Minimum interval is 5 minutes. This schedule runs every {int(interval)} seconds.",
        )


def _validate_timezone(tz: str) -> None:
    """Validate an IANA timezone string.

    Parameters
    ----------
    tz : str
        Timezone to validate.

    Raises
    ------
    ValidationError
        If the timezone is invalid.

    """
    try:
        ZoneInfo(tz)
    except ZoneInfoNotFoundError, KeyError:
        raise ValidationError("timezone", f"Invalid timezone: {tz}")


def _compute_next_run(
    cron_expression: str,
    timezone: str,
    after: datetime | None = None,
) -> datetime:
    """Compute the next run time for a cron expression.

    Parameters
    ----------
    cron_expression : str
        5-field cron expression.
    timezone : str
        IANA timezone.
    after : datetime | None
        Compute next run after this time. Defaults to now.

    Returns
    -------
    datetime
        Next run time in UTC.

    """
    tz = ZoneInfo(timezone)
    base = after or datetime.now(UTC)
    # Convert to the task's timezone for correct schedule interpretation
    base_local = base.astimezone(tz)
    cron = croniter(cron_expression, base_local)
    next_local = cron.get_next(datetime)
    # Convert back to UTC for storage
    return next_local.astimezone(UTC)
