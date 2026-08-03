"""Org-scoped people profile model."""

from datetime import UTC, date, datetime
from uuid import UUID

from sqlalchemy import Column, Date, DateTime, ForeignKey, Index, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class PeopleProfile(SQLModel, table=True):
    """Org-scoped profile facts for one member; global identity stays on `User`."""

    __tablename__ = "people_profiles"
    __table_args__ = (
        UniqueConstraint("organization_id", "user_id", name="uq_people_profiles_org_user"),
        Index("ix_people_profiles_org_manager", "organization_id", "manager_user_id"),
        Index("ix_people_profiles_org_department", "organization_id", "department"),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(
        sa_column=Column(
            ForeignKey("login_organizations.id", ondelete="CASCADE"), nullable=False, index=True
        )
    )
    user_id: UUID = Field(
        sa_column=Column(
            ForeignKey("login_users.id", ondelete="CASCADE"), nullable=False, index=True
        )
    )
    job_title: str | None = Field(default=None, max_length=255)
    department: str | None = Field(default=None, max_length=255)
    work_phone: str | None = Field(default=None, max_length=50)
    mobile_phone: str | None = Field(default=None, max_length=50)
    office_location: str | None = Field(default=None, max_length=255)
    timezone: str | None = Field(default=None, max_length=64)
    bio: str | None = Field(default=None, max_length=2000)
    start_date: date | None = Field(default=None, sa_column=Column(Date(), nullable=True))
    # MM-DD; a full date is unnecessary PII.
    birthday: str | None = Field(default=None, max_length=5)
    links: list = Field(
        default_factory=list,
        sa_column=Column(JSONB, nullable=False, server_default=text("'[]'::jsonb")),
    )
    # A deleted manager must orphan reports, not cascade-delete them.
    manager_user_id: UUID | None = Field(
        default=None,
        sa_column=Column(ForeignKey("login_users.id", ondelete="SET NULL"), nullable=True),
    )
    managed_fields: list = Field(
        default_factory=list,
        sa_column=Column(JSONB, nullable=False, server_default=text("'[]'::jsonb")),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)),
    )

    def __repr__(self) -> str:
        return f"<PeopleProfile(organization_id={self.organization_id}, user_id={self.user_id})>"
