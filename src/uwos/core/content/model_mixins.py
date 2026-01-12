"""
Model mixins for content types.

Provides reusable field definitions for SQLModel content models
to ensure consistency across all content types.
"""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import Column, DateTime, Enum
from sqlmodel import Field

from uwos.core.types import VisibilityScope


def content_id_field() -> UUID:
    """
    Create a UUID primary key field.

    Returns
    -------
    UUID
        Field definition for content ID.

    """
    return Field(default_factory=uuid4, primary_key=True, nullable=False)


def organization_id_field(foreign_key: str = "login_organizations.id") -> UUID:
    """
    Create an organization_id foreign key field.

    Parameters
    ----------
    foreign_key : str
        The foreign key reference.

    Returns
    -------
    UUID
        Field definition for organization ID.

    """
    return Field(foreign_key=foreign_key, nullable=False, index=True)


def owner_id_field(foreign_key: str = "login_users.id") -> UUID:
    """
    Create an owner_id foreign key field.

    Parameters
    ----------
    foreign_key : str
        The foreign key reference.

    Returns
    -------
    UUID
        Field definition for owner ID.

    """
    return Field(foreign_key=foreign_key, nullable=False, index=True)


def visibility_field(default: VisibilityScope = VisibilityScope.PRIVATE) -> VisibilityScope:
    """
    Create a visibility field with proper enum column.

    Parameters
    ----------
    default : VisibilityScope
        Default visibility scope.

    Returns
    -------
    VisibilityScope
        Field definition for visibility.

    """
    return Field(
        default=default,
        sa_column=Column(
            Enum(
                VisibilityScope,
                name="visibilityscope",
                values_callable=lambda x: [e.value for e in x],
            ),
            nullable=False,
            index=True,
        ),
    )


def is_deleted_field(default: bool = False) -> bool:
    """
    Create an is_deleted soft-delete flag field.

    Parameters
    ----------
    default : bool
        Default value.

    Returns
    -------
    bool
        Field definition for is_deleted.

    """
    return Field(default=default, nullable=False)


def created_at_field() -> datetime:
    """
    Create a created_at timestamp field.

    Returns
    -------
    datetime
        Field definition for created_at.

    """
    return Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


def updated_at_field() -> datetime:
    """
    Create an updated_at timestamp field with auto-update.

    Returns
    -------
    datetime
        Field definition for updated_at.

    """
    return Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)),
    )


def deleted_at_field() -> datetime | None:
    """
    Create a deleted_at timestamp field for soft-delete.

    Returns
    -------
    datetime | None
        Field definition for deleted_at.

    """
    return Field(default=None, sa_column=Column(DateTime(timezone=True)))
