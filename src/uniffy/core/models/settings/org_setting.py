"""Per-org key-value settings, one row per `(organization_id, namespace, key)`.

`value` and `value_encrypted` are mutually exclusive (CHECK constraint);
`is_secret=true` rows use OrgCipher and rotate via the standard
`ReEncryptingConsumer` registered for `WHERE is_secret = true`.
"""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class OrgSetting(SQLModel, table=True):
    """One key-value entry inside an org's settings store."""

    __tablename__ = "org_settings"
    __table_args__ = (
        CheckConstraint(
            "(is_secret = true  AND value_encrypted IS NOT NULL AND value IS NULL) "
            "OR (is_secret = false AND value_encrypted IS NULL)",
            name="ck_org_settings_value_exclusive",
        ),
    )

    organization_id: UUID = Field(
        foreign_key="login_organizations.id",
        primary_key=True,
        nullable=False,
    )
    namespace: str = Field(
        sa_column=Column(String(64), primary_key=True, nullable=False),
        description="Logical grouping, e.g. 'mail', 'branding', 'features'.",
    )
    key: str = Field(
        sa_column=Column(String(128), primary_key=True, nullable=False),
        description="Setting name within the namespace.",
    )
    value: dict[str, Any] | list | str | int | float | bool | None = Field(
        default=None,
        sa_column=Column(JSONB(none_as_null=True), nullable=True),
        description=(
            "Plaintext JSON value; `none_as_null=True` so Python None binds "
            "to SQL NULL (not JSON null) and the check constraint matches."
        ),
    )
    value_encrypted: str | None = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
        description="OrgCipher ciphertext 'v{n}:...'. Populated when is_secret=true.",
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
