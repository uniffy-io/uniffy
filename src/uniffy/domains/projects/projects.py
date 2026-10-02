"""Project lifecycle operations."""

import re
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.content.base_operations import BaseContentOperations
from uniffy.core.errors import NotFoundError, ValidationError
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.task import Task
from uniffy.core.models.projects.view_config import ProjectViewVisibility
from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime.publisher import publish_perm_change
from uniffy.core.realtime.storage import lock_document, lock_documents
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
from uniffy.domains.projects.audience import publish_views_changed
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

    async def get_for_view_mutation(
        self, user_id: UUID, organization_id: UUID, project_id: UUID
    ) -> Project:
        """Serialize view mutations with default selection and refresh cached project state."""
        project = await self.session.scalar(
            select(Project)
            .where(
                Project.id == project_id,
                Project.organization_id == organization_id,
                Project.is_deleted.is_(False),
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if project is None:
            raise NotFoundError(self.content_type.value, project_id)
        await self._require_view(user_id, organization_id, project)
        return project

    async def update(
        self,
        user_id: UUID,
        organization_id: UUID,
        project_id: UUID,
        **kwargs,
    ) -> Project:
        """Access-policy changes go through ``permissions.v1.MembersService``, never this method."""
        project = (
            await self.get_for_view_mutation(user_id, organization_id, project_id)
            if "default_view_id" in kwargs  # noqa: PLR2004 - update keyword name
            else await self.get_by_id(user_id, organization_id, project_id)
        )
        await self._require_manage(user_id, organization_id, project)

        kwargs.pop("access_mode", None)
        kwargs.pop("baseline_role", None)
        tag_ids = kwargs.pop("tag_ids", None)

        name_changed = "name" in kwargs and kwargs["name"] != project.name  # noqa: PLR2004

        default_changed = False
        if "default_view_id" in kwargs:  # noqa: PLR2004 - update keyword name
            default_view_id = await self._resolve_default_view_id(
                project.id, kwargs.pop("default_view_id")
            )
            default_changed = default_view_id != project.default_view_id
            project.default_view_id = default_view_id

        if "slug" in kwargs:  # noqa: PLR2004 - update keyword name
            project.slug = await self._resolve_renamed_slug(project, kwargs.pop("slug"))

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

        if default_changed:
            await publish_views_changed(self.session, project)

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
        await lock_document(self.session, (ContentType.PROJECT, project_id))
        project = await self.get_by_id(user_id, organization_id, project_id)
        await self._require_delete(user_id, organization_id, project)

        task_ids_query = select(Task.id).where(
            Task.project_id == project_id, Task.organization_id == organization_id
        )
        task_ids = list((await self.session.scalars(task_ids_query)).all())
        await lock_documents(self.session, [(ContentType.TASK, task_id) for task_id in task_ids])
        staged_tags = []
        await self.session.execute(
            delete(RealtimeYjsSnapshot).where(
                RealtimeYjsSnapshot.content_type == ContentType.TASK,
                RealtimeYjsSnapshot.content_id.in_(task_ids_query),
            )
        )
        if permanent:
            tag_ops = TagOperations(self.session, self.search_indexer)
            project_urn = build_content_urn(self.content_type, project_id)
            staged_tags.append(
                await tag_ops.stage_unassign_all_for_urn(
                    actor_id=user_id,
                    organization_id=organization_id,
                    content_urn=project_urn,
                )
            )
            task_id_rows = await self.session.execute(
                select(Task.id).where(Task.project_id == project_id)
            )
            task_ids = [task_id for (task_id,) in task_id_rows]
            for task_id in task_ids:
                staged_tags.append(
                    await tag_ops.stage_unassign_all_for_urn(
                        actor_id=user_id,
                        organization_id=organization_id,
                        content_urn=build_content_urn(ContentType.TASK, task_id),
                    )
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
        for staged in staged_tags:
            await tag_ops.finish_unassign_all_after_commit(staged)
        await publish_perm_change(ContentType.PROJECT, project_id, None, None)
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
        self._require_slug_shape(candidate)
        for suffix in ["", "2", "3", "4", "5", "6", "7", "8", "9"]:
            slug_to_try = candidate + suffix
            if not await self._slug_taken(organization_id, slug_to_try):
                return slug_to_try
        return candidate[:4] + secrets.token_hex(1).upper()

    def _require_slug_shape(self, candidate: str) -> None:
        if not _SLUG_PATTERN.match(candidate):
            raise ValidationError(
                "slug",
                f"Slug '{candidate}' must be 2-5 uppercase letters/digits starting with a letter",
            )

    async def _slug_taken(
        self,
        organization_id: UUID,
        slug: str,
        *,
        exclude_project_id: UUID | None = None,
    ) -> bool:
        query = select(Project.id).where(
            Project.organization_id == organization_id,
            Project.slug == slug,
            Project.is_deleted == False,  # noqa: E712
        )
        if exclude_project_id is not None:
            query = query.where(Project.id != exclude_project_id)
        return await self.session.scalar(query.limit(1)) is not None

    async def _resolve_renamed_slug(self, project: Project, requested_slug: str) -> str:
        """A rename keeps the caller's slug or fails; task keys read it, so no silent suffix."""
        candidate = requested_slug.strip().upper()
        if candidate == project.slug:
            return project.slug
        self._require_slug_shape(candidate)
        if await self._slug_taken(project.organization_id, candidate, exclude_project_id=project.id):
            raise ValidationError("slug", f"Slug '{candidate}' is already used by another project")
        return candidate
