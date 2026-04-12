"""
Model mixins for content types.

Reusable field definitions for SQLModel content models. Using these
keeps field defaults and column types consistent across every content
type that participates in the access control model.
"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, Enum
from sqlmodel import Field

from uniffy.core.types import AccessMode, ContentRole, generate_id


def content_id_field() -> UUID:
    """Create a UUID primary key field."""
    return Field(default_factory=generate_id, primary_key=True, nullable=False)


def organization_id_field(foreign_key: str = "login_organizations.id") -> UUID:
    """Create an organization_id foreign key field."""
    return Field(foreign_key=foreign_key, nullable=False, index=True)


def owner_id_field(foreign_key: str = "login_users.id") -> UUID:
    """Create an owner_id foreign key field."""
    return Field(foreign_key=foreign_key, nullable=False, index=True)


def access_mode_field(default: AccessMode = AccessMode.OWNER_ONLY) -> AccessMode:
    """
    Create an access_mode field with the accessmode Postgres enum.

    Parameters
    ----------
    default : AccessMode
        Default access mode for new rows.

    """
    return Field(
        default=default,
        sa_column=Column(
            Enum(
                AccessMode,
                name="accessmode",
                values_callable=lambda x: [e.value for e in x],
                create_type=False,
            ),
            nullable=False,
            index=True,
        ),
    )


def baseline_role_field(default: ContentRole | None = None) -> ContentRole | None:
    """
    Create a baseline_role field with the contentrole Postgres enum.

    Non-null only when ``access_mode = OPEN_TO_ORG``. Must not be
    ``OWNER`` or ``BLOCKED`` (application-enforced).
    """
    return Field(
        default=default,
        sa_column=Column(
            Enum(
                ContentRole,
                name="contentrole",
                values_callable=lambda x: [e.value for e in x],
                create_type=False,
            ),
            nullable=True,
        ),
    )


def is_deleted_field(default: bool = False) -> bool:
    """Create an is_deleted soft-delete flag field."""
    return Field(default=default, nullable=False)


def created_at_field() -> datetime:
    """Create a created_at timestamp field."""
    return Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


def updated_at_field() -> datetime:
    """Create an updated_at timestamp field with auto-update."""
    return Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)),
    )


def deleted_at_field() -> datetime | None:
    """Create a deleted_at timestamp field for soft-delete."""
    return Field(default=None, sa_column=Column(DateTime(timezone=True)))
