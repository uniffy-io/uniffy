"""Reusable SQLModel field definitions shared by content models."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, Enum
from sqlmodel import Field

from uniffy.core.types import AccessMode, ContentRole, generate_id


def content_id_field() -> UUID:
    return Field(default_factory=generate_id, primary_key=True, nullable=False)


def organization_id_field(foreign_key: str = "login_organizations.id") -> UUID:
    return Field(foreign_key=foreign_key, nullable=False, index=True)


def owner_id_field(foreign_key: str = "login_users.id") -> UUID:
    return Field(foreign_key=foreign_key, nullable=False, index=True)


def access_mode_field(default: AccessMode = AccessMode.OWNER_ONLY) -> AccessMode:
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
    """Non-null only with ``OPEN_TO_ORG``; never ``OWNER`` / ``BLOCKED`` (app-enforced)."""
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
    return Field(default=default, nullable=False)


def created_at_field() -> datetime:
    return Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


def updated_at_field() -> datetime:
    return Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)),
    )


def deleted_at_field() -> datetime | None:
    return Field(default=None, sa_column=Column(DateTime(timezone=True)))
