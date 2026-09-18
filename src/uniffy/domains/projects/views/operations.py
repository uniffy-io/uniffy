"""Saved view operations on a project."""

import secrets
from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from uniffy_proto.projects.v1.projects_pb2 import ViewDefinition

from uniffy.core.auth.permissions.roles import role_can_edit, role_can_manage
from uniffy.core.converters.common_proto import content_type_to_proto
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.events.realtime import ContentAccessAction, publish_content_access_changed
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.view_config import ProjectViewVisibility, ViewConfig
from uniffy.core.types import ContentRole, ContentType
from uniffy.domains.projects import queries
from uniffy.domains.projects.audience import resolve_project_audience
from uniffy.domains.projects.projects import ProjectOperations
from uniffy.domains.projects.views.definition import (
    definition_to_dict,
    prepare_definition,
    validate_view_name,
)

logger = logger.bind(component="projects.views.operations")

_RESOURCE = "project view"


class ProjectViewOperations:
    """Personal views belong to their owner; shared views need EDITOR, their order ADMIN.

    Every call first requires VIEW on the project, so a caller who lost access to the
    project reaches none of its views, their own personal ones included.
    """

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def _load(
        self, user_id: UUID, organization_id: UUID, project_id: UUID
    ) -> tuple[Project, ContentRole | None]:
        project_ops = ProjectOperations(self.session)
        project = await project_ops.get_by_id(user_id, organization_id, project_id)
        role = await project_ops._resolve_role(user_id, organization_id, project)
        return project, role

    async def _load_view(self, project_id: UUID, view_id: str) -> ViewConfig:
        view = await queries.get_view(self.session, project_id, view_id)
        if view is None:
            raise NotFoundError("View", view_id)
        return view

    @staticmethod
    def _require_view_access(
        view: ViewConfig, user_id: UUID, role: ContentRole | None, action: str
    ) -> None:
        if view.visibility == ProjectViewVisibility.PERSONAL:
            if view.owner_id != user_id:
                raise PermissionDeniedError(action, _RESOURCE)
        elif not role_can_edit(role):
            raise PermissionDeniedError(action, _RESOURCE)

    async def _next_sort_order(
        self, project_id: UUID, visibility: ProjectViewVisibility, owner_id: UUID
    ) -> int:
        query = select(func.max(ViewConfig.sort_order)).where(
            ViewConfig.project_id == project_id,
            ViewConfig.visibility == visibility,
        )
        if visibility == ProjectViewVisibility.PERSONAL:
            query = query.where(ViewConfig.owner_id == owner_id)
        current = (await self.session.execute(query)).scalar()
        return 0 if current is None else current + 1

    async def create(
        self,
        user_id: UUID,
        organization_id: UUID,
        project_id: UUID,
        *,
        name: str,
        definition: ViewDefinition,
        visibility: ProjectViewVisibility,
    ) -> ViewConfig:
        project, role = await self._load(user_id, organization_id, project_id)
        if visibility == ProjectViewVisibility.SHARED and not role_can_edit(role):
            raise PermissionDeniedError("create shared views", _RESOURCE)

        fields = await queries.get_fields_for_project(self.session, project_id)
        normalized, view_type = prepare_definition(definition, fields)
        view = ViewConfig(
            id=f"view_{secrets.token_hex(8)}",
            project_id=project_id,
            organization_id=project.organization_id,
            owner_id=user_id,
            name=validate_view_name(name),
            type=view_type,
            visibility=visibility,
            sort_order=await self._next_sort_order(project_id, visibility, user_id),
            definition=definition_to_dict(normalized),
        )
        self.session.add(view)
        await self.session.commit()
        await self.session.refresh(view)

        if visibility == ProjectViewVisibility.SHARED:
            await self._publish_views_changed(project)
        return view

    async def update(
        self,
        user_id: UUID,
        organization_id: UUID,
        project_id: UUID,
        view_id: str,
        *,
        name: str | None = None,
        definition: ViewDefinition | None = None,
        visibility: ProjectViewVisibility | None = None,
    ) -> ViewConfig:
        project, role = await self._load(user_id, organization_id, project_id)
        view = await self._load_view(project_id, view_id)
        self._require_view_access(view, user_id, role, "edit")
        was_shared = view.visibility == ProjectViewVisibility.SHARED

        if name is not None:
            view.name = validate_view_name(name)

        if definition is not None:
            fields = await queries.get_fields_for_project(self.session, project_id)
            normalized, view_type = prepare_definition(definition, fields)
            if view_type != view.type:
                raise ValidationError("definition", "A view's layout cannot change")
            view.definition = definition_to_dict(normalized)

        if visibility is not None and visibility != view.visibility:
            if visibility == ProjectViewVisibility.SHARED and not role_can_edit(role):
                raise PermissionDeniedError("share views", _RESOURCE)
            if visibility == ProjectViewVisibility.PERSONAL:
                if view.owner_id != user_id:
                    raise PermissionDeniedError("make shared views personal", _RESOURCE)
                if project.default_view_id == view.id:
                    raise ValidationError("visibility", "The project default view must stay shared")
            view.sort_order = await self._next_sort_order(project_id, visibility, view.owner_id)
            view.visibility = visibility

        view.updated_at = datetime.now(UTC)
        await self.session.commit()
        await self.session.refresh(view)

        if was_shared or view.visibility == ProjectViewVisibility.SHARED:
            await self._publish_views_changed(project)
        return view

    async def delete(
        self,
        user_id: UUID,
        organization_id: UUID,
        project_id: UUID,
        view_id: str,
    ) -> None:
        project, role = await self._load(user_id, organization_id, project_id)
        view = await self._load_view(project_id, view_id)
        self._require_view_access(view, user_id, role, "delete")
        was_shared = view.visibility == ProjectViewVisibility.SHARED

        if project.default_view_id == view.id:
            project.default_view_id = None
        await self.session.delete(view)
        await self.session.commit()

        if was_shared:
            await self._publish_views_changed(project)

    async def reorder(
        self,
        user_id: UUID,
        organization_id: UUID,
        project_id: UUID,
        *,
        visibility: ProjectViewVisibility,
        view_ids: list[str],
    ) -> list[ViewConfig]:
        project, role = await self._load(user_id, organization_id, project_id)
        if visibility == ProjectViewVisibility.SHARED and not role_can_manage(role):
            raise PermissionDeniedError("reorder shared views", _RESOURCE)

        scope = await queries.get_views_in_scope(
            self.session, project_id, visibility, user_id, for_update=True
        )
        by_id = {view.id: view for view in scope}
        if len(set(view_ids)) != len(view_ids) or set(view_ids) != set(by_id):
            raise ValidationError(
                "view_ids", "Reorder must list every view in the scope exactly once"
            )
        for sort_order, view_id in enumerate(view_ids):
            by_id[view_id].sort_order = sort_order
        await self.session.commit()

        if visibility == ProjectViewVisibility.SHARED:
            await self._publish_views_changed(project)
        return await queries.get_views_for_project(self.session, project_id, user_id)

    async def _publish_views_changed(self, project: Project) -> None:
        """Runs after commit; a failed publish leaves clients to refetch on their next load."""
        try:
            audience = await resolve_project_audience(self.session, project.organization_id, project)
            await publish_content_access_changed(
                content_type=content_type_to_proto(ContentType.PROJECT),
                content_id=project.id,
                action=ContentAccessAction.VIEWS_CHANGED,
                organization_id=project.organization_id,
                target_user_ids=audience,
            )
        except Exception:
            logger.opt(exception=True).warning(
                "Publishing a project view change failed", project_id=str(project.id)
            )
