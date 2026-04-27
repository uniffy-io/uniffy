"""
Base operations class for all content types.

Provides generic CRUD with built-in access control and search indexing.
Every domain extends this class and inherits:

- Permission checks through :meth:`PermissionChecker.effective_role` and
  the ``role_can_*`` helpers.
- List filtering via :class:`ContentAccessQuery.build_accessible_filter`
  (with org-admin / domain-admin bypass).
- Search indexing that mirrors the access model (shared + blocked member
  lists, access_mode, baseline_role).

Subclasses must define:

- ``content_type``: the :class:`ContentType` value for this content.
- ``model_class``: the SQLModel class.
- ``_build_search_keywords(model)`` / ``_get_search_title(model)`` /
  ``_get_url_path(model)`` for search indexing.

Optional overrides:

- ``_get_access_mode_column``, ``_get_baseline_role_column`` (default to
  ``model_class.access_mode`` / ``model_class.baseline_role``).
- ``_resolve_role(user_id, organization_id, content)`` for child content
  types that delegate to a parent (tasks, comments, attachments, etc.).

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
    """
    Base class for content CRUD operations.

    Parameters
    ----------
    session : AsyncSession
        Database session.

    """

    content_type: ContentType
    model_class: type[TModel]

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.permission_checker = PermissionChecker(session)
        self.access_query = ContentAccessQuery(session)
        self.search_indexer = SearchIndexer(session)

    # Abstract hooks -- must be implemented by subclasses

    @abstractmethod
    def _build_search_keywords(self, model: TModel) -> str:
        """Return aggregated text for search indexing."""
        raise NotImplementedError

    @abstractmethod
    def _get_search_title(self, model: TModel) -> str:
        """Return the title to show in search results."""
        raise NotImplementedError

    @abstractmethod
    def _get_url_path(self, model: TModel) -> str:
        """Return the frontend route path for the content."""
        raise NotImplementedError

    def _get_search_description(self, model: TModel) -> str | None:
        """Optional preview/description snippet for search indexing."""
        return None

    def _get_search_tags(self, model: TModel) -> list[str] | None:
        """Optional tags for search indexing."""
        return None

    def _get_search_metadata(self, model: TModel) -> dict[str, str] | None:
        """Optional extra metadata for search indexing."""
        return None

    # Core CRUD operations

    async def get_by_id(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_id: UUID,
    ) -> TModel:
        """Fetch a content item by id, enforcing view permission."""
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
        """Return content items the user can see.

        Org OWNER/ADMIN and domain admins bypass the access filter
        entirely and see all content in the organization. Everyone else
        goes through :meth:`ContentAccessQuery.build_accessible_filter`.
        """
        query = select(self.model_class).where(self._get_org_id_column() == organization_id)

        if not include_deleted:
            query = query.where(self._get_is_deleted_column() == False)  # noqa: E712

        # Apply domain-specific filters first so they do not interact
        # badly with access filtering.
        query = self._apply_filters(query, **filters)

        # Admin bypass: org admin or domain admin sees everything in org.
        if await self.permission_checker.is_org_admin(user_id, organization_id):
            result = await self.session.execute(query)
            return list(result.scalars().all())
        if await self.permission_checker.is_domain_admin(
            user_id, organization_id, self.content_type
        ):
            result = await self.session.execute(query)
            return list(result.scalars().all())

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

    # Note: ``create`` / ``update`` / ``delete`` are intentionally NOT
    # provided by this base class. Each domain needs its own signature
    # (notes take title + content + canvas; files take upload metadata;
    # projects take deadlines; etc.) and a one-size-fits-all override
    # would violate LSP. Subclasses implement these three methods
    # directly and use the ``_require_*`` / ``_index_for_search``
    # helpers below to stay consistent.

    # Access policy resolution

    async def _resolve_access_policy(
        self,
        organization_id: UUID,
        access_mode: AccessMode | None,
        baseline_role: ContentRole | None,
    ) -> tuple[AccessMode, ContentRole | None]:
        """Fill in defaults and validate an ``(access_mode, baseline)`` pair.

        Thin wrapper around :func:`resolve_access_policy` that binds the
        session and ``content_type`` of this operations class. Called by
        every domain's ``create()`` path.
        """
        return await resolve_access_policy(
            self.session,
            organization_id,
            self.content_type,
            access_mode,
            baseline_role,
        )

    # Role resolution

    async def _resolve_role(
        self,
        user_id: UUID,
        organization_id: UUID,
        content: TModel,
    ) -> ContentRole | None:
        """Resolve the user's effective role on the content.

        Child content types (tasks, comments, attachments, ...) override
        this method to delegate to their parent's access policy.
        """
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

    # Search indexing

    async def _index_for_search(
        self,
        model: TModel,
        skip_member_lookup: bool = False,
    ) -> None:
        """Index or re-index a content item in search.

        Parameters
        ----------
        model : TModel
            The content row to index.
        skip_member_lookup : bool
            If True, skip the database lookup for shared/blocked members.
            Set on create() when no members exist yet.

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

        await self.search_indexer.index(
            urn=build_content_urn(self.content_type, model.id),
            organization_id=model.organization_id,
            title=self._get_search_title(model),
            entity_type=self.content_type.value,
            url_path=self._get_url_path(model),
            owner_id=model.owner_id,
            access_mode=model.access_mode.value,
            baseline_role=(model.baseline_role.value if model.baseline_role is not None else None),
            keywords=self._build_search_keywords(model),
            description=self._get_search_description(model),
            shared_user_ids=shared_user_ids if shared_user_ids else None,
            shared_group_ids=shared_group_ids if shared_group_ids else None,
            blocked_user_ids=blocked_user_ids if blocked_user_ids else None,
            blocked_group_ids=blocked_group_ids if blocked_group_ids else None,
            tags=self._get_search_tags(model),
            metadata=self._get_search_metadata(model),
        )

    async def _get_member_id_lists(
        self,
        content_id: UUID,
    ) -> tuple[list[UUID], list[UUID], list[UUID], list[UUID]]:
        """Return (shared_users, shared_groups, blocked_users, blocked_groups)."""
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

    # Column accessors

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

    # Hooks for subclasses

    def _apply_filters(self, query: Any, **filters: Any) -> Any:
        """Apply domain-specific filters to the list query."""
        return query

    async def _fetch_by_id(
        self,
        content_id: UUID,
        organization_id: UUID,
    ) -> TModel | None:
        """Fetch a content row by id (override for eager loading)."""
        result = await self.session.execute(
            select(self.model_class)
            .where(self._get_id_column() == content_id)
            .where(self._get_org_id_column() == organization_id)
        )
        return result.scalar_one_or_none()
