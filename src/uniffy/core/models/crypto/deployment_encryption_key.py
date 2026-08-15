"""Deployment-singleton DEK row used by :class:`DeploymentCipher`.

Mirrors :class:`OrgEncryptionKey` minus the organization scoping. At
most one ``is_active=true`` row exists; rotation inserts a fresh
version-bumped row and retires the previous one. The wrapped DEK is
unwrapped on first use, cached in process memory, and used to encrypt
deployment-scope secrets such as the system SMTP password.

The table is empty by default. The cipher self-provisions the v1 row
on the first encrypt call, so a fresh deployment doesn't need a
bootstrap step.
"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Boolean, Column, DateTime, Integer, Text, UniqueConstraint
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class DeploymentEncryptionKey(SQLModel, table=True):
    """Singleton (per-version) wrapped DEK for deployment-scope secrets."""

    __tablename__ = "deployment_encryption_keys"
    __table_args__ = (UniqueConstraint("version", name="uq_deployment_encryption_keys_version"),)

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    version: int = Field(
        sa_column=Column(Integer, nullable=False),
        description="Monotonic version, starts at 1, bumps on rotation.",
    )
    wrapped_dek: str = Field(
        sa_column=Column(Text, nullable=False),
        description="Fernet token (master-cipher ciphertext) wrapping the DEK.",
    )
    is_active: bool = Field(
        default=True,
        sa_column=Column(Boolean, nullable=False, server_default="true"),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    retired_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
