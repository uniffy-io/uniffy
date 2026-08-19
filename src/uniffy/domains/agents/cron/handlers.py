"""Cron task RPC handlers."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession
from uniffy_proto.agents.v1.cron_pb2 import (
    CreateCronTaskRequest,
    CreateCronTaskResponse,
    DeleteCronTaskRequest,
    DeleteCronTaskResponse,
    GetCronTaskRequest,
    GetCronTaskResponse,
    ListCronRunLogsRequest,
    ListCronRunLogsResponse,
    ListCronTasksRequest,
    ListCronTasksResponse,
    TriggerCronTaskRequest,
    TriggerCronTaskResponse,
    UpdateCronTaskRequest,
    UpdateCronTaskResponse,
)
from uniffy_proto.common.v1.common_pb2 import PaginationResponse

from uniffy.core.auth.permissions import resolve_effective_policy
from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.converters.common_proto import (
    access_mode_from_proto,
    content_role_from_proto,
)
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.agents.cron_task import AgentCronTask
from uniffy.core.types import ContentType
from uniffy.db import open_session
from uniffy.domains.agents.cron.converters import (
    cron_run_log_to_proto,
    cron_task_to_proto,
)
from uniffy.domains.agents.cron.operations import CronTaskOperations
from uniffy.domains.auth.context import get_user_id_from_context
from uniffy.domains.permissions.resource_access import ResourceAccessResolver, ResourceKey

logger = logger.bind(component="agents.cron.handlers")


async def _resolve_effective_policy(
    session: AsyncSession,
    organization_id: UUID,
    task: AgentCronTask,
    checker: PermissionChecker | None = None,
):
    """Return the cron task's effective ``(access_mode, baseline_role)`` for proto emission."""
    permission_checker = checker or PermissionChecker(session)
    default_mode, default_baseline = await permission_checker.get_org_defaults(
        organization_id,
        ContentType.AGENT_CRON_TASK,
    )
    return resolve_effective_policy(
        task.access_mode,
        task.baseline_role,
        default_mode,
        default_baseline,
    )


def _parse_uuid(value: str, field: str) -> UUID:
    """Parse a UUID string or raise ``INVALID_ARGUMENT``."""
    try:
        return UUID(value)
    except ValueError as exc:
        raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid {field}: {exc}") from exc


def _map_domain_error(operation: str, exc: Exception) -> ConnectError:
    """Translate a domain exception into the matching ``ConnectError``."""
    if isinstance(exc, NotFoundError):
        return ConnectError(Code.NOT_FOUND, str(exc) or "Not found")
    if isinstance(exc, ValidationError):
        return ConnectError(Code.INVALID_ARGUMENT, str(exc))
    if isinstance(exc, PermissionDeniedError):
        return ConnectError(Code.PERMISSION_DENIED, str(exc) or "Access denied")
    logger.exception(f"Error in {operation}: {exc}")
    return ConnectError(Code.INTERNAL, "Internal server error")


