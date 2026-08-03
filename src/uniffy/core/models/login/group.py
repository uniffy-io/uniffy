"""Group model for organization-level teams."""

from datetime import UTC, datetime
from enum import Enum
from uuid import UUID

from sqlalchemy import Column, DateTime, ForeignKey, Index, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class GroupKind(str, Enum):
    """TEAM = org-structure unit (chart, lead, parent); ACCESS = permission bundle.
    Both stay valid `ContentMember` subjects."""

    TEAM = "TEAM"
    ACCESS = "ACCESS"


class Group(SQLModel, table=True):
    """Org-scoped team. Used as a permission subject in `ContentMember` grants."""

    __tablename__ = "login_groups"
    __table_args__ = (
        UniqueConstraint("organization_id", "slug", name="uq_login_groups_org_slug"),
        # Teams and access groups share one per-org name namespace; a duplicate
        # would render as two identical rows in every subject picker.
        Index(
            "uq_login_groups_org_name_lower",
            "organization_id",
            text("lower(name)"),
            unique=True,
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    name: str = Field(max_length=255, nullable=False)
    slug: str = Field(max_length=255, nullable=False, index=True)
    description: str | None = Field(default=None, max_length=1000)
    is_private: bool = Field(default=False, nullable=False)
    # A TEAM is always org-visible (is_private=False); the chart cache, mention
    # fanout and search metadata carry team facts with no per-viewer redaction.
    kind: GroupKind = Field(default=GroupKind.ACCESS, nullable=False)
    parent_group_id: UUID | None = Field(
        default=None,
        sa_column=Column(ForeignKey("login_groups.id", ondelete="SET NULL"), nullable=True),
    )
    lead_user_id: UUID | None = Field(
        default=None,
        sa_column=Column(ForeignKey("login_users.id", ondelete="SET NULL"), nullable=True),
    )
    managed_fields: list = Field(
        default_factory=list,
        sa_column=Column(JSONB, nullable=False, server_default=text("'[]'::jsonb")),
    )
    created_by_user_id: UUID = Field(foreign_key="login_users.id", nullable=False)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)),
    )

    def __repr__(self) -> str:
        return f"<Group(id={self.id}, name={self.name}, organization_id={self.organization_id})>"
