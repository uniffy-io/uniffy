"""
Base operations class for all content types.

Provides generic CRUD operations with built-in permission checking
and search indexing. All domain operations classes should extend this.
"""

from abc import ABC, abstractmethod
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute

from uniffy.core.auth.permissions import ContentAccessQuery, PermissionChecker
from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.search.indexer import SearchIndexer, build_content_urn
from uniffy.core.types import ContentType, VisibilityScope


class BaseContentOperations[TModel](ABC):
    """
    Base class for content CRUD operations.

    Provides:
    - Permission checking on all operations
    - Automatic search indexing on create/update
    - Consistent error handling

    Subclasses must define:
    - content_type: ContentType enum value
    - model_class: SQLModel class
    - _build_search_keywords(): Generate search text
    - _get_search_title(): Get title for search
    - _get_url_path(): Get URL path for search results

    Parameters
    ----------
    session : AsyncSession
        Database session.

    """

    content_type: ContentType
    model_class: type[TModel]

    def __init__(self, session: AsyncSession) -> None:
        """
        Initialize the base content operations.

        Parameters
        ----------
        session : AsyncSession
            Database session.

        """
        self.session = session
        self.permission_checker = PermissionChecker(session)
        self.access_query = ContentAccessQuery(session)
        self.search_indexer = SearchIndexer(session)

    # ─────────────────────────────────────────────────────────────
    # Abstract methods - subclasses must implement
    # ─────────────────────────────────────────────────────────────

    @abstractmethod
    def _build_search_keywords(self, model: TModel) -> str:
        """
        Build search keywords string for indexing.

        Parameters
        ----------
        model : TModel
            The content model.

        Returns
        -------
        str
            Keywords string for search indexing.

        """
        raise NotImplementedError

    @abstractmethod
    def _get_search_title(self, model: TModel) -> str:
        """
        Get title for search index.

        Parameters
        ----------
        model : TModel
            The content model.

        Returns
        -------
        str
            Title for search results.

        """
        raise NotImplementedError

    @abstractmethod
    def _get_url_path(self, model: TModel) -> str:
        """
        Get URL path for search results.

        Parameters
        ----------
        model : TModel
            The content model.

        Returns
        -------
        str
            Frontend route to navigate to.

        """
        raise NotImplementedError

    def _get_search_description(self, model: TModel) -> str | None:
        """
        Get description for search index.

        Override in subclass to provide a description/snippet.

        Parameters
        ----------
        model : TModel
            The content model.

        Returns
        -------
        str | None
            Description for search results, or None.

        """
        return None

    def _get_search_tags(self, model: TModel) -> list[str] | None:
        """
        Get tags for search index.

        Override in subclass to provide tags.

        Parameters
        ----------
        model : TModel
            The content model.

        Returns
        -------
        list[str] | None
            Tags for the content, or None.

        """
        return None

    # ─────────────────────────────────────────────────────────────
    # Core CRUD operations
    # ─────────────────────────────────────────────────────────────

    async def get_by_id(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_id: UUID,
    ) -> TModel:
        """
        Get content by ID with permission check.

        Parameters
        ----------
        user_id : UUID
            User requesting access.
        organization_id : UUID
            Organization ID.
        content_id : UUID
            ID of the content.

        Returns
        -------
        TModel
            The content model.

        Raises
        ------
        NotFoundError
            If content does not exist.
        PermissionDeniedError
            If user cannot access the content.

        """
        content = await self._fetch_by_id(content_id, organization_id)
        if not content:
            raise NotFoundError(self.content_type.value, content_id)

        await self._require_access(user_id, organization_id, content)
        return content

    async def list_accessible(
        self,
        user_id: UUID,
        organization_id: UUID,
        include_deleted: bool = False,
        **filters: Any,
    ) -> list[TModel]:
        """
        List all content accessible to user.

        Parameters
        ----------
        user_id : UUID
            User requesting access.
        organization_id : UUID
            Organization ID.
        include_deleted : bool
            Whether to include soft-deleted content.
        **filters : Any
            Additional filters passed to _apply_filters.

        Returns
        -------
        list[TModel]
            List of accessible content.

        """
        access_filter = self.access_query.build_accessible_filter(
            user_id=user_id,
            organization_id=organization_id,
            content_type=self.content_type,
            content_id_column=self._get_id_column(),
            owner_id_column=self._get_owner_id_column(),
            visibility_column=self._get_visibility_column(),
        )

        query = (
            select(self.model_class)
            .where(self._get_org_id_column() == organization_id)
            .where(access_filter)
        )

        if not include_deleted:
            query = query.where(self._get_is_deleted_column() == False)  # noqa: E712

        # Apply additional filters from subclass
        query = self._apply_filters(query, **filters)

        result = await self.session.execute(query)
        return list(result.scalars().all())

    async def create(
        self,
        user_id: UUID,
        organization_id: UUID,
        model: TModel,
        group_ids: list[UUID] | None = None,
    ) -> TModel:
        """
        Create content with search indexing.

        Parameters
        ----------
        user_id : UUID
            User creating the content.
        organization_id : UUID
            Organization ID.
        model : TModel
            The content model to create.
        group_ids : list[UUID] | None
            Group IDs if visibility is GROUP.

        Returns
        -------
        TModel
            The created content.

        """
        # Set ownership
        model.organization_id = organization_id
        model.owner_id = user_id

        self.session.add(model)
        await self.session.commit()
        await self.session.refresh(model)

        # Handle group links if visibility is GROUP
        if model.visibility == VisibilityScope.GROUP and group_ids:
            await self._create_group_links(model.id, group_ids, user_id, organization_id)
            await self.session.commit()

        # Index for search
        await self._index_for_search(model, group_ids or [])
        await self.session.commit()

        return model

    async def update(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_id: UUID,
        **updates: Any,
    ) -> TModel:
        """
        Update content with permission check and re-indexing.

        Parameters
        ----------
        user_id : UUID
            User requesting update.
        organization_id : UUID
            Organization ID.
        content_id : UUID
            ID of the content.
        **updates : Any
            Fields to update.

        Returns
        -------
        TModel
            The updated content.

        Raises
        ------
        NotFoundError
            If content does not exist.
        PermissionDeniedError
            If user cannot edit the content.

        """
        content = await self.get_by_id(user_id, organization_id, content_id)
        await self._require_edit(user_id, organization_id, content)

        # Apply updates
        for key, value in updates.items():
            if value is not None and hasattr(content, key):
                setattr(content, key, value)

        content.updated_at = datetime.now(UTC)

        await self.session.commit()
        await self.session.refresh(content)

        # Re-index
        group_ids = await self._get_content_group_ids(content_id)
        await self._index_for_search(content, group_ids)
        await self.session.commit()

        return content

    async def delete(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_id: UUID,
        permanent: bool = False,
    ) -> None:
        """
        Delete content (soft or permanent).

        Parameters
        ----------
        user_id : UUID
            User requesting deletion.
        organization_id : UUID
            Organization ID.
        content_id : UUID
            ID of the content.
        permanent : bool
            If True, permanently delete. If False, soft delete.

        Raises
        ------
        NotFoundError
            If content does not exist.
        PermissionDeniedError
            If user cannot delete the content.

        """
        content = await self.get_by_id(user_id, organization_id, content_id)
        await self._require_delete(user_id, organization_id, content)

        if permanent:
            await self.session.delete(content)
        else:
            content.is_deleted = True
            content.deleted_at = datetime.now(UTC)

        await self.session.commit()

        # Remove from search index
        await self.search_indexer.remove(build_content_urn(self.content_type, content_id))
        await self.session.commit()

    # ─────────────────────────────────────────────────────────────
    # Permission helpers
    # ─────────────────────────────────────────────────────────────

    async def _require_access(
        self,
        user_id: UUID,
        organization_id: UUID,
        content: TModel,
    ) -> None:
        """Raise PermissionDeniedError if user cannot access."""
        can_access = await self.permission_checker.can_access_content(
            user_id=user_id,
            organization_id=organization_id,
            content_type=self.content_type,
            content_id=content.id,
            content_owner_id=content.owner_id,
            content_visibility=content.visibility,
        )
        if not can_access:
            raise PermissionDeniedError("access", self.content_type.value)

    async def _require_edit(
        self,
        user_id: UUID,
        organization_id: UUID,
        content: TModel,
    ) -> None:
        """Raise PermissionDeniedError if user cannot edit."""
        can_edit = await self.permission_checker.can_edit_content(
            user_id=user_id,
            organization_id=organization_id,
            content_type=self.content_type,
            content_id=content.id,
            content_owner_id=content.owner_id,
            content_visibility=content.visibility,
        )
        if not can_edit:
            raise PermissionDeniedError("edit", self.content_type.value)

    async def _require_delete(
        self,
        user_id: UUID,
        organization_id: UUID,
        content: TModel,
    ) -> None:
        """Raise PermissionDeniedError if user cannot delete."""
        can_delete = await self.permission_checker.can_delete_content(
            user_id=user_id,
            organization_id=organization_id,
            content_type=self.content_type,
            content_id=content.id,
            content_owner_id=content.owner_id,
        )
        if not can_delete:
            raise PermissionDeniedError("delete", self.content_type.value)

    # ─────────────────────────────────────────────────────────────
    # Search indexing
    # ─────────────────────────────────────────────────────────────

    async def _index_for_search(
        self,
        model: TModel,
        group_ids: list[UUID],
    ) -> None:
        """Index content for unified search."""
        await self.search_indexer.index(
            urn=build_content_urn(self.content_type, model.id),
            organization_id=model.organization_id,
            title=self._get_search_title(model),
            entity_type=self.content_type.value,
            url_path=self._get_url_path(model),
            visibility=model.visibility.value,
            owner_id=model.owner_id,
            keywords=self._build_search_keywords(model),
            description=self._get_search_description(model),
            shared_group_ids=group_ids if group_ids else None,
            tags=self._get_search_tags(model),
        )

    # ─────────────────────────────────────────────────────────────
    # Group link management
    # ─────────────────────────────────────────────────────────────

    async def _create_group_links(
        self,
        content_id: UUID,
        group_ids: list[UUID],
        user_id: UUID,
        organization_id: UUID,
    ) -> None:
        """Create group links for content."""
        from uniffy.core.models.permissions.content_group_link import ContentGroupLink

        for group_id in group_ids:
            link = ContentGroupLink(
                organization_id=organization_id,
                content_type=self.content_type,
                content_id=content_id,
                group_id=group_id,
                linked_by_user_id=user_id,
            )
            self.session.add(link)

    async def _get_content_group_ids(self, content_id: UUID) -> list[UUID]:
        """Get group IDs for content."""
        from uniffy.core.models.permissions.content_group_link import ContentGroupLink

        result = await self.session.execute(
            select(ContentGroupLink.group_id)
            .where(ContentGroupLink.content_id == content_id)
            .where(ContentGroupLink.content_type == self.content_type)
        )
        return [row[0] for row in result.all()]

    async def _remove_group_links(self, content_id: UUID) -> None:
        """Remove all group links for a content item."""
        from sqlalchemy import delete

        from uniffy.core.models.permissions.content_group_link import ContentGroupLink

        await self.session.execute(
            delete(ContentGroupLink).where(
                ContentGroupLink.content_id == content_id,
                ContentGroupLink.content_type == self.content_type,
            )
        )

    # ─────────────────────────────────────────────────────────────
    # Column accessors (for query building)
    # ─────────────────────────────────────────────────────────────

    def _get_id_column(self) -> InstrumentedAttribute:
        """Get the ID column for the model."""
        return self.model_class.id

    def _get_org_id_column(self) -> InstrumentedAttribute:
        """Get the organization_id column for the model."""
        return self.model_class.organization_id

    def _get_owner_id_column(self) -> InstrumentedAttribute:
        """Get the owner_id column for the model."""
        return self.model_class.owner_id

    def _get_visibility_column(self) -> InstrumentedAttribute:
        """Get the visibility column for the model."""
        return self.model_class.visibility

    def _get_is_deleted_column(self) -> InstrumentedAttribute:
        """Get the is_deleted column for the model."""
        return self.model_class.is_deleted

    # ─────────────────────────────────────────────────────────────
    # Hooks for subclasses
    # ─────────────────────────────────────────────────────────────

    def _apply_filters(self, query: Any, **filters: Any) -> Any:
        """
        Apply domain-specific filters to query.

        Override in subclass to add custom filtering logic.

        Parameters
        ----------
        query : Any
            SQLAlchemy select query.
        **filters : Any
            Filter parameters.

        Returns
        -------
        Any
            Modified query.

        """
        return query

    async def _fetch_by_id(
        self,
        content_id: UUID,
        organization_id: UUID,
    ) -> TModel | None:
        """
        Fetch content by ID.

        Override for custom queries (e.g., eager loading).

        Parameters
        ----------
        content_id : UUID
            ID of the content.
        organization_id : UUID
            Organization ID.

        Returns
        -------
        TModel | None
            The content or None if not found.

        """
        result = await self.session.execute(
            select(self.model_class)
            .where(self._get_id_column() == content_id)
            .where(self._get_org_id_column() == organization_id)
        )
        return result.scalar_one_or_none()
