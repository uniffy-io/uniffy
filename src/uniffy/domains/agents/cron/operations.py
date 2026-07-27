"""Agent cron task operations."""

from datetime import UTC, datetime
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from croniter import croniter
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.content.base_operations import BaseContentOperations
from uniffy.core.content.members import (
    ContentMembersOperations,
    register_content_loader,
    register_ownership_transfer_hook,
)
from uniffy.core.errors import (
    NotFoundError,
    PermissionDeniedError,
    ValidationError,
)
from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.agents.cron_task import AgentCronTask
from uniffy.core.models.agents.run_log import AgentRunLog
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import AccessMode, ContentRole, ContentType, SubjectType
from uniffy.core.valkey import get_queue
from uniffy.domains.agents.access import require_agents_builder
from uniffy.domains.agents.agents.operations import AgentOperations

MAX_CRON_TASKS_PER_USER = 20
MIN_INTERVAL_SECONDS = 300  # 5 minutes


class CronTaskOperations(BaseContentOperations[AgentCronTask]):
    """Agent cron task CRUD with permissions and search indexing."""

    content_type = ContentType.AGENT_CRON_TASK
    model_class = AgentCronTask

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session)

    def _build_search_keywords(self, model: AgentCronTask) -> str:
        parts = [model.name]
        if model.description:
            parts.append(model.description[:300])
        if model.prompt:
            parts.append(model.prompt[:200])
        return " ".join(parts)

    def _get_search_title(self, model: AgentCronTask) -> str:
        return model.name

    def _get_url_path(self, model: AgentCronTask) -> str:
        return f"/agents/{model.agent_id}/cron/{model.id}"

    def _get_search_description(self, model: AgentCronTask) -> str | None:
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
        access_mode: AccessMode | None = None,
        baseline_role: ContentRole | None = None,
        group_ids: list[UUID] | None = None,
    ) -> AgentCronTask:
        """Create a scheduled agent task."""
        if not name or not name.strip():
            raise ValidationError("name", "Task name cannot be empty")
        if not prompt or not prompt.strip():
            raise ValidationError("prompt", "Task prompt cannot be empty")

        agent_ops = AgentOperations(self.session)
        await agent_ops.get_by_id(user_id, organization_id, agent_id)

        await require_agents_builder(self.session, user_id, organization_id)
        await self._enforce_user_limit(user_id, organization_id)

        _validate_cron_expression(cron_expression)
        _validate_minimum_interval(cron_expression)
        _validate_timezone(timezone)

        next_run = _compute_next_run(cron_expression, timezone)

        access_mode, baseline_role = await self._resolve_access_policy(
            organization_id, access_mode, baseline_role
        )

        task = AgentCronTask(
            organization_id=organization_id,
            owner_id=user_id,
            agent_id=agent_id,
            execution_user_id=user_id,
            name=name.strip(),
            description=description,
            prompt=prompt,
            cron_expression=cron_expression,
            timezone=timezone,
            is_enabled=True,
            next_run_at=next_run,
            access_mode=access_mode,
            baseline_role=baseline_role,
        )
        self.session.add(task)
        await self.session.commit()
        await self.session.refresh(task)

        if group_ids:
            members_ops = ContentMembersOperations(self.session)
            for gid in group_ids:
                await members_ops.add_member(
                    actor_user_id=user_id,
                    organization_id=organization_id,
                    content_type=self.content_type,
                    content_id=task.id,
                    subject_type=SubjectType.GROUP,
                    subject_id=gid,
                    role=ContentRole.VIEWER,
                )

        await self._index_for_search(task, skip_member_lookup=not group_ids)
        await self.session.commit()

        return task

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
    ) -> AgentCronTask:
        """Update a cron task.

        Access-policy changes (access mode, baseline role, members) go
        through `permissions.v1.MembersService`, never this method.
        """
        if name is not None and not name.strip():
            raise ValidationError("name", "Task name cannot be empty")

        task = await self._fetch_by_id(task_id, organization_id)
        if task is None:
            raise NotFoundError("AgentCronTask", task_id)

        await require_agents_builder(self.session, user_id, organization_id)

        if name is not None:
            task.name = name.strip()
        if description is not None:
            task.description = description
        if prompt is not None:
            # A run executes with execution_user_id's permissions, so whoever
            # rewrites the prompt owns the identity it runs under. Without this
            # a builder could make someone else's task run attacker-authored
            # instructions as that person.
            if prompt != task.prompt and task.execution_user_id != user_id:
                task.execution_user_id = user_id
                task.owner_id = user_id
            task.prompt = prompt

        if cron_expression is not None:
            _validate_cron_expression(cron_expression)
            _validate_minimum_interval(cron_expression)
            task.cron_expression = cron_expression

        if timezone is not None:
            _validate_timezone(timezone)
            task.timezone = timezone

        if is_enabled is not None:
            task.is_enabled = is_enabled
            if is_enabled:
                task.consecutive_failures = 0

        needs_next_run = cron_expression is not None or timezone is not None
        if is_enabled and not needs_next_run:
            needs_next_run = True
        if needs_next_run:
            task.next_run_at = _compute_next_run(task.cron_expression, task.timezone)

        task.updated_at = datetime.now(UTC)

        await self.session.commit()
        await self.session.refresh(task)

        await self._index_for_search(task)
        await self.session.commit()

        return task

    async def delete_cron_task(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        task_id: UUID,
    ) -> None:
        """Soft-delete a cron task."""
        task = await self._fetch_by_id(task_id, organization_id)
        if task is None:
            raise NotFoundError("AgentCronTask", task_id)

        await require_agents_builder(self.session, user_id, organization_id)

        task.is_deleted = True
        task.deleted_at = datetime.now(UTC)
        task.is_enabled = False
        task.next_run_at = None
        await self.session.commit()

        await self.search_indexer.remove(
            build_content_urn(self.content_type, task_id), organization_id
        )
        await self.session.commit()

    async def list_cron_tasks(
        self,
        user_id: UUID,
        organization_id: UUID,
        agent_id: UUID | None = None,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[list[AgentCronTask], int]:
        """List cron tasks the user can access.

        The task's own access policy always applies: a task carries its prompt,
        description and execution identity, so view access to the agent never
        substitutes for view access to the task. `agent_id` only narrows that
        set to one agent, which is additionally view-gated.
        """
        query = select(AgentCronTask).where(
            AgentCronTask.organization_id == organization_id,
            AgentCronTask.is_deleted == False,  # noqa: E712
            await self.access_query.build_accessible_filter(
                user_id=user_id,
                organization_id=organization_id,
                content_type=ContentType.AGENT_CRON_TASK,
                content_id_column=AgentCronTask.id,
                owner_id_column=AgentCronTask.owner_id,
                access_mode_column=AgentCronTask.access_mode,
                baseline_role_column=AgentCronTask.baseline_role,
            ),
        )

        if agent_id:
            agent_ops = AgentOperations(self.session)
            await agent_ops.get_by_id(user_id, organization_id, agent_id)
            query = query.where(AgentCronTask.agent_id == agent_id)
        else:
            accessible_agent_ids = select(Agent.id).where(
                Agent.organization_id == organization_id,
                Agent.is_deleted == False,  # noqa: E712
                await self.access_query.build_accessible_filter(
                    user_id=user_id,
                    organization_id=organization_id,
                    content_type=ContentType.AGENT,
                    content_id_column=Agent.id,
                    owner_id_column=Agent.owner_id,
                    access_mode_column=Agent.access_mode,
                    baseline_role_column=Agent.baseline_role,
                ),
            )
            query = query.where(AgentCronTask.agent_id.in_(accessible_agent_ids))

        count_query = select(func.count()).select_from(query.subquery())
        total = (await self.session.execute(count_query)).scalar() or 0

        query = query.order_by(AgentCronTask.created_at.desc())
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self.session.execute(query)
        tasks = list(result.scalars().all())

        return tasks, total

    async def get_due_tasks(self) -> list[AgentCronTask]:
        """Return all enabled, non-deleted tasks with `next_run_at <= now`."""
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
        """Update task state after execution (system-level, no access check)."""
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
            if task.consecutive_failures >= task.max_consecutive_failures:
                task.is_enabled = False

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
    ) -> tuple[list[AgentRunLog], int]:
        """Return execution history for a cron task from the shared run logs."""
        await self.get_by_id(user_id, organization_id, task_id)

        count_result = await self.session.execute(
            select(func.count()).where(AgentRunLog.cron_task_id == task_id)
        )
        total = count_result.scalar() or 0

        result = await self.session.execute(
            select(AgentRunLog)
            .where(AgentRunLog.cron_task_id == task_id)
            .order_by(AgentRunLog.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        logs = list(result.scalars().all())

        return logs, total

    async def transfer_ownership(
        self,
        *,
        actor_user_id: UUID,
        organization_id: UUID,
        task_id: UUID,
        new_owner_id: UUID,
    ) -> AgentCronTask:
        """Transfer task ownership through the OWNER-only content path.

        Ownership and execution identity move together: a cron run executes
        with ``execution_user_id``'s permissions, so it is repointed to the
        new owner in the same operation. There is no admin bypass; only the
        current owner can transfer.
        """
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

        agent_ops = AgentOperations(self.session)
        try:
            await agent_ops.get_by_id(new_owner_id, organization_id, task.agent_id)
        except Exception as exc:
            raise ValidationError(
                "new_owner_id",
                "New owner does not have access to the agent",
            ) from exc

        # The registered ownership-transfer hook repoints execution_user_id
        # inside the same transaction as the owner_id move.
        members_ops = ContentMembersOperations(self.session)
        await members_ops.transfer_ownership(
            actor_user_id=actor_user_id,
            organization_id=organization_id,
            content_type=self.content_type,
            content_id=task_id,
            new_owner_user_id=new_owner_id,
        )

        await self.session.refresh(task)
        await self._index_for_search(task)
        await self.session.commit()

        return task

    async def trigger_now(
        self,
        user_id: UUID,
        organization_id: UUID,
        task_id: UUID,
    ) -> tuple[AgentCronTask, AgentRunLog]:
        """Trigger immediate execution of a cron task via the worker.

        A pending placeholder row gives the history view immediate feedback;
        the worker replaces it with the runtime-written row (or records the
        failure on it) when the execution settles.
        """
        task = await self.get_by_id(user_id, organization_id, task_id)
        if task.execution_user_id != user_id:
            raise PermissionDeniedError(
                "trigger", "Only the task's execution user can run it on demand"
            )

        run_log = AgentRunLog(
            cron_task_id=task.id,
            organization_id=task.organization_id,
            agent_id=task.agent_id,
            user_id=task.execution_user_id,
            session_id=task.session_id,
            model="",
            kind="cron",
            status="pending",
        )
        self.session.add(run_log)
        await self.session.commit()
        await self.session.refresh(run_log)

        try:
            queue = get_queue("egress")
            await queue.enqueue_job(
                "execute_single_agent_cron_task",
                str(task.id),
                str(run_log.id),
            )
        except RuntimeError as exc:
            run_log.status = "error"
            run_log.error = "Background worker unavailable. Please try again later."
            await self.session.commit()
            raise ValidationError("queue", "Background worker is not available") from exc

        await self.session.refresh(task)
        return task, run_log

    async def _enforce_user_limit(self, user_id: UUID, organization_id: UUID) -> None:
        """Enforce the per-user cron task limit within an organization."""
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
    """Validate a 5-field cron expression."""
    if not expr or not expr.strip():
        raise ValidationError("cron_expression", "Cron expression cannot be empty")

    if not croniter.is_valid(expr):
        raise ValidationError("cron_expression", f"Invalid cron expression: {expr}")


def _validate_minimum_interval(expr: str) -> None:
    """Enforce the 5-minute minimum interval on cron expressions."""
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
    """Validate an IANA timezone identifier."""
    try:
        ZoneInfo(tz)
    except (ZoneInfoNotFoundError, KeyError) as exc:
        raise ValidationError("timezone", f"Invalid timezone: {tz}") from exc


def _compute_next_run(
    cron_expression: str,
    timezone: str,
    after: datetime | None = None,
) -> datetime:
    """Compute the next run time for a cron expression, returned in UTC."""
    tz = ZoneInfo(timezone)
    base = after or datetime.now(UTC)
    base_local = base.astimezone(tz)
    cron = croniter(cron_expression, base_local)
    next_local = cron.get_next(datetime)
    return next_local.astimezone(UTC)


async def _load_cron_task(
    session: AsyncSession,
    organization_id: UUID,
    content_id: UUID,
) -> AgentCronTask | None:
    result = await session.execute(
        select(AgentCronTask).where(
            AgentCronTask.id == content_id,
            AgentCronTask.organization_id == organization_id,
        )
    )
    return result.scalar_one_or_none()


async def _repoint_execution_identity(
    session: AsyncSession,
    organization_id: UUID,
    content_id: UUID,
    new_owner_id: UUID,
) -> None:
    """A cron run executes with ``execution_user_id``'s permissions, so it must
    move with owner_id in the same transaction on every transfer path."""
    task = await _load_cron_task(session, organization_id, content_id)
    if task is not None:
        task.execution_user_id = new_owner_id
        task.updated_at = datetime.now(UTC)


register_content_loader(ContentType.AGENT_CRON_TASK, _load_cron_task)
register_ownership_transfer_hook(ContentType.AGENT_CRON_TASK, _repoint_execution_identity)
