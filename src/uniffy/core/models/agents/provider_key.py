"""Provider key model for encrypted LLM credential storage."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Boolean, Column, DateTime, Enum, String, Text, UniqueConstraint
from sqlmodel import Field, SQLModel

from uniffy.core.types import AccessMode, ContentRole, generate_id


class ProviderKey(SQLModel, table=True):
    """
    Encrypted LLM provider credential for an organization.

    Stores API keys and setup tokens for LLM providers (e.g. Anthropic).
    Credentials are encrypted at rest via Fernet. The actual credential
    is never exposed through the API -only a masked hint is returned.

    Attributes
    ----------
    id : UUID
        Unique identifier (primary key, UUIDv7).
    organization_id : UUID
        Organization this key belongs to (FK to login_organizations).
    provider : str
        Provider name (e.g. "anthropic").
    credential_type : str
        Type of credential: "api_key" or "setup_token".
    label : str
        User-friendly label (e.g. "My Claude Max token").
    encrypted_credential : str
        Fernet-encrypted credential string.
    key_hint : str
        Masked hint for display (e.g. "sk-ant-oat01-...xyz").
    is_valid : bool
        Whether the key passed its last validation check.
    is_enabled : bool
        Whether the key is enabled for use.
    last_validated_at : datetime | None
        Timestamp of last successful or failed validation.
    last_used_at : datetime | None
        Timestamp of last API call using this key.
    last_error : str | None
        Error message from the last failed validation.
    created_by : UUID
        User who added this key (FK to login_users).
    created_at : datetime
        Timestamp when the key was created.
    updated_at : datetime
        Timestamp when the key was last updated.

    """

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
    access_mode: AccessMode = Field(
        default=AccessMode.OWNER_ONLY,
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
        """Return string representation of ProviderKey."""
        return (
            f"<ProviderKey(id={self.id}, provider={self.provider!r}, "
            f"label={self.label!r}, org_id={self.organization_id})>"
        )
