"""Organization model."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import Column, DateTime
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class Organization(SQLModel, table=True):
    """
    Organization model representing a workspace/tenant.

    Organizations are the main multi-tenancy boundary.
    Similar to Slack workspaces or GitHub organizations.

    Attributes
    ----------
    id : UUID
        Unique identifier for the organization (primary key).
    name : str
        Organization name (e.g., "Acme Corp").
    slug : str
        URL-friendly slug (e.g., "acme-corp"), globally unique.
    domain : str | None
        Organization email domain for auto-join or SSO (e.g., "acme.com").
    is_active : bool
        Whether the organization is active.
    plan : str
        Subscription plan (e.g., "free", "pro", "enterprise").
    max_members : int | None
        Maximum allowed members (None = unlimited).
    settings : dict | None
        JSON settings for organization preferences.
    created_at : datetime
        Timestamp when the organization was created.
    updated_at : datetime
        Timestamp when the organization was last updated.

    """

    __tablename__ = "login_organizations"

    id: UUID = Field(default_factory=uuid4, primary_key=True, nullable=False)
    name: str = Field(max_length=255, nullable=False)
    slug: str = Field(max_length=255, unique=True, index=True, nullable=False)
    domain: str | None = Field(default=None, max_length=255, index=True)
    is_active: bool = Field(default=True, nullable=False)
    plan: str = Field(default="free", max_length=50, nullable=False)
    max_members: int | None = Field(default=None)
    settings: dict[str, Any] | None = Field(default=None, sa_column=Column(JSONB))
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)),
    )

    def __repr__(self) -> str:
        """Return string representation of Organization."""
        return f"<Organization(id={self.id}, name={self.name}, slug={self.slug})>"