class CronHandlers:
    """RPC handlers for ``agents.v1.CronService``."""

    async def create_cron_task(
        self,
        request: CreateCronTaskRequest,
        ctx: RequestContext,
    ) -> CreateCronTaskResponse:
        """Create a new cron task."""
        user_id = get_user_id_from_context(ctx)
        org_id = _parse_uuid(request.organization_id, "organization_id")
        agent_id = _parse_uuid(request.agent_id, "agent_id")

        access_mode = access_mode_from_proto(request.access_mode) if request.access_mode else None
        baseline_role = (
            content_role_from_proto(request.baseline_role) if request.baseline_role else None
        )
        timezone = request.timezone if request.HasField("timezone") else "UTC"
        description = request.description if request.HasField("description") else ""

        try:
            async with open_session() as session:
                ops = CronTaskOperations(session)
                task = await ops.create_cron_task(
                    user_id=user_id,
                    organization_id=org_id,
                    agent_id=agent_id,
                    name=request.name,
                    prompt=request.prompt,
                    cron_expression=request.cron_expression,
                    timezone=timezone,
                    access_mode=access_mode,
                    baseline_role=baseline_role,
                    description=description,
                )
                eff_mode, eff_baseline = await _resolve_effective_policy(
                    session,
                    org_id,
                    task,
                )
                user_role = await ops._resolve_role(user_id, org_id, task)
                return CreateCronTaskResponse(
                    task=cron_task_to_proto(
                        task,
                        effective_access_mode=eff_mode,
                        effective_baseline_role=eff_baseline,
                        user_role=user_role,
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("create_cron_task", exc) from exc

    async def get_cron_task(
        self,
        request: GetCronTaskRequest,
        ctx: RequestContext,
    ) -> GetCronTaskResponse:
        """Get a cron task by ID."""
        user_id = get_user_id_from_context(ctx)
        org_id = _parse_uuid(request.organization_id, "organization_id")
        task_id = _parse_uuid(request.task_id, "task_id")

        try:
            async with open_session() as session:
                ops = CronTaskOperations(session)
                task = await ops.get_by_id(user_id, org_id, task_id)
                eff_mode, eff_baseline = await _resolve_effective_policy(
                    session,
                    org_id,
                    task,
                )
                user_role = await ops._resolve_role(user_id, org_id, task)
                return GetCronTaskResponse(
                    task=cron_task_to_proto(
                        task,
                        effective_access_mode=eff_mode,
                        effective_baseline_role=eff_baseline,
                        user_role=user_role,
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("get_cron_task", exc) from exc

    async def list_cron_tasks(
        self,
        request: ListCronTasksRequest,
        ctx: RequestContext,
    ) -> ListCronTasksResponse:
        """List cron tasks."""
        user_id = get_user_id_from_context(ctx)
        org_id = _parse_uuid(request.organization_id, "organization_id")

        agent_id = None
        if request.HasField("agent_id") and request.agent_id:
            agent_id = _parse_uuid(request.agent_id, "agent_id")

        page = 1
        page_size = 50
        if request.HasField("pagination"):
            page = max(request.pagination.page, 1)
            page_size = min(max(request.pagination.page_size, 1), 100)

        try:
            async with open_session() as session:
                ops = CronTaskOperations(session)
                tasks, total = await ops.list_cron_tasks(
                    user_id=user_id,
                    organization_id=org_id,
                    agent_id=agent_id,
                    page=page,
                    page_size=page_size,
                )
                total_pages = (total + page_size - 1) // page_size if total > 0 else 0
                checker = PermissionChecker(session)
                default_mode, default_baseline = await checker.get_org_defaults(
                    org_id,
                    ContentType.AGENT_CRON_TASK,
                )
                decisions = await ResourceAccessResolver(session).resolve_page(
                    actor_id=user_id,
                    organization_id=org_id,
                    keys=[ResourceKey(ContentType.AGENT_CRON_TASK, t.id) for t in tasks],
                )
                proto_tasks = []
                for t in tasks:
                    eff_mode, eff_baseline = resolve_effective_policy(
                        t.access_mode,
                        t.baseline_role,
                        default_mode,
                        default_baseline,
                    )
                    proto_tasks.append(
                        cron_task_to_proto(
                            t,
                            effective_access_mode=eff_mode,
                            effective_baseline_role=eff_baseline,
                            user_role=decisions[ResourceKey(ContentType.AGENT_CRON_TASK, t.id)].role,
                        )
                    )
                return ListCronTasksResponse(
                    tasks=proto_tasks,
                    pagination=PaginationResponse(
                        page=page,
                        page_size=page_size,
                        total_count=total,
                        total_pages=total_pages,
                    ),
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("list_cron_tasks", exc) from exc

    async def update_cron_task(
        self,
        request: UpdateCronTaskRequest,
        ctx: RequestContext,
    ) -> UpdateCronTaskResponse:
        """Update a cron task."""
        user_id = get_user_id_from_context(ctx)
        org_id = _parse_uuid(request.organization_id, "organization_id")
        task_id = _parse_uuid(request.task_id, "task_id")

        kwargs: dict = {}
        if request.HasField("name"):
            kwargs["name"] = request.name
        if request.HasField("prompt"):
            kwargs["prompt"] = request.prompt
        if request.HasField("cron_expression"):
            kwargs["cron_expression"] = request.cron_expression
        if request.HasField("timezone"):
            kwargs["timezone"] = request.timezone
        if request.HasField("description"):
            kwargs["description"] = request.description
        if request.HasField("is_enabled"):
            kwargs["is_enabled"] = request.is_enabled

        if not kwargs:
            raise ConnectError(Code.INVALID_ARGUMENT, "No updates provided")

        try:
            async with open_session() as session:
                ops = CronTaskOperations(session)
                task = await ops.update_cron_task(
                    user_id=user_id,
                    organization_id=org_id,
                    task_id=task_id,
                    **kwargs,
                )
                eff_mode, eff_baseline = await _resolve_effective_policy(
                    session,
                    org_id,
                    task,
                )
                user_role = await ops._resolve_role(user_id, org_id, task)
                return UpdateCronTaskResponse(
                    task=cron_task_to_proto(
                        task,
                        effective_access_mode=eff_mode,
                        effective_baseline_role=eff_baseline,
                        user_role=user_role,
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("update_cron_task", exc) from exc

    async def delete_cron_task(
        self,
        request: DeleteCronTaskRequest,
        ctx: RequestContext,
    ) -> DeleteCronTaskResponse:
        """Delete a cron task."""
        user_id = get_user_id_from_context(ctx)
        org_id = _parse_uuid(request.organization_id, "organization_id")
        task_id = _parse_uuid(request.task_id, "task_id")

        try:
            async with open_session() as session:
                ops = CronTaskOperations(session)
                await ops.delete_cron_task(
                    user_id=user_id,
                    organization_id=org_id,
                    task_id=task_id,
                )
                return DeleteCronTaskResponse(success=True)
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("delete_cron_task", exc) from exc

    async def list_cron_run_logs(
        self,
        request: ListCronRunLogsRequest,
        ctx: RequestContext,
    ) -> ListCronRunLogsResponse:
        """List cron run logs for a task."""
        user_id = get_user_id_from_context(ctx)
        org_id = _parse_uuid(request.organization_id, "organization_id")
        task_id = _parse_uuid(request.task_id, "task_id")

        page = 1
        page_size = 20
        if request.HasField("pagination"):
            page = max(request.pagination.page, 1)
            page_size = min(max(request.pagination.page_size, 1), 50)

        try:
            async with open_session() as session:
                ops = CronTaskOperations(session)
                logs, total = await ops.get_run_logs(
                    user_id=user_id,
                    organization_id=org_id,
                    task_id=task_id,
                    page=page,
                    page_size=page_size,
                )
                total_pages = (total + page_size - 1) // page_size if total > 0 else 0
                return ListCronRunLogsResponse(
                    logs=[cron_run_log_to_proto(log) for log in logs],
                    pagination=PaginationResponse(
                        page=page,
                        page_size=page_size,
                        total_count=total,
                        total_pages=total_pages,
                    ),
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("list_cron_run_logs", exc) from exc

    async def trigger_cron_task(
        self,
        request: TriggerCronTaskRequest,
        ctx: RequestContext,
    ) -> TriggerCronTaskResponse:
        """Trigger immediate execution of a scheduled task."""
        user_id = get_user_id_from_context(ctx)
        org_id = _parse_uuid(request.organization_id, "organization_id")
        task_id = _parse_uuid(request.task_id, "task_id")

        try:
            async with open_session() as session:
                ops = CronTaskOperations(session)
                task, run_log = await ops.trigger_now(
                    user_id=user_id,
                    organization_id=org_id,
                    task_id=task_id,
                )
                eff_mode, eff_baseline = await _resolve_effective_policy(
                    session,
                    org_id,
                    task,
                )
                user_role = await ops._resolve_role(user_id, org_id, task)
                return TriggerCronTaskResponse(
                    run_log=cron_run_log_to_proto(run_log),
                    task=cron_task_to_proto(
                        task,
                        effective_access_mode=eff_mode,
                        effective_baseline_role=eff_baseline,
                        user_role=user_role,
                    ),
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("trigger_cron_task", exc) from exc
