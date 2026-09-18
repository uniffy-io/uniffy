"""Project lifecycle operations."""

import re
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.content.base_operations import BaseContentOperations
from uniffy.core.errors import ValidationError
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.task import Task
from uniffy.core.models.projects.view_config import ProjectViewVisibility
from uniffy.core.search.engine import SearchTerm, all_of
from uniffy.core.search.indexer import SearchIndexer, build_content_urn
from uniffy.core.storage import ObjectStorage
from uniffy.core.types import (
    AccessMode,
    ContentRole,
    ContentType,
    SubjectType,
)
from uniffy.domains.files.attachments.purge import purge_attachments_for_content
from uniffy.domains.permissions.members import (
    ContentMembersOperations,
    StagedContentMemberAdd,
)
from uniffy.domains.projects import queries
from uniffy.domains.projects.defaults import (
    stage_default_project_fields,
    stage_default_project_views,
)
from uniffy.domains.projects.registration import register_project_content
from uniffy.domains.search.rename import propagate_rename
from uniffy.domains.tags.operations import StagedManualTagReplacement, TagOperations

logger = logger.bind(component="projects.projects")

_SLUG_PATTERN = re.compile(r"^[A-Z][A-Z0-9]{1,4}$")


@dataclass(frozen=True)
class _StagedProjectCreate:
    project: Project
    members: tuple[StagedContentMemberAdd, ...]
    tags: StagedManualTagReplacement | None


