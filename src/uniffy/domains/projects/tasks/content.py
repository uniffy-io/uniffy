"""Task content access and search policy."""

from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.auth.permissions.defaults import (
    resolve_content_defaults,
    resolve_effective_policy,
)
from uniffy.core.content.base_operations import BaseContentOperations
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.task import Task
from uniffy.core.search.indexer import SearchIndexer, build_content_urn
from uniffy.core.storage import ObjectStorage
from uniffy.core.types import (
    ContentRole,
    ContentType,
)
from uniffy.domains.projects.registration import register_project_content
from uniffy.domains.tags.operations import TagOperations

logger = logger.bind(component="projects.tasks.content")


class TaskContentOperations(BaseContentOperations[Task]):
    """Task CRUD operations with permissions delegated to the parent project."""

    content_type = ContentType.TASK
    model_class = Task

    def __init__(
        self,
        session: AsyncSession,
        storage: ObjectStorage | None = None,
        search_indexer: SearchIndexer | None = None,
        *,
        permission_checker: PermissionChecker | None = None,
    ) -> None:
        register_project_content()
        super().__init__(session, search_indexer, permission_checker=permission_checker)
        self._storage = storage

    @property
    def storage(self) -> ObjectStorage:
        if self._storage is None:
            raise RuntimeError("Object storage is required for task attachment mutations")
        return self._storage

    def _build_search_keywords(self, model: Task) -> str:
        parts = [model.title]
        if model.description:
            parts.append(model.description)
        return " ".join(parts)

    def _get_search_title(self, model: Task) -> str:
        return model.title

    def _get_url_path(self, model: Task) -> str:
        return f"/projects/{model.project_id}/tasks/{model.id}"

    def _get_search_description(self, model: Task) -> str | None:
        if model.description:
            return model.description[:200]
        return None

    def _get_search_metadata(self, model: Task) -> dict[str, str] | None:
        """``project_id`` is filterable so project delete can cascade-remove tasks in one call."""
        return {"project_id": str(model.project_id)}

    async def _get_search_tags_async(self, model: Task) -> list[str] | None:
        tag_ops = TagOperations(self.session, self.search_indexer)
        urn = build_content_urn(self.content_type, model.id)
        bulk = await tag_ops.get_for_urns(
            organization_id=model.organization_id,
            content_urns=[urn],
        )
        slugs = sorted({tag.slug for tag in bulk.get(urn, [])})
        return slugs or None

    async def _sync_task_tags(
        self,
        *,
        actor_id: UUID,
        task: Task,
        tag_ids: list[UUID] | None,
    ) -> None:
        """``tag_ids=None`` leaves manual assignments untouched."""
        if tag_ids is None:
            return
        tag_ops = TagOperations(self.session, self.search_indexer)
        await tag_ops.replace_manual_tags(
            actor_id=actor_id,
            organization_id=task.organization_id,
            content_urn=build_content_urn(self.content_type, task.id),
            tag_ids=tag_ids,
        )

    async def _resolve_role(
        self,
        user_id: UUID,
        organization_id: UUID,
        content: Task,
    ) -> ContentRole | None:
        """Tasks inherit role from the parent project."""
        project = await self.session.get(Project, content.project_id)
        if project is None:
            return None
        return await self.permission_checker.effective_role(
            user_id=user_id,
            organization_id=organization_id,
            content_type=ContentType.PROJECT,
            content_id=project.id,
            owner_id=project.owner_id,
            access_mode=project.access_mode,
            baseline_role=project.baseline_role,
        )

    async def _index_for_search(
        self,
        model: Task,
        skip_member_lookup: bool = False,
    ) -> None:
        """Indexes the task under its parent project's access policy."""
        project = await self.session.get(Project, model.project_id)
        if project is None:
            return

        shared_user_ids: list[UUID] = []
        shared_group_ids: list[UUID] = []
        blocked_user_ids: list[UUID] = []
        blocked_group_ids: list[UUID] = []

        if not skip_member_lookup:
            # Index sharing metadata against the project's members.
            from uniffy.core.models.permissions.content_member import ContentMember
            from uniffy.core.types import SubjectType as SubjectTypeLocal

            result = await self.session.execute(
                select(
                    ContentMember.subject_type,
                    ContentMember.subject_id,
                    ContentMember.role,
                ).where(
                    ContentMember.content_type == ContentType.PROJECT,
                    ContentMember.content_id == project.id,
                )
            )
            for subject_type, subject_id, role in result.all():
                if subject_type == SubjectTypeLocal.USER:
                    if role == ContentRole.BLOCKED:
                        blocked_user_ids.append(subject_id)
                    else:
                        shared_user_ids.append(subject_id)
                elif subject_type == SubjectTypeLocal.GROUP:
                    if role == ContentRole.BLOCKED:
                        blocked_group_ids.append(subject_id)
                    else:
                        shared_group_ids.append(subject_id)

        default_mode, default_baseline = await resolve_content_defaults(
            self.session,
            model.organization_id,
            ContentType.PROJECT,
        )
        effective_mode, effective_baseline = resolve_effective_policy(
            project.access_mode,
            project.baseline_role,
            default_mode,
            default_baseline,
        )

        await self.search_indexer.index(
            urn=build_content_urn(self.content_type, model.id),
            organization_id=model.organization_id,
            title=self._get_search_title(model),
            entity_type=self.content_type.value,
            url_path=self._get_url_path(model),
            owner_id=project.owner_id,
            access_mode=effective_mode.value,
            baseline_role=(effective_baseline.value if effective_baseline is not None else None),
            keywords=self._build_search_keywords(model),
            description=self._get_search_description(model),
            shared_user_ids=shared_user_ids if shared_user_ids else None,
            shared_group_ids=shared_group_ids if shared_group_ids else None,
            blocked_user_ids=blocked_user_ids if blocked_user_ids else None,
            blocked_group_ids=blocked_group_ids if blocked_group_ids else None,
            tags=await self._get_search_tags_async(model),
            metadata=self._get_search_metadata(model),
        )
