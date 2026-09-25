"""Task and task activity RPC handlers."""

from typing import NamedTuple
from uuid import UUID

from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from sqlalchemy.ext.asyncio import AsyncSession
from uniffy_proto.common.v1.common_pb import PaginationResponse
from uniffy_proto.projects.v1.projects_pb import (
    BulkUpdateTasksRequest,
    BulkUpdateTasksResponse,
    CreateTaskRequest,
    CreateTaskResponse,
    DeleteTaskRequest,
    DeleteTaskResponse,
    DeleteTasksRequest,
    DeleteTasksResponse,
    GetTaskRequest,
    GetTaskResponse,
    ListActivitiesRequest,
    ListActivitiesResponse,
    ListTasksRequest,
    ListTasksResponse,
    MoveTaskRequest,
    MoveTaskResponse,
    UpdateTaskRequest,
    UpdateTaskResponse,
)
from uniffy_proto.projects.v1.projects_pb import (
    Task as TaskProto,
)

from uniffy.core.auth.principal import current_user_id
from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models.projects.task import Task
from uniffy.core.models.tags.tag import Tag
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import ContentType
from uniffy.domains.projects import queries
from uniffy.domains.projects.converters import activity_to_proto, task_to_proto
from uniffy.domains.projects.projects import ProjectOperations
from uniffy.domains.projects.rpc import map_domain_error, parse_uuid
from uniffy.domains.projects.tasks.operations import TaskOperations
from uniffy.domains.projects.tasks.reader import TaskReader
from uniffy.domains.projects.tasks.requests import (
    bulk_update_arguments,
    create_task_arguments,
    parse_tag_ids,
    update_task_arguments,
)
from uniffy.domains.tags.reader import TagReader
from uniffy.infrastructure.database import open_session


async def _hydrate_task_tags(
    session: AsyncSession,
    organization_id: UUID,
    task_ids: list[UUID],
) -> dict[UUID, list[Tag]]:
    if not task_ids:
        return {}
    urn_to_id = {build_content_urn(ContentType.TASK, tid): tid for tid in task_ids}
    tag_ops = TagReader(session)
    bulk = await tag_ops.get_for_urns(
        organization_id=organization_id,
        content_urns=list(urn_to_id),
    )
    return {tid: bulk.get(urn, []) for urn, tid in urn_to_id.items()}


class _TaskPayload(NamedTuple):
    task: TaskProto
    updated_parent: TaskProto | None
    spawned_task: TaskProto | None


async def _task_payload(
    session: AsyncSession,
    ops: TaskOperations,
    user_id: UUID,
    organization_id: UUID,
    task: Task,
    spawned_task: Task | None = None,
) -> _TaskPayload:
    """A write returns the task, its parent with fresh subtask counts, and any recurrence spawn."""
    user_role = await ops._resolve_role(user_id, organization_id, task)

    count_ids = [task.id] + ([task.parent_id] if task.parent_id else [])
    subtask_counts = await queries.get_subtask_counts(session, count_ids)
    hydrate_ids = count_ids + ([spawned_task.id] if spawned_task else [])
    tags_by_id = await _hydrate_task_tags(session, organization_id, hydrate_ids)

    updated_parent = None
    if task.parent_id:
        parent = await ops.get_by_id(user_id, organization_id, task.parent_id)
        p_total, p_done = subtask_counts.get(parent.id, (0, 0))
        updated_parent = task_to_proto(
            parent,
            user_role,
            subtask_total=p_total,
            subtask_completed=p_done,
            tags=tags_by_id.get(parent.id),
        )

    st_total, st_done = subtask_counts.get(task.id, (0, 0))
    return _TaskPayload(
        task=task_to_proto(
            task,
            user_role,
            subtask_total=st_total,
            subtask_completed=st_done,
            tags=tags_by_id.get(task.id),
        ),
        updated_parent=updated_parent,
        spawned_task=(
            task_to_proto(spawned_task, user_role, tags=tags_by_id.get(spawned_task.id))
            if spawned_task
            else None
        ),
    )


