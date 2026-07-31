"""Integration connection model for encrypted external-service credentials."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Boolean, Column, DateTime, String, Text, UniqueConstraint
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class IntegrationConnection(SQLModel, table=True):
    """Org-wide credential for one external service instance (OrgCipher at rest)."""

    __tablename__ = "integrations_connections"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "provider",
            "name",
            name="uq_integrations_connections_org_provider_name",
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    provider: str = Field(
        sa_column=Column(String(50), nullable=False),
    )
    name: str = Field(
        sa_column=Column(String(255), nullable=False),
    )
    # NULL means the provider's cloud default; set for GHE / self-managed GitLab.
    base_url: str | None = Field(
        default=None,
        sa_column=Column(String(512), nullable=True),
    )
    encrypted_credential: str = Field(
        sa_column=Column(Text, nullable=False),
    )
    credential_hint: str = Field(
        sa_column=Column(String(20), nullable=False),
    )
    # Probe-discovered login so the admin can see WHO the token acts as.
    account_login: str | None = Field(
        default=None,
        sa_column=Column(String(255), nullable=True),
    )
    # Load-bearing write gate: when false, write tools are not advertised to
    # the model and the executor refuses as a backstop.
    allow_writes: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, server_default="false"),
    )
    is_valid: bool = Field(default=True, nullable=False)
    is_enabled: bool = Field(
        default=True,
        sa_column=Column(Boolean, nullable=False, server_default="true"),
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
            f"<IntegrationConnection(id={self.id}, provider={self.provider!r}, "
            f"name={self.name!r}, org_id={self.organization_id})>"
        )
