"""Task watcher RPC handlers."""

from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from uniffy_proto.projects.v1.projects_pb import (
    BulkCheckTaskWatchersRequest,
    BulkCheckTaskWatchersResponse,
    ListTaskWatchersRequest,
    ListTaskWatchersResponse,
    ToggleTaskWatcherRequest,
    ToggleTaskWatcherResponse,
)

from uniffy.core.auth.principal import current_user_id
from uniffy.domains.projects.rpc import map_domain_error, parse_uuid
from uniffy.domains.projects.tasks.reader import TaskReader
from uniffy.domains.projects.watchers.operations import WatcherOperations
from uniffy.infrastructure.database import open_session


class WatcherHandlers:
    async def toggle_task_watcher(
        self,
        request: ToggleTaskWatcherRequest,
        ctx: RequestContext,
    ) -> ToggleTaskWatcherResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        task_id = parse_uuid(request.task_id, "task_id")

        try:
            async with open_session() as session:
                task_ops = TaskReader(session)
                await task_ops.get_by_id(user_id, organization_id, task_id)

                ops = WatcherOperations(session)
                is_watching, _ = await ops.toggle(user_id, organization_id, task_id)

                return ToggleTaskWatcherResponse(is_watching=is_watching)
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("toggle_task_watcher", exc) from exc

    async def list_task_watchers(
        self,
        request: ListTaskWatchersRequest,
        ctx: RequestContext,
    ) -> ListTaskWatchersResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        task_id = parse_uuid(request.task_id, "task_id")

        try:
            async with open_session() as session:
                task_ops = TaskReader(session)
                await task_ops.get_by_id(user_id, organization_id, task_id)

                ops = WatcherOperations(session)
                watcher_ids = await ops.get_watcher_user_ids(task_id)
                count = len(watcher_ids)

                return ListTaskWatchersResponse(
                    watcher_user_ids=[str(w) for w in watcher_ids],
                    watcher_count=count,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("list_task_watchers", exc) from exc

    async def bulk_check_task_watchers(
        self,
        request: BulkCheckTaskWatchersRequest,
        ctx: RequestContext,
    ) -> BulkCheckTaskWatchersResponse:
        user_id = current_user_id()
        parse_uuid(request.organization_id, "organization_id")

        try:
            async with open_session() as session:
                ops = WatcherOperations(session)
                result = await ops.bulk_check(user_id, list(request.task_ids))
                return BulkCheckTaskWatchersResponse(watched_tasks=result)
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("bulk_check_task_watchers", exc) from exc
