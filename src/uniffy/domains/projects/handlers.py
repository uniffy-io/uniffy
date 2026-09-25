"""Project RPC handlers."""

from typing import NamedTuple
from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from uniffy_proto.common.v1.common_pb import PaginationResponse
from uniffy_proto.projects.v1.projects_pb import (
    CreateProjectRequest,
    CreateProjectResponse,
    DeleteProjectRequest,
    DeleteProjectResponse,
    GetProjectRequest,
    GetProjectResponse,
    ListProjectsRequest,
    ListProjectsResponse,
    UpdateProjectRequest,
    UpdateProjectResponse,
)

from uniffy.core.auth.permissions import resolve_effective_policy
from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.auth.principal import current_user_id
from uniffy.core.converters.common_proto import (
    access_mode_from_proto,
    content_role_from_proto,
)
from uniffy.core.models.projects.project import Project
from uniffy.core.models.tags.tag import Tag
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import ContentType
from uniffy.domains.permissions.access import ResourceAccessResolver, ResourceKey
from uniffy.domains.projects import queries
from uniffy.domains.projects.converters import project_to_proto
from uniffy.domains.projects.projects import ProjectOperations
from uniffy.domains.projects.rpc import map_domain_error, parse_uuid
from uniffy.domains.projects.tasks.requests import parse_tag_ids
from uniffy.domains.tags.reader import TagReader
from uniffy.infrastructure.database import open_session


async def _hydrate_project_tags(
    session: AsyncSession,
    organization_id: UUID,
    project_ids: list[UUID],
) -> dict[UUID, list[Tag]]:
    if not project_ids:
        return {}
    urn_to_id = {build_content_urn(ContentType.PROJECT, pid): pid for pid in project_ids}
    tag_ops = TagReader(session)
    bulk = await tag_ops.get_for_urns(
        organization_id=organization_id,
        content_urns=list(urn_to_id),
    )
    return {pid: bulk.get(urn, []) for urn, pid in urn_to_id.items()}


class _ProjectCounts(NamedTuple):
    """Everything `project_to_proto` needs beyond the row itself."""

    task_total: int
    task_done: int
    members: int
    overdue: int
    estimated_minutes: int
    time_spent_minutes: int


class _ProjectRollups(NamedTuple):
    """Per-project counts keyed by project id, all defaulting to zero."""

    tasks: dict[UUID, queries.ProjectTaskRollup]
    members: dict[UUID, int]

    def for_project(self, project_id: UUID) -> _ProjectCounts:
        task = self.tasks.get(project_id)
        return _ProjectCounts(
            task_total=task.total if task else 0,
            task_done=task.completed if task else 0,
            members=self.members.get(project_id, 0),
            overdue=task.overdue if task else 0,
            estimated_minutes=task.estimated_minutes if task else 0,
            time_spent_minutes=task.time_spent_minutes if task else 0,
        )


async def _load_project_rollups(
    session: AsyncSession,
    organization_id: UUID,
    project_ids: list[UUID],
) -> _ProjectRollups:
    return _ProjectRollups(
        tasks=await queries.get_task_rollups_for_projects(session, organization_id, project_ids),
        members=await queries.get_member_counts_for_projects(session, organization_id, project_ids),
    )


async def _resolve_project_effective_policy(
    session: AsyncSession,
    organization_id: UUID,
    project: Project,
    checker: PermissionChecker | None = None,
):
    permission_checker = checker or PermissionChecker(session)
    default_mode, default_baseline = await permission_checker.get_org_defaults(
        organization_id,
        ContentType.PROJECT,
    )
    return resolve_effective_policy(
        project.access_mode,
        project.baseline_role,
        default_mode,
        default_baseline,
    )


