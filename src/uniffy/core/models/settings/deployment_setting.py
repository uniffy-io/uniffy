"""Deployment-scope key-value settings.

Identical shape to :class:`OrgSetting` but without an
``organization_id`` -- one row per ``(namespace, key)`` for the whole
deployment. Used for operator-editable configuration that needs to
survive process restarts and roll across pods without baking values
into the environment file.

The first consumer is the system-wide mail config (``namespace='mail'``)
so a self-hoster can bring up the stack with zero env, then point the
SMTP relay at their own infrastructure from the UI. Future deployment-
level knobs (telemetry opt-in, analytics endpoint, branding overrides,
registration policy beyond a simple boolean, ...) land here as new
``(namespace, key)`` rows without further migrations.

Secrets are encrypted via :class:`DeploymentCipher` (singleton DEK
wrapped by the master KEK) and stored in ``value_encrypted``. The
exclusive CHECK constraint matches ``org_settings`` so consumers can
treat the two stores the same way.
"""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class DeploymentSetting(SQLModel, table=True):
    """One key-value entry inside the deployment-wide settings store."""

    __tablename__ = "deployment_settings"
    __table_args__ = (
        CheckConstraint(
            "(is_secret = true  AND value_encrypted IS NOT NULL AND value IS NULL) "
            "OR (is_secret = false AND value_encrypted IS NULL)",
            name="ck_deployment_settings_value_exclusive",
        ),
    )

    namespace: str = Field(
        sa_column=Column(String(64), primary_key=True, nullable=False),
        description="Logical grouping, e.g. 'mail', 'telemetry', 'branding'.",
    )
    key: str = Field(
        sa_column=Column(String(128), primary_key=True, nullable=False),
        description="Setting name within the namespace.",
    )
    value: dict[str, Any] | list | str | int | float | bool | None = Field(
        default=None,
        sa_column=Column(JSONB(none_as_null=True), nullable=True),
        description=(
            "Plaintext JSON value. Mutually exclusive with value_encrypted. "
            "``none_as_null=True`` makes Python ``None`` bind to SQL NULL "
            "(not JSON ``null``) so the check constraint sees an empty cell."
        ),
    )
    value_encrypted: str | None = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
        description=(
            "DeploymentCipher ciphertext 'v{n}:...'. Populated when "
            "is_secret=true; encrypted with the deployment-singleton DEK "
            "wrapped by the master KEK."
        ),
    )
    is_secret: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, server_default="false"),
    )
    updated_by_user_id: UUID | None = Field(
        default=None,
        foreign_key="login_users.id",
        nullable=True,
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            onupdate=lambda: datetime.now(UTC),
        ),
    )
