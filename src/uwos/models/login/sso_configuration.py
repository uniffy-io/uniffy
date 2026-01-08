"""SSO configuration model for enterprise authentication."""

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional
from uuid import UUID, uuid4

from sqlalchemy import Column, DateTime
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class SSOProvider(str, Enum):
    """Supported SSO providers."""

    SAML = "saml"  # SAML 2.0
    OIDC = "oidc"  # OpenID Connect
    GOOGLE = "google"  # Google Workspace
    MICROSOFT = "microsoft"  # Microsoft Azure AD
    OKTA = "okta"  # Okta


class SSOConfiguration(SQLModel, table=True):
    """
    SSO configuration for organizations.

    Stores SAML/OIDC/OAuth configuration per organization.
    Enables enterprise authentication and auto-provisioning.

    Attributes
    ----------
    id : UUID
        Unique identifier for the SSO configuration (primary key).
    organization_id : UUID
        Foreign key to organizations table.
    provider : SSOProvider
        SSO provider type.
    is_enabled : bool
        Whether SSO is currently enabled for this organization.
    enforce_sso : bool
        Whether to enforce SSO (disable password login for domain users).
    domain : str
        Email domain for SSO enforcement (e.g., "company.com").
    metadata_url : str | None
        SAML metadata URL or OIDC discovery URL.
    entity_id : str | None
        SAML entity ID / OIDC client ID.
    sso_url : str | None
        SAML SSO URL / OIDC authorization endpoint.
    certificate : str | None
        SAML x509 certificate.
    client_secret : str | None
        OIDC/OAuth client secret (encrypted).
    settings : dict | None
        Additional provider-specific settings (JSONB).
    created_at : datetime
        Timestamp when the SSO config was created.
    updated_at : datetime
        Timestamp when the SSO config was last updated.

    """

    __tablename__ = "login_sso_configurations"

    id: UUID = Field(default_factory=uuid4, primary_key=True, nullable=False)
    organization_id: UUID = Field(
        foreign_key="login_organizations.id", nullable=False, unique=True, index=True
    )
    provider: SSOProvider = Field(nullable=False)
    is_enabled: bool = Field(default=False, nullable=False)
    enforce_sso: bool = Field(default=False, nullable=False)
    domain: str = Field(max_length=255, nullable=False)
    metadata_url: Optional[str] = Field(default=None, max_length=1000)
    entity_id: Optional[str] = Field(default=None, max_length=500)
    sso_url: Optional[str] = Field(default=None, max_length=1000)
    certificate: Optional[str] = Field(default=None)
    client_secret: Optional[str] = Field(default=None)
    settings: Optional[dict[str, Any]] = Field(default=None, sa_column=Column(JSONB))
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(timezone.utc)),
    )

    def __repr__(self) -> str:
        """Return string representation of SSOConfiguration."""
        return (
            f"<SSOConfiguration(organization_id={self.organization_id}, "
            f"provider={self.provider}, enabled={self.is_enabled})>"
        )
