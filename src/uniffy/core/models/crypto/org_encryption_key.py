"""Per-organization Data Encryption Key (DEK) row.

One row per (organization, DEK version). Exactly one row per
organization is marked active; older versions are kept so ciphertexts
that still carry their prefix can be decrypted.

The ``wrapped_dek`` column stores the DEK already encrypted with the
master cipher -- raw DEKs never touch the database.
"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Boolean, Column, DateTime, Index, Integer, Text, UniqueConstraint
from sqlalchemy.sql import text
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class OrgEncryptionKey(SQLModel, table=True):
    """Per-organization Data Encryption Key wrapped by the master KEK.

    Ciphertexts carry a ``v{version}:`` prefix so the right row is picked on decrypt.
    A partial unique index enforces at most one active row per organization.
    """

    __tablename__ = "org_encryption_keys"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "version",
            name="uq_org_encryption_keys_org_version",
        ),
        Index(
            "uq_org_encryption_keys_one_active",
            "organization_id",
            unique=True,
            postgresql_where=text("is_active = true"),
        ),
    )

    id: UUID = Field(
        default_factory=generate_id,
        primary_key=True,
        nullable=False,
    )
    organization_id: UUID = Field(
        foreign_key="login_organizations.id",
        nullable=False,
        index=True,
    )
    version: int = Field(
        sa_column=Column(Integer, nullable=False),
    )
    wrapped_dek: str = Field(
        sa_column=Column(Text, nullable=False),
    )
    is_active: bool = Field(
        default=True,
        sa_column=Column(Boolean, nullable=False, server_default="true"),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    created_by_user_id: UUID | None = Field(
        default=None,
        foreign_key="login_users.id",
        nullable=True,
    )
    retired_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
