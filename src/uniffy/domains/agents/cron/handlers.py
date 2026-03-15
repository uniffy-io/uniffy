"""Cron tasks RPC handlers - thin layer delegating to operations."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger

from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.types import VisibilityScope
from uniffy.db import get_async_session
from uniffy.domains.agents.cron.converters import (
    cron_run_log_to_proto,
    cron_task_to_proto,
)
from uniffy.domains.agents.cron.operations import CronTaskOperations
from uniffy.domains.auth.context import get_user_id_from_context
from uniffy.gen.agents.v1.cron_pb2 import (
    CreateCronTaskRequest,
    CronTaskResponse,
    DeleteCronTaskRequest,
    DeleteCronTaskResponse,
    GetCronTaskRequest,
    ListCronRunLogsRequest,
    ListCronRunLogsResponse,
    ListCronTasksRequest,
    ListCronTasksResponse,
    TriggerCronTaskRequest,
    TriggerCronTaskResponse,
    UpdateCronTaskRequest,
)
from uniffy.gen.common.v1.common_pb2 import PaginationResponse

VISIBILITY_FROM_PROTO: dict[int, VisibilityScope] = {
    0: VisibilityScope.PRIVATE,
    1: VisibilityScope.PRIVATE,
    2: VisibilityScope.GROUP,
    3: VisibilityScope.ORGANIZATION,
}


class CronHandlers:
    """RPC handlers for cron tasks service."""

    async def create_cron_task(
        self,
        request: CreateCronTaskRequest,
        ctx: RequestContext,
    ) -> CronTaskResponse:
        """Handle create_cron_task RPC call."""
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            agent_id = UUID(request.agent_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        visibility = VISIBILITY_FROM_PROTO.get(request.visibility, VisibilityScope.PRIVATE)
        timezone = request.timezone if request.HasField("timezone") else "UTC"
        description = request.description if request.HasField("description") else ""

        try:
            async for session in get_async_session():
                ops = CronTaskOperations(session)
                task = await ops.create_cron_task(
                    user_id=user_id,
                    organization_id=org_id,
                    agent_id=agent_id,
                    name=request.name,
                    prompt=request.prompt,
                    cron_expression=request.cron_expression,
                    timezone=timezone,
                    visibility=visibility,
                    description=description,
                )
                return CronTaskResponse(task=cron_task_to_proto(task))

        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error creating cron task: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_cron_task(
        self,
        request: GetCronTaskRequest,
        ctx: RequestContext,
    ) -> CronTaskResponse:
        """Handle get_cron_task RPC call."""
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            task_id = UUID(request.task_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async for session in get_async_session():
                ops = CronTaskOperations(session)
                task = await ops.get_by_id(user_id, org_id, task_id)
                return CronTaskResponse(task=cron_task_to_proto(task))

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Cron task not found")
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error getting cron task: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_cron_tasks(
        self,
        request: ListCronTasksRequest,
        ctx: RequestContext,
    ) -> ListCronTasksResponse:
        """Handle list_cron_tasks RPC call."""
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(
                Code.INVALID_ARGUMENT,
                "Invalid organization ID format",
            )

        agent_id = None
        if request.HasField("agent_id") and request.agent_id:
            try:
                agent_id = UUID(request.agent_id)
            except ValueError:
                raise ConnectError(
                    Code.INVALID_ARGUMENT,
                    "Invalid agent ID format",
                )

        page = 1
        page_size = 50
        if request.HasField("pagination"):
            page = max(request.pagination.page, 1)
            page_size = min(max(request.pagination.page_size, 1), 100)

        try:
            async for session in get_async_session():
                ops = CronTaskOperations(session)
                tasks, total = await ops.list_cron_tasks(
                    user_id=user_id,
                    organization_id=org_id,
                    agent_id=agent_id,
                    page=page,
                    page_size=page_size,
                )
                total_pages = (total + page_size - 1) // page_size if total > 0 else 0
                return ListCronTasksResponse(
                    tasks=[cron_task_to_proto(t) for t in tasks],
                    pagination=PaginationResponse(
                        page=page,
                        page_size=page_size,
                        total_count=total,
                        total_pages=total_pages,
                    ),
                )

        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error listing cron tasks: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_cron_task(
        self,
        request: UpdateCronTaskRequest,
        ctx: RequestContext,
    ) -> CronTaskResponse:
        """Handle update_cron_task RPC call."""
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            task_id = UUID(request.task_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

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
            async for session in get_async_session():
                ops = CronTaskOperations(session)
                task = await ops.update_cron_task(
                    user_id=user_id,
                    organization_id=org_id,
                    task_id=task_id,
                    **kwargs,
                )
                return CronTaskResponse(task=cron_task_to_proto(task))

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Cron task not found")
        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error updating cron task: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def delete_cron_task(
        self,
        request: DeleteCronTaskRequest,
        ctx: RequestContext,
    ) -> DeleteCronTaskResponse:
        """Handle delete_cron_task RPC call."""
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            task_id = UUID(request.task_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async for session in get_async_session():
                ops = CronTaskOperations(session)
                await ops.delete(user_id, org_id, task_id)
                return DeleteCronTaskResponse(success=True)

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Cron task not found")
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error deleting cron task: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_cron_run_logs(
        self,
        request: ListCronRunLogsRequest,
        ctx: RequestContext,
    ) -> ListCronRunLogsResponse:
        """Handle list_cron_run_logs RPC call."""
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            task_id = UUID(request.task_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        page = 1
        page_size = 20
        if request.HasField("pagination"):
            page = max(request.pagination.page, 1)
            page_size = min(max(request.pagination.page_size, 1), 50)

        try:
            async for session in get_async_session():
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

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Cron task not found")
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(
                f"Error listing cron run logs: {e}",
                exc_info=True,
            )
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def trigger_cron_task(
        self,
        request: TriggerCronTaskRequest,
        ctx: RequestContext,
    ) -> TriggerCronTaskResponse:
        """Handle trigger_cron_task RPC call.

        Enqueues immediate execution of a scheduled task via the
        background worker. Returns a pending run log that the
        frontend can poll for completion.

        Parameters
        ----------
        request : TriggerCronTaskRequest
            The request with organization and task IDs.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        TriggerCronTaskResponse
            The pending run log and current task info.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            task_id = UUID(request.task_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async for session in get_async_session():
                ops = CronTaskOperations(session)
                task, run_log = await ops.trigger_now(
                    user_id=user_id,
                    organization_id=org_id,
                    task_id=task_id,
                )
                return TriggerCronTaskResponse(
                    run_log=cron_run_log_to_proto(run_log),
                    task=cron_task_to_proto(task),
                )

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Cron task not found")
        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(
                f"Error triggering cron task: {e}",
                exc_info=True,
            )
            raise ConnectError(Code.INTERNAL, "Internal server error")
