"""Provider key model for encrypted LLM credential storage."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Boolean, Column, DateTime, Enum, String, Text, UniqueConstraint
from sqlmodel import Field, SQLModel

from uniffy.core.types import AccessMode, ContentRole, generate_id


class ProviderKey(SQLModel, table=True):
    """Encrypted LLM provider credential for an organization (Fernet at rest)."""

    __tablename__ = "agents_provider_keys"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "provider",
            "label",
            name="uq_agents_provider_keys_org_provider_label",
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    provider: str = Field(
        sa_column=Column(String(50), nullable=False),
    )
    credential_type: str = Field(
        sa_column=Column(String(20), nullable=False),
    )
    label: str = Field(
        sa_column=Column(String(255), nullable=False),
    )
    encrypted_credential: str = Field(
        sa_column=Column(Text, nullable=False),
    )
    key_hint: str = Field(
        sa_column=Column(String(20), nullable=False),
    )
    is_valid: bool = Field(default=True, nullable=False)
    is_enabled: bool = Field(
        default=True,
        sa_column=Column(Boolean, nullable=False, server_default="true"),
    )
    access_mode: AccessMode | None = Field(
        default=None,
        sa_column=Column(
            Enum(
                AccessMode,
                name="accessmode",
                values_callable=lambda x: [e.value for e in x],
                create_type=False,
            ),
            nullable=True,
            index=True,
        ),
    )
    baseline_role: ContentRole | None = Field(
        default=None,
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
    last_validated_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    last_used_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    last_error: str | None = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )
    created_by: UUID = Field(foreign_key="login_users.id", nullable=False)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)),
    )

    def __repr__(self) -> str:
        return (
            f"<ProviderKey(id={self.id}, provider={self.provider!r}, "
            f"label={self.label!r}, org_id={self.organization_id})>"
        )