class TaskHandlers:
    async def create_task(
        self,
        request: CreateTaskRequest,
        ctx: RequestContext,
    ) -> CreateTaskResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        project_id = parse_uuid(request.project_id, "project_id")

        kwargs = create_task_arguments(request)
        tag_ids = parse_tag_ids(list(request.tag_ids))

        try:
            async with open_session() as session:
                ops = TaskOperations(
                    session,
                    storage=self.storage,
                    search_indexer=self.search_indexer,
                )
                task = await ops.create(
                    user_id=user_id,
                    organization_id=organization_id,
                    project_id=project_id,
                    title=request.title,
                    task_type=kwargs.pop("task_type", "task"),
                    tag_ids=tag_ids or None,
                    **kwargs,
                )

                payload = await _task_payload(session, ops, user_id, organization_id, task)
                return CreateTaskResponse(task=payload.task, updated_parent=payload.updated_parent)
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("create_task", exc) from exc

    async def get_task(
        self,
        request: GetTaskRequest,
        ctx: RequestContext,
    ) -> GetTaskResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        task_id = parse_uuid(request.task_id, "task_id")

        try:
            async with open_session() as session:
                ops = TaskReader(session)
                task = await ops.get_by_id(user_id, organization_id, task_id)
                user_role = await ops._resolve_role(user_id, organization_id, task)

                subtask_counts = await queries.get_subtask_counts(session, [task.id])
                st_total, st_done = subtask_counts.get(task.id, (0, 0))
                tags_by_id = await _hydrate_task_tags(session, organization_id, [task.id])

                return GetTaskResponse(
                    task=task_to_proto(
                        task, user_role, st_total, st_done, tags=tags_by_id.get(task.id)
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("get_task", exc) from exc

    async def update_task(
        self,
        request: UpdateTaskRequest,
        ctx: RequestContext,
    ) -> UpdateTaskResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        task_id = parse_uuid(request.task_id, "task_id")

        updates = update_task_arguments(request)

        try:
            async with open_session() as session:
                ops = TaskOperations(
                    session,
                    storage=self.storage,
                    search_indexer=self.search_indexer,
                )
                task, spawned_task = await ops.update(user_id, organization_id, task_id, **updates)

                payload = await _task_payload(
                    session, ops, user_id, organization_id, task, spawned_task
                )
                return UpdateTaskResponse(
                    task=payload.task,
                    updated_parent=payload.updated_parent,
                    spawned_task=payload.spawned_task,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("update_task", exc) from exc

    async def move_task(
        self,
        request: MoveTaskRequest,
        ctx: RequestContext,
    ) -> MoveTaskResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        task_id = parse_uuid(request.task_id, "task_id")

        try:
            async with open_session() as session:
                ops = TaskOperations(
                    session,
                    storage=self.storage,
                    search_indexer=self.search_indexer,
                )
                task, spawned_task = await ops.move(
                    user_id,
                    organization_id,
                    task_id,
                    request.status,
                    request.sort_order,
                )

                payload = await _task_payload(
                    session, ops, user_id, organization_id, task, spawned_task
                )
                return MoveTaskResponse(
                    task=payload.task,
                    updated_parent=payload.updated_parent,
                    spawned_task=payload.spawned_task,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("move_task", exc) from exc

    async def bulk_update_tasks(
        self,
        request: BulkUpdateTasksRequest,
        ctx: RequestContext,
    ) -> BulkUpdateTasksResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")

        changes = bulk_update_arguments(request)

        try:
            async with open_session() as session:
                ops = TaskOperations(
                    session,
                    storage=self.storage,
                    search_indexer=self.search_indexer,
                )
                tasks = await ops.bulk_update(
                    user_id,
                    organization_id,
                    list(request.task_ids),
                    **changes,
                )

                user_role = None
                if tasks:
                    user_role = await ops._resolve_role(user_id, organization_id, tasks[0])

                tags_by_id = await _hydrate_task_tags(
                    session, organization_id, [t.id for t in tasks]
                )

                return BulkUpdateTasksResponse(
                    tasks=[task_to_proto(t, user_role, tags=tags_by_id.get(t.id)) for t in tasks],
                    updated_count=len(tasks),
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("bulk_update_tasks", exc) from exc

    async def delete_task(
        self,
        request: DeleteTaskRequest,
        ctx: RequestContext,
    ) -> DeleteTaskResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        task_id = parse_uuid(request.task_id, "task_id")

        try:
            async with open_session() as session:
                ops = TaskOperations(
                    session,
                    storage=self.storage,
                    search_indexer=self.search_indexer,
                )
                await ops.delete(user_id, organization_id, task_id, permanent=request.permanent)
                return DeleteTaskResponse(success=True, message="Task deleted successfully")
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("delete_task", exc) from exc

    async def delete_tasks(
        self,
        request: DeleteTasksRequest,
        ctx: RequestContext,
    ) -> DeleteTasksResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")

        try:
            async with open_session() as session:
                ops = TaskOperations(
                    session,
                    storage=self.storage,
                    search_indexer=self.search_indexer,
                )
                count = 0
                for task_id_str in request.task_ids:
                    try:
                        task_id = UUID(task_id_str)
                        await ops.delete(
                            user_id, organization_id, task_id, permanent=request.permanent
                        )
                        count += 1
                    except NotFoundError, PermissionDeniedError, ValueError:
                        continue
                return DeleteTasksResponse(success=True, deleted_count=count)
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("delete_tasks", exc) from exc

    async def list_tasks(
        self,
        request: ListTasksRequest,
        ctx: RequestContext,
    ) -> ListTasksResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        project_id = parse_uuid(request.project_id, "project_id")

        page = 1
        page_size = 500
        if request.has_field("pagination"):
            page = request.pagination.page if request.pagination.page > 0 else 1
            page_size = min(
                request.pagination.page_size if request.pagination.page_size > 0 else 500,
                1000,
            )

        parent_id: UUID | None = None
        if request.has_field("parent_id") and request.parent_id:
            parent_id = parse_uuid(request.parent_id, "parent_id")

        try:
            async with open_session() as session:
                ops = TaskReader(session)
                tasks, total = await ops.list_tasks(
                    user_id=user_id,
                    organization_id=organization_id,
                    project_id=project_id,
                    include_deleted=(
                        request.include_deleted if request.has_field("include_deleted") else False
                    ),
                    parent_id=parent_id,
                    task_filter=request.filter if request.has_field("filter") else None,
                    sort=list(request.sort),
                    time_zone=request.time_zone if request.has_field("time_zone") else None,
                    page=page,
                    page_size=page_size,
                )

                total_pages = (total + page_size - 1) // page_size

                project_ops = ProjectOperations(session, self.storage, self.search_indexer)
                project = await project_ops.get_by_id(user_id, organization_id, project_id)
                user_role = await project_ops._resolve_role(user_id, organization_id, project)

                task_ids = [t.id for t in tasks]
                subtask_counts = await queries.get_subtask_counts(session, task_ids)
                tags_by_id = await _hydrate_task_tags(session, organization_id, task_ids)

                task_protos = []
                for t in tasks:
                    st_total, st_done = subtask_counts.get(t.id, (0, 0))
                    task_protos.append(
                        task_to_proto(
                            t,
                            user_role,
                            subtask_total=st_total,
                            subtask_completed=st_done,
                            tags=tags_by_id.get(t.id),
                        )
                    )

                return ListTasksResponse(
                    tasks=task_protos,
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
            raise map_domain_error("list_tasks", exc) from exc

    async def list_activities(
        self,
        request: ListActivitiesRequest,
        ctx: RequestContext,
    ) -> ListActivitiesResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        task_id = parse_uuid(request.task_id, "task_id")

        page = 1
        page_size = 50
        if request.has_field("pagination"):
            page = request.pagination.page if request.pagination.page > 0 else 1
            if request.pagination.page_size > 0:
                page_size = min(request.pagination.page_size, 200)
            else:
                page_size = 50

        try:
            async with open_session() as session:
                task_ops = TaskReader(session)
                await task_ops.get_by_id(user_id, organization_id, task_id)

                activities, total = await queries.get_activities_for_task(
                    session,
                    task_id,
                    page=page,
                    page_size=page_size,
                )

                total_pages = (total + page_size - 1) // page_size

                return ListActivitiesResponse(
                    activities=[activity_to_proto(a) for a in activities],
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
            raise map_domain_error("list_activities", exc) from exc
