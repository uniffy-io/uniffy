"""Base service class for content services with permission support."""

from typing import Generic, TypeVar
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uwos.models.shared import ContentType, PermissionLevel
from uwos.services.permissions.checker import PermissionChecker
from uwos.services.permissions.queries import ContentAccessQuery

T = TypeVar("T")


class BaseContentService(Generic[T]):
    """
    Base service class for content types with permission support.

    Provides common permission checking and query building methods
    that all content services (notes, files, calendar, etc.) can use.

    Type Parameters
    ----------------
    T : type
        The content model type (e.g., Note, File, CalendarEvent).

    """

    def __init__(
        self,
        session: AsyncSession,
        content_type: ContentType,
        content_id_attr: str = "id",
        owner_id_attr: str = "owner_id",
        visibility_attr: str = "visibility",
    ):
        """
        Initialize the base content service.

        Parameters
        ----------
        session : AsyncSession
            Database session.
        content_type : ContentType
            The type of content this service manages.
        content_id_attr : str
            Name of the ID attribute on the model (default: "id").
        owner_id_attr : str
            Name of the owner ID attribute (default: "owner_id").
        visibility_attr : str
            Name of the visibility attribute (default: "visibility").

        """
        self.session = session
        self.content_type = content_type
        self.content_id_attr = content_id_attr
        self.owner_id_attr = owner_id_attr
        self.visibility_attr = visibility_attr

        self.permission_checker = PermissionChecker(session)
        self.access_query = ContentAccessQuery(session)

    async def can_access(
        self,
        user_id: UUID,
        organization_id: UUID,
        content: T,
    ) -> bool:
        """
        Check if a user can access a piece of content.

        Parameters
        ----------
        user_id : UUID
            User attempting to access.
        organization_id : UUID
            Organization ID.
        content : T
            The content object.

        Returns
        -------
        bool
            True if user can access.

        """
        return await self.permission_checker.can_access_content(
            user_id=user_id,
            organization_id=organization_id,
            content_type=self.content_type,
            content_id=getattr(content, self.content_id_attr),
            content_owner_id=getattr(content, self.owner_id_attr),
            content_visibility=getattr(content, self.visibility_attr),
        )

    async def can_edit(
        self,
        user_id: UUID,
        organization_id: UUID,
        content: T,
    ) -> bool:
        """
        Check if a user can edit a piece of content.

        Parameters
        ----------
        user_id : UUID
            User attempting to edit.
        organization_id : UUID
            Organization ID.
        content : T
            The content object.

        Returns
        -------
        bool
            True if user can edit.

        """
        return await self.permission_checker.can_edit_content(
            user_id=user_id,
            organization_id=organization_id,
            content_type=self.content_type,
            content_id=getattr(content, self.content_id_attr),
            content_owner_id=getattr(content, self.owner_id_attr),
            content_visibility=getattr(content, self.visibility_attr),
        )

    async def can_delete(
        self,
        user_id: UUID,
        organization_id: UUID,
        content: T,
    ) -> bool:
        """
        Check if a user can delete a piece of content.

        Parameters
        ----------
        user_id : UUID
            User attempting to delete.
        organization_id : UUID
            Organization ID.
        content : T
            The content object.

        Returns
        -------
        bool
            True if user can delete.

        """
        return await self.permission_checker.can_delete_content(
            user_id=user_id,
            organization_id=organization_id,
            content_type=self.content_type,
            content_id=getattr(content, self.content_id_attr),
            content_owner_id=getattr(content, self.owner_id_attr),
        )

    async def can_share(
        self,
        user_id: UUID,
        organization_id: UUID,
        content: T,
    ) -> bool:
        """
        Check if a user can share a piece of content.

        Parameters
        ----------
        user_id : UUID
            User attempting to share.
        organization_id : UUID
            Organization ID.
        content : T
            The content object.

        Returns
        -------
        bool
            True if user can share.

        """
        return await self.permission_checker.can_share_content(
            user_id=user_id,
            organization_id=organization_id,
            content_type=self.content_type,
            content_id=getattr(content, self.content_id_attr),
            content_owner_id=getattr(content, self.owner_id_attr),
        )

    async def can_move(
        self,
        user_id: UUID,
        organization_id: UUID,
        content: T,
    ) -> bool:
        """
        Check if a user can move a piece of content.

        Parameters
        ----------
        user_id : UUID
            User attempting to move.
        organization_id : UUID
            Organization ID.
        content : T
            The content object.

        Returns
        -------
        bool
            True if user can move.

        """
        return await self.permission_checker.can_move_content(
            user_id=user_id,
            organization_id=organization_id,
            content_type=self.content_type,
            content_id=getattr(content, self.content_id_attr),
            content_owner_id=getattr(content, self.owner_id_attr),
        )

    async def get_permission_level(
        self,
        user_id: UUID,
        organization_id: UUID,
        content: T,
    ) -> PermissionLevel:
        """
        Get the user's permission level for a piece of content.

        Parameters
        ----------
        user_id : UUID
            User ID.
        organization_id : UUID
            Organization ID.
        content : T
            The content object.

        Returns
        -------
        PermissionLevel
            The user's permission level.

        """
        return await self.permission_checker.get_user_permission_level(
            user_id=user_id,
            organization_id=organization_id,
            content_type=self.content_type,
            content_id=getattr(content, self.content_id_attr),
            content_owner_id=getattr(content, self.owner_id_attr),
        )

    def get_accessible_filter(
        self,
        user_id: UUID,
        organization_id: UUID,
        model_class: type[T],
    ) -> any:
        """
        Get a SQLAlchemy filter for accessible content.

        Parameters
        ----------
        user_id : UUID
            User ID.
        organization_id : UUID
            Organization ID.
        model_class : type[T]
            The model class (e.g., Note).

        Returns
        -------
        any
            SQLAlchemy filter expression.

        Examples
        --------
        >>> service = BaseContentService(session, ContentType.NOTE)
        >>> filter_expr = service.get_accessible_filter(
        ...     user_id=user_id,
        ...     organization_id=org_id,
        ...     model_class=Note
        ... )
        >>> notes = await session.execute(
        ...     select(Note).where(filter_expr)
        ... )

        """
        return self.access_query.build_accessible_filter(
            user_id=user_id,
            organization_id=organization_id,
            content_type=self.content_type,
            content_id_column=getattr(model_class, self.content_id_attr),
            owner_id_column=getattr(model_class, self.owner_id_attr),
            visibility_column=getattr(model_class, self.visibility_attr),
        )

    def get_personal_filter(
        self,
        user_id: UUID,
        model_class: type[T],
    ) -> any:
        """
        Get a filter for user's personal content.

        Parameters
        ----------
        user_id : UUID
            User ID.
        model_class : type[T]
            The model class.

        Returns
        -------
        any
            SQLAlchemy filter expression.

        """
        return self.access_query.build_personal_filter(
            user_id=user_id,
            owner_id_column=getattr(model_class, self.owner_id_attr),
            visibility_column=getattr(model_class, self.visibility_attr),
        )

    def get_group_filter(
        self,
        group_id: UUID,
        organization_id: UUID,
        model_class: type[T],
    ) -> any:
        """
        Get a filter for content in a specific group.

        Parameters
        ----------
        group_id : UUID
            Group ID.
        organization_id : UUID
            Organization ID.
        model_class : type[T]
            The model class.

        Returns
        -------
        any
            SQLAlchemy filter expression.

        """
        return self.access_query.build_group_filter(
            group_id=group_id,
            organization_id=organization_id,
            content_type=self.content_type,
            content_id_column=getattr(model_class, self.content_id_attr),
            visibility_column=getattr(model_class, self.visibility_attr),
        )

    def get_organization_filter(
        self,
        model_class: type[T],
    ) -> any:
        """
        Get a filter for organization-wide content.

        Parameters
        ----------
        model_class : type[T]
            The model class.

        Returns
        -------
        any
            SQLAlchemy filter expression.

        """
        return self.access_query.build_organization_filter(
            visibility_column=getattr(model_class, self.visibility_attr),
        )

    async def get_content_groups(
        self,
        content_id: UUID,
        organization_id: UUID,
    ) -> list[UUID]:
        """
        Get all groups that have access to content.

        Parameters
        ----------
        content_id : UUID
            Content ID.
        organization_id : UUID
            Organization ID.

        Returns
        -------
        list[UUID]
            List of group IDs.

        """
        return await self.permission_checker.get_content_groups(
            content_type=self.content_type,
            content_id=content_id,
            organization_id=organization_id,
        )

    async def require_access(
        self,
        user_id: UUID,
        organization_id: UUID,
        content: T,
        error_message: str = "Access denied",
    ) -> None:
        """
        Require that a user has access to content, raise error if not.

        Parameters
        ----------
        user_id : UUID
            User ID.
        organization_id : UUID
            Organization ID.
        content : T
            The content object.
        error_message : str
            Error message to raise.

        Raises
        ------
        PermissionError
            If user doesn't have access.

        """
        if not await self.can_access(user_id, organization_id, content):
            raise PermissionError(error_message)

    async def require_edit(
        self,
        user_id: UUID,
        organization_id: UUID,
        content: T,
        error_message: str = "Edit permission denied",
    ) -> None:
        """
        Require that a user can edit content, raise error if not.

        Parameters
        ----------
        user_id : UUID
            User ID.
        organization_id : UUID
            Organization ID.
        content : T
            The content object.
        error_message : str
            Error message to raise.

        Raises
        ------
        PermissionError
            If user doesn't have edit permission.

        """
        if not await self.can_edit(user_id, organization_id, content):
            raise PermissionError(error_message)

    async def require_delete(
        self,
        user_id: UUID,
        organization_id: UUID,
        content: T,
        error_message: str = "Delete permission denied",
    ) -> None:
        """
        Require that a user can delete content, raise error if not.

        Parameters
        ----------
        user_id : UUID
            User ID.
        organization_id : UUID
            Organization ID.
        content : T
            The content object.
        error_message : str
            Error message to raise.

        Raises
        ------
        PermissionError
            If user doesn't have delete permission.

        """
        if not await self.can_delete(user_id, organization_id, content):
            raise PermissionError(error_message)
