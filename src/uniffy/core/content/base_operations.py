"""Base operations class for content types with built-in access control + search indexing.

Subclasses set ``content_type`` and ``model_class`` and implement
``_build_search_keywords`` / ``_get_search_title`` / ``_get_url_path``.
Child content (tasks, comments, attachments) overrides ``_resolve_role`` to
delegate to the parent's access policy.
"""

from abc import ABC, abstractmethod
from collections.abc import Callable
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute

from uniffy.core.auth.permissions import (
    ContentAccessQuery,
    PermissionChecker,
    resolve_access_policy,
    resolve_effective_policy,
    role_can_delete,
    role_can_edit,
    role_can_manage,
    role_can_transfer,
    role_can_view,
)
from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.search.indexer import SearchIndexer, build_content_urn
from uniffy.core.types import AccessMode, ContentRole, ContentType, SubjectType


class BaseContentOperations[TModel](ABC):
    """Base class for content CRUD operations."""

    content_type: ContentType
    model_class: type[TModel]

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.permission_checker = PermissionChecker(session)
        self.access_query = ContentAccessQuery(session)
        self.search_indexer = SearchIndexer(session)

    @abstractmethod
    def _build_search_keywords(self, model: TModel) -> str:
        raise NotImplementedError

    @abstractmethod
    def _get_search_title(self, model: TModel) -> str:
        raise NotImplementedError

    @abstractmethod
    def _get_url_path(self, model: TModel) -> str:
        raise NotImplementedError

    def _get_search_description(self, model: TModel) -> str | None:
        return None

    def _get_search_tags(self, model: TModel) -> list[str] | None:
        return None

    async def _get_search_tags_async(self, model: TModel) -> list[str] | None:
        """Async tags hook; override when sourcing from the tags store."""
        return self._get_search_tags(model)

    def _get_search_metadata(self, model: TModel) -> dict[str, str] | None:
        return None

    async def _get_search_metadata_async(self, model: TModel) -> dict[str, str] | None:
        """Async metadata hook; override when fetching related rows (parent folder, category)."""
        return self._get_search_metadata(model)

    async def get_by_id(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_id: UUID,
    ) -> TModel:
        """Fetch by id, enforcing view permission."""
        content = await self._fetch_by_id(content_id, organization_id)
        if not content:
            raise NotFoundError(self.content_type.value, content_id)
        await self._require_view(user_id, organization_id, content)
        return content

    async def list_accessible(
        self,
        user_id: UUID,
        organization_id: UUID,
        include_deleted: bool = False,
        **filters: Any,
    ) -> list[TModel]:
        """Content items the user can see, filtered by the access policy.

        Admins are NOT exempt here: this powers personal list/sidebar views, where
        an admin must see only their own accessible content, never other members'
        private items. Admin-wide browse belongs to a dedicated surface.
        """
        query = select(self.model_class).where(self._get_org_id_column() == organization_id)

        if not include_deleted:
            query = query.where(self._get_is_deleted_column() == False)  # noqa: E712

        # Apply domain filters before the access filter so they don't interact.
        query = self._apply_filters(query, **filters)

        access_filter = self.access_query.build_accessible_filter(
            user_id=user_id,
            organization_id=organization_id,
            content_type=self.content_type,
            content_id_column=self._get_id_column(),
            owner_id_column=self._get_owner_id_column(),
            access_mode_column=self._get_access_mode_column(),
            baseline_role_column=self._get_baseline_role_column(),
        )
        query = query.where(access_filter)

        result = await self.session.execute(query)
        return list(result.scalars().all())

    # ``create`` / ``update`` / ``delete`` are intentionally absent: each
    # domain's signature differs. Subclasses implement them directly and
    # reuse the ``_require_*`` / ``_index_for_search`` helpers.

    async def _effective_policy(
        self,
        organization_id: UUID,
        content: TModel,
    ) -> tuple[AccessMode, ContentRole | None]:
        """Materialise NULL access-policy columns against the org's defaults."""
        default_mode, default_baseline = await self.permission_checker.get_org_defaults(
            organization_id, self.content_type,
        )
        return resolve_effective_policy(
            content.access_mode,
            content.baseline_role,
            default_mode,
            default_baseline,
        )

    async def _resolve_access_policy(
        self,
        organization_id: UUID,
        access_mode: AccessMode | None,
        baseline_role: ContentRole | None,
    ) -> tuple[AccessMode, ContentRole | None]:
        """Validate ``(access_mode, baseline)`` for storage, bound to this class's session + type."""
        return await resolve_access_policy(
            self.session,
            organization_id,
            self.content_type,
            access_mode,
            baseline_role,
        )

    async def _resolve_role(
        self,
        user_id: UUID,
        organization_id: UUID,
        content: TModel,
    ) -> ContentRole | None:
        """Override on child types (tasks, comments, attachments) to delegate to a parent."""
        return await self.permission_checker.effective_role(
            user_id=user_id,
            organization_id=organization_id,
            content_type=self.content_type,
            content_id=content.id,
            owner_id=content.owner_id,
            access_mode=content.access_mode,
            baseline_role=content.baseline_role,
        )

    async def _require_role(
        self,
        user_id: UUID,
        organization_id: UUID,
        content: TModel,
        predicate: Callable[[ContentRole | None], bool],
        action: str,
    ) -> None:
        role = await self._resolve_role(user_id, organization_id, content)
        if not predicate(role):
            raise PermissionDeniedError(action, self.content_type.value)

    async def _require_view(
        self,
        user_id: UUID,
        organization_id: UUID,
        content: TModel,
    ) -> None:
        await self._require_role(user_id, organization_id, content, role_can_view, "access")

    async def _require_edit(
        self,
        user_id: UUID,
        organization_id: UUID,
        content: TModel,
    ) -> None:
        await self._require_role(user_id, organization_id, content, role_can_edit, "edit")

    async def _require_delete(
        self,
        user_id: UUID,
        organization_id: UUID,
        content: TModel,
    ) -> None:
        await self._require_role(user_id, organization_id, content, role_can_delete, "delete")

    async def _require_manage(
        self,
        user_id: UUID,
        organization_id: UUID,
        content: TModel,
    ) -> None:
        await self._require_role(user_id, organization_id, content, role_can_manage, "manage")

    async def _require_transfer(
        self,
        user_id: UUID,
        organization_id: UUID,
        content: TModel,
    ) -> None:
        await self._require_role(user_id, organization_id, content, role_can_transfer, "transfer")

    async def _index_for_search(
        self,
        model: TModel,
        skip_member_lookup: bool = False,
    ) -> None:
        """Index or re-index a content item in search.

        ``skip_member_lookup=True`` on create() avoids the member round-trip
        when no members exist yet.
        """
        shared_user_ids: list[UUID] = []
        shared_group_ids: list[UUID] = []
        blocked_user_ids: list[UUID] = []
        blocked_group_ids: list[UUID] = []

        if not skip_member_lookup:
            (
                shared_user_ids,
                shared_group_ids,
                blocked_user_ids,
                blocked_group_ids,
            ) = await self._get_member_id_lists(model.id)

        # Live policy resolution keeps Meili filters in sync; inheriting rows
        # would otherwise carry a stale create-time snapshot.
        effective_mode, effective_baseline = await self._effective_policy(
            model.organization_id, model,
        )

        await self.search_indexer.index(
            urn=build_content_urn(self.content_type, model.id),
            organization_id=model.organization_id,
            title=self._get_search_title(model),
            entity_type=self.content_type.value,
            url_path=self._get_url_path(model),
            owner_id=model.owner_id,
            access_mode=effective_mode.value,
            baseline_role=(effective_baseline.value if effective_baseline is not None else None),
            keywords=self._build_search_keywords(model),
            description=self._get_search_description(model),
            shared_user_ids=shared_user_ids if shared_user_ids else None,
            shared_group_ids=shared_group_ids if shared_group_ids else None,
            blocked_user_ids=blocked_user_ids if blocked_user_ids else None,
            blocked_group_ids=blocked_group_ids if blocked_group_ids else None,
            tags=await self._get_search_tags_async(model),
            metadata=await self._get_search_metadata_async(model),
        )

    async def _get_member_id_lists(
        self,
        content_id: UUID,
    ) -> tuple[list[UUID], list[UUID], list[UUID], list[UUID]]:
        """``(shared_users, shared_groups, blocked_users, blocked_groups)``."""
        from uniffy.core.models.permissions.content_member import ContentMember

        result = await self.session.execute(
            select(
                ContentMember.subject_type,
                ContentMember.subject_id,
                ContentMember.role,
            ).where(
                ContentMember.content_type == self.content_type,
                ContentMember.content_id == content_id,
            )
        )
        shared_users: list[UUID] = []
        shared_groups: list[UUID] = []
        blocked_users: list[UUID] = []
        blocked_groups: list[UUID] = []
        for subject_type, subject_id, role in result.all():
            if subject_type == SubjectType.USER:
                if role == ContentRole.BLOCKED:
                    blocked_users.append(subject_id)
                else:
                    shared_users.append(subject_id)
            elif subject_type == SubjectType.GROUP:
                if role == ContentRole.BLOCKED:
                    blocked_groups.append(subject_id)
                else:
                    shared_groups.append(subject_id)
        return shared_users, shared_groups, blocked_users, blocked_groups

    def _get_id_column(self) -> InstrumentedAttribute:
        return self.model_class.id

    def _get_org_id_column(self) -> InstrumentedAttribute:
        return self.model_class.organization_id

    def _get_owner_id_column(self) -> InstrumentedAttribute:
        return self.model_class.owner_id

    def _get_access_mode_column(self) -> InstrumentedAttribute:
        return self.model_class.access_mode

    def _get_baseline_role_column(self) -> InstrumentedAttribute:
        return self.model_class.baseline_role

    def _get_is_deleted_column(self) -> InstrumentedAttribute:
        return self.model_class.is_deleted

    def _apply_filters(self, query: Any, **filters: Any) -> Any:
        """Hook for domain-specific filters."""
        return query

    async def _fetch_by_id(
        self,
        content_id: UUID,
        organization_id: UUID,
    ) -> TModel | None:
        """Override for eager loading."""
        result = await self.session.execute(
            select(self.model_class)
            .where(self._get_id_column() == content_id)
            .where(self._get_org_id_column() == organization_id)
        )
        return result.scalar_one_or_none()