class ProjectOperations(BaseContentOperations[Project]):
    content_type = ContentType.PROJECT
    model_class = Project

    def __init__(
        self,
        session: AsyncSession,
        storage: ObjectStorage | None = None,
        search_indexer: SearchIndexer | None = None,
    ) -> None:
        register_project_content()
        super().__init__(session, search_indexer)
        self._storage = storage

    @property
    def storage(self) -> ObjectStorage:
        if self._storage is None:
            raise RuntimeError("Object storage is required for project attachment mutations")
        return self._storage

    def _build_search_keywords(self, model: Project) -> str:
        parts = [model.name]
        if model.description:
            parts.append(model.description)
        return " ".join(parts)

    def _get_search_title(self, model: Project) -> str:
        return model.name

    def _get_url_path(self, model: Project) -> str:
        return f"/projects/{model.id}"

    def _get_search_description(self, model: Project) -> str | None:
        if model.description:
            return model.description[:200]
        return None

    async def _get_search_tags_async(self, model: Project) -> list[str] | None:
        tag_ops = TagOperations(self.session, self.search_indexer)
        urn = build_content_urn(self.content_type, model.id)
        bulk = await tag_ops.get_for_urns(
            organization_id=model.organization_id,
            content_urns=[urn],
        )
        slugs = sorted({tag.slug for tag in bulk.get(urn, [])})
        return slugs or None

    async def _sync_project_tags(
        self,
        *,
        actor_id: UUID,
        project: Project,
        tag_ids: list[UUID] | None,
    ) -> None:
        """``tag_ids=None`` leaves manual assignments untouched."""
        if tag_ids is None:
            return
        tag_ops = TagOperations(self.session, self.search_indexer)
        await tag_ops.replace_manual_tags(
            actor_id=actor_id,
            organization_id=project.organization_id,
            content_urn=build_content_urn(self.content_type, project.id),
            tag_ids=tag_ids,
        )

    async def create(
        self,
        user_id: UUID,
        organization_id: UUID,
        name: str,
        description: str = "",
        icon: str = "folder",
        color: str = "#3b82f6",
        access_mode: AccessMode | None = None,
        baseline_role: ContentRole | None = None,
        group_ids: list[UUID] | None = None,
        slug: str | None = None,
        tag_ids: list[UUID] | None = None,
    ) -> Project:
        access_mode, baseline_role = await self._resolve_access_policy(
            organization_id, access_mode, baseline_role
        )

        resolved_slug = await self._resolve_slug(organization_id, name, slug)
        project = Project(
            organization_id=organization_id,
            owner_id=user_id,
            name=name,
            description=description,
            icon=icon,
            color=color,
            access_mode=access_mode,
            baseline_role=baseline_role,
            slug=resolved_slug,
            task_counter=0,
        )
        self.session.add(project)
        staged_members: list[StagedContentMemberAdd] = []
        staged_tags = None
        try:
            await self.session.flush()
            await stage_default_project_fields(self.session, project.id)
            project.default_view_id = await stage_default_project_views(self.session, project)

            members_ops = ContentMembersOperations(self.session, self.search_indexer)
            for gid in group_ids or []:
                staged_members.append(
                    await members_ops.stage_member(
                        actor_user_id=user_id,
                        organization_id=organization_id,
                        content_type=self.content_type,
                        content_id=project.id,
                        subject_type=SubjectType.GROUP,
                        subject_id=gid,
                        role=ContentRole.VIEWER,
                    )
                )

            if tag_ids is not None:
                staged_tags = await TagOperations(
                    self.session,
                    self.search_indexer,
                ).stage_manual_tags(
                    actor_id=user_id,
                    organization_id=organization_id,
                    content_urn=build_content_urn(self.content_type, project.id),
                    tag_ids=tag_ids,
                )
            await self.session.commit()
        except Exception:
            await self.session.rollback()
            raise
        await self.session.refresh(project)

        await self._finish_project_create_after_commit(
            _StagedProjectCreate(project, tuple(staged_members), staged_tags)
        )

        return project

    async def _finish_project_create_after_commit(self, staged: _StagedProjectCreate) -> None:
        project = staged.project
        members_ops = ContentMembersOperations(self.session, self.search_indexer)
        for member in staged.members:
            try:
                await members_ops.finish_member_add_after_commit(member)
            except Exception:
                logger.opt(exception=True).warning(
                    "Project created with degraded initial member fanout",
                    project_id=str(project.id),
                )

        if staged.tags is not None:
            try:
                await TagOperations(
                    self.session,
                    self.search_indexer,
                ).finish_manual_tags_after_commit(staged.tags)
            except Exception:
                logger.opt(exception=True).warning(
                    "Project created with degraded tag projection",
                    project_id=str(project.id),
                )

        try:
            await self._index_for_search(project, skip_member_lookup=not staged.members)
        except Exception:
            logger.opt(exception=True).warning(
                "Project created with stale search projection",
                project_id=str(project.id),
            )

        try:
            effective_mode, _ = await self._effective_policy(project.organization_id, project)
            await self._broadcast_open_to_org_create(
                project.organization_id,
                project.id,
                effective_mode,
            )
        except Exception:
            logger.opt(exception=True).warning(
                "Project created with degraded access fanout",
                project_id=str(project.id),
            )

    async def update(
        self,
        user_id: UUID,
        organization_id: UUID,
        project_id: UUID,
        **kwargs,
    ) -> Project:
        """Access-policy changes go through ``permissions.v1.MembersService``, never this method."""
        project = await self.get_by_id(user_id, organization_id, project_id)
        await self._require_manage(user_id, organization_id, project)

        kwargs.pop("access_mode", None)
        kwargs.pop("baseline_role", None)
        tag_ids = kwargs.pop("tag_ids", None)

        name_changed = "name" in kwargs and kwargs["name"] != project.name  # noqa: PLR2004

        if "default_view_id" in kwargs:  # noqa: PLR2004 - update keyword name
            project.default_view_id = await self._resolve_default_view_id(
                project.id, kwargs.pop("default_view_id")
            )

        for key, value in kwargs.items():
            if value is not None and hasattr(project, key):
                setattr(project, key, value)

        project.version += 1
        project.updated_at = datetime.now(UTC)

        await self.session.commit()
        await self.session.refresh(project)

        await self._sync_project_tags(
            actor_id=user_id,
            project=project,
            tag_ids=tag_ids,
        )

        await self._index_for_search(project)
        await self.session.commit()

        if name_changed:
            try:
                project_urn = build_content_urn(self.content_type, project.id)
                await propagate_rename(
                    session=self.session,
                    organization_id=organization_id,
                    target_urn=project_urn,
                    new_label=project.name,
                )
            except Exception:
                logger.opt(exception=True).warning(
                    "Failed to propagate project rename to mentions", project_id=str(project_id)
                )

        return project

    async def _resolve_default_view_id(self, project_id: UUID, view_id: str | None) -> str | None:
        """An empty id clears the default; anything else must be a shared view of the project."""
        if not view_id:
            return None
        view = await queries.get_view(self.session, project_id, view_id)
        if view is None or view.visibility != ProjectViewVisibility.SHARED:
            raise ValidationError(
                "default_view_id", "The default view must be a shared view of this project"
            )
        return view_id

    async def delete(
        self,
        user_id: UUID,
        organization_id: UUID,
        project_id: UUID,
        permanent: bool = False,
    ) -> bool:
        project = await self.get_by_id(user_id, organization_id, project_id)
        await self._require_delete(user_id, organization_id, project)

        if permanent:
            tag_ops = TagOperations(self.session, self.search_indexer)
            project_urn = build_content_urn(self.content_type, project_id)
            await tag_ops.unassign_all_for_urn(
                actor_id=user_id,
                organization_id=organization_id,
                content_urn=project_urn,
            )
            task_id_rows = await self.session.execute(
                select(Task.id).where(Task.project_id == project_id)
            )
            task_ids = [task_id for (task_id,) in task_id_rows]
            for task_id in task_ids:
                await tag_ops.unassign_all_for_urn(
                    actor_id=user_id,
                    organization_id=organization_id,
                    content_urn=build_content_urn(ContentType.TASK, task_id),
                )

            await purge_attachments_for_content(
                self.session,
                self.storage,
                self.search_indexer,
                organization_id=organization_id,
                content_type=self.content_type,
                content_ids=[project_id],
            )
            await purge_attachments_for_content(
                self.session,
                self.storage,
                self.search_indexer,
                organization_id=organization_id,
                content_type=ContentType.TASK,
                content_ids=task_ids,
            )

            await queries.delete_project_cascade(self.session, project_id)
            await self.session.delete(project)
        else:
            project.is_deleted = True
            project.deleted_at = datetime.now(UTC)

        await write_audit_event(
            self.session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=(Action.PROJECT_PERMANENTLY_DELETED if permanent else Action.PROJECT_DELETED),
            resource_type=AuditResourceType.PROJECT,
            resource_id=project_id,
            details={"name": project.name},
        )

        await self.session.commit()
        await self.search_indexer.remove(
            build_content_urn(self.content_type, project_id), organization_id
        )
        # Drop tasks indexed under this project; ``metadata.project_id`` is filterable.
        await self.search_indexer.remove_by_filter(
            all_of(
                SearchTerm("entity_type", "task"),
                SearchTerm("metadata.project_id", str(project_id)),
            )
        )
        return True

    async def list_projects(
        self,
        user_id: UUID,
        organization_id: UUID,
        access_mode: AccessMode | None = None,
        include_deleted: bool = False,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[list[Project], int]:
        query = select(Project).where(Project.organization_id == organization_id)

        access_filter = await self.access_query.build_accessible_filter(
            user_id=user_id,
            organization_id=organization_id,
            content_type=self.content_type,
            content_id_column=Project.id,
            owner_id_column=Project.owner_id,
            access_mode_column=Project.access_mode,
            baseline_role_column=Project.baseline_role,
        )
        query = query.where(access_filter)

        if access_mode is not None:
            query = query.where(Project.access_mode == access_mode)

        if not include_deleted:
            query = query.where(Project.is_deleted == False)  # noqa: E712

        count_result = await self.session.execute(select(func.count()).select_from(query.subquery()))
        total = count_result.scalar_one()

        query = query.order_by(Project.updated_at.desc())
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self.session.execute(query)
        projects = list(result.scalars().all())

        return projects, total

    def _generate_slug_candidate(self, name: str) -> str:
        words = [w for w in name.split() if w]
        if len(words) >= 2:
            candidate = "".join(w[0] for w in words)[:5].upper()
        else:
            cleaned = re.sub(r"[^a-zA-Z0-9]", "", name)
            candidate = cleaned[:3].upper() if cleaned else "PRJ"
        return candidate if len(candidate) >= 2 else (candidate + "PROJ")[:5]

    async def _resolve_slug(
        self,
        organization_id: UUID,
        name: str,
        requested_slug: str | None,
    ) -> str:
        candidate = requested_slug.upper() if requested_slug else self._generate_slug_candidate(name)
        if not _SLUG_PATTERN.match(candidate):
            raise ValidationError(
                "slug",
                f"Slug '{candidate}' must be 2-5 uppercase letters/digits starting with a letter",
            )
        for suffix in ["", "2", "3", "4", "5", "6", "7", "8", "9"]:
            slug_to_try = candidate + suffix
            exists = await self.session.execute(
                select(Project).where(
                    Project.organization_id == organization_id,
                    Project.slug == slug_to_try,
                    Project.is_deleted == False,  # noqa: E712
                )
            )
            if exists.scalar_one_or_none() is None:
                return slug_to_try
        return candidate[:4] + secrets.token_hex(1).upper()