class ProjectsHandlers:
    async def create_project(
        self,
        request: CreateProjectRequest,
        ctx: RequestContext,
    ) -> CreateProjectResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")

        access_mode = access_mode_from_proto(request.access_mode) if request.access_mode else None
        baseline_role = (
            content_role_from_proto(request.baseline_role) if request.baseline_role else None
        )
        slug = request.slug if request.has_field("slug") else None

        tag_ids = parse_tag_ids(list(request.tag_ids))

        try:
            async with open_session() as session:
                ops = ProjectOperations(session, self.storage, self.search_indexer)
                project = await ops.create(
                    user_id=user_id,
                    organization_id=organization_id,
                    name=request.name,
                    description=request.description if request.has_field("description") else "",
                    icon=request.icon if request.has_field("icon") else "folder",
                    color=request.color if request.has_field("color") else "#3b82f6",
                    access_mode=access_mode,
                    baseline_role=baseline_role,
                    slug=slug,
                    tag_ids=tag_ids or None,
                )
                user_role = await ops._resolve_role(user_id, organization_id, project)
                fields = await queries.get_fields_for_project(session, project.id)
                views = await queries.get_views_for_project(session, project.id, user_id)
                tags_by_id = await _hydrate_project_tags(session, organization_id, [project.id])
                eff_mode, eff_baseline = await _resolve_project_effective_policy(
                    session,
                    organization_id,
                    project,
                )
                return CreateProjectResponse(
                    project=project_to_proto(
                        project,
                        fields,
                        views,
                        user_role,
                        tags=tags_by_id.get(project.id),
                        effective_access_mode=eff_mode,
                        effective_baseline_role=eff_baseline,
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("create_project", exc) from exc

    async def get_project(
        self,
        request: GetProjectRequest,
        ctx: RequestContext,
    ) -> GetProjectResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        project_id = parse_uuid(request.project_id, "project_id")

        try:
            async with open_session() as session:
                ops = ProjectOperations(session, self.storage, self.search_indexer)
                project = await ops.get_by_id(user_id, organization_id, project_id)
                user_role = await ops._resolve_role(user_id, organization_id, project)

                fields = await queries.get_fields_for_project(session, project.id)
                views = await queries.get_views_for_project(session, project.id, user_id)
                tags_by_id = await _hydrate_project_tags(session, organization_id, [project.id])
                eff_mode, eff_baseline = await _resolve_project_effective_policy(
                    session,
                    organization_id,
                    project,
                )
                rollups = await _load_project_rollups(session, organization_id, [project.id])
                counts = rollups.for_project(project.id)

                return GetProjectResponse(
                    project=project_to_proto(
                        project,
                        fields,
                        views,
                        user_role,
                        tags=tags_by_id.get(project.id),
                        effective_access_mode=eff_mode,
                        effective_baseline_role=eff_baseline,
                        task_count=counts.task_total,
                        completed_task_count=counts.task_done,
                        member_count=counts.members,
                        overdue_task_count=counts.overdue,
                        estimated_minutes=counts.estimated_minutes,
                        time_spent_minutes=counts.time_spent_minutes,
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("get_project", exc) from exc

    async def update_project(
        self,
        request: UpdateProjectRequest,
        ctx: RequestContext,
    ) -> UpdateProjectResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        project_id = parse_uuid(request.project_id, "project_id")

        updates: dict = {}
        if request.has_field("name"):
            updates["name"] = request.name
        if request.has_field("description"):
            updates["description"] = request.description
        if request.has_field("icon"):
            updates["icon"] = request.icon
        if request.has_field("color"):
            updates["color"] = request.color
        if request.has_field("default_view_id"):
            updates["default_view_id"] = request.default_view_id
        if request.has_field("slug"):
            updates["slug"] = request.slug
        if request.type_field_schemas:
            updates["type_field_schemas"] = {
                type_name: {
                    "shown_field_ids": list(schema.shown_field_ids),
                    "required_field_ids": list(schema.required_field_ids),
                }
                for type_name, schema in request.type_field_schemas.items()
            }
        if request.has_field("tag_ids"):
            updates["tag_ids"] = parse_tag_ids(list(request.tag_ids.ids))

        try:
            async with open_session() as session:
                ops = ProjectOperations(session, self.storage, self.search_indexer)
                try:
                    project = await ops.update(user_id, organization_id, project_id, **updates)
                except IntegrityError as exc:
                    raise ConnectError(
                        Code.ALREADY_EXISTS,
                        "A project with that slug already exists",
                    ) from exc

                user_role = await ops._resolve_role(user_id, organization_id, project)
                fields = await queries.get_fields_for_project(session, project.id)
                views = await queries.get_views_for_project(session, project.id, user_id)
                tags_by_id = await _hydrate_project_tags(session, organization_id, [project.id])
                eff_mode, eff_baseline = await _resolve_project_effective_policy(
                    session,
                    organization_id,
                    project,
                )
                rollups = await _load_project_rollups(session, organization_id, [project.id])
                counts = rollups.for_project(project.id)
                return UpdateProjectResponse(
                    project=project_to_proto(
                        project,
                        fields,
                        views,
                        user_role,
                        tags=tags_by_id.get(project.id),
                        effective_access_mode=eff_mode,
                        effective_baseline_role=eff_baseline,
                        task_count=counts.task_total,
                        completed_task_count=counts.task_done,
                        member_count=counts.members,
                        overdue_task_count=counts.overdue,
                        estimated_minutes=counts.estimated_minutes,
                        time_spent_minutes=counts.time_spent_minutes,
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("update_project", exc) from exc

    async def delete_project(
        self,
        request: DeleteProjectRequest,
        ctx: RequestContext,
    ) -> DeleteProjectResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        project_id = parse_uuid(request.project_id, "project_id")

        try:
            async with open_session() as session:
                ops = ProjectOperations(session, self.storage, self.search_indexer)
                await ops.delete(user_id, organization_id, project_id, permanent=request.permanent)
                return DeleteProjectResponse(success=True, message="Project deleted successfully")
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("delete_project", exc) from exc

    async def list_projects(
        self,
        request: ListProjectsRequest,
        ctx: RequestContext,
    ) -> ListProjectsResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")

        page = 1
        page_size = 50
        if request.has_field("pagination"):
            page = request.pagination.page if request.pagination.page > 0 else 1
            page_size = min(
                request.pagination.page_size if request.pagination.page_size > 0 else 50,
                100,
            )

        access_mode = access_mode_from_proto(request.access_mode) if request.access_mode else None

        try:
            async with open_session() as session:
                ops = ProjectOperations(session, self.storage, self.search_indexer)
                projects, total = await ops.list_projects(
                    user_id=user_id,
                    organization_id=organization_id,
                    access_mode=access_mode,
                    include_deleted=(
                        request.include_deleted if request.has_field("include_deleted") else False
                    ),
                    page=page,
                    page_size=page_size,
                )

                project_ids = [p.id for p in projects]
                fields_map = await queries.get_fields_for_projects(session, project_ids)
                views_map = await queries.get_views_for_projects(session, project_ids, user_id)
                tags_by_id = await _hydrate_project_tags(session, organization_id, project_ids)
                rollups = await _load_project_rollups(session, organization_id, project_ids)

                checker = PermissionChecker(session)
                default_mode, default_baseline = await checker.get_org_defaults(
                    organization_id,
                    ContentType.PROJECT,
                )
                decisions = await ResourceAccessResolver(session).resolve_page(
                    actor_id=user_id,
                    organization_id=organization_id,
                    keys=[ResourceKey(ContentType.PROJECT, project.id) for project in projects],
                )
                project_protos = []
                for project in projects:
                    user_role = decisions[ResourceKey(ContentType.PROJECT, project.id)].role
                    fields = fields_map.get(str(project.id), [])
                    views = views_map.get(str(project.id), [])
                    eff_mode, eff_baseline = resolve_effective_policy(
                        project.access_mode,
                        project.baseline_role,
                        default_mode,
                        default_baseline,
                    )
                    counts = rollups.for_project(project.id)
                    project_protos.append(
                        project_to_proto(
                            project,
                            fields,
                            views,
                            user_role,
                            tags=tags_by_id.get(project.id),
                            effective_access_mode=eff_mode,
                            effective_baseline_role=eff_baseline,
                            task_count=counts.task_total,
                            completed_task_count=counts.task_done,
                            member_count=counts.members,
                            overdue_task_count=counts.overdue,
                            estimated_minutes=counts.estimated_minutes,
                            time_spent_minutes=counts.time_spent_minutes,
                        )
                    )

                total_pages = (total + page_size - 1) // page_size

                return ListProjectsResponse(
                    projects=project_protos,
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
            raise map_domain_error("list_projects", exc) from exc
