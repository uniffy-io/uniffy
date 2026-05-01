"""Per-user agent quota within an organization.

Optional. Absent rows mean the user is only governed by the org budget
and the server-side defaults. Present rows can cap daily/monthly dollar
spend and daily/monthly image generations for that single user.
"""

from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Index,
    Integer,
    Numeric,
    UniqueConstraint,
)
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class AgentUserQuota(SQLModel, table=True):
    """Per-user dollar and image caps within an organization.

    Attributes
    ----------
    id : UUID
        Primary key (UUIDv7).
    organization_id : UUID
        Organization scope.
    user_id : UUID
        Target user.
    daily_limit_usd : Decimal | None
        Dollar cap per UTC day. Null means no daily dollar cap.
    monthly_limit_usd : Decimal | None
        Dollar cap per billing period. Null means no monthly dollar cap.
    daily_image_limit : int | None
        Image-count cap per UTC day. Null means fall through to default.
    monthly_image_limit : int | None
        Image-count cap per billing period. Null means no monthly cap.
    hard_limit : bool
        When true the runtime rejects further activity once a limit is
        crossed for this user.
    created_at, updated_at : datetime
        Row timestamps.

    """

    __tablename__ = "agents_user_quotas"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "user_id",
            name="uq_agents_user_quotas_org_user",
        ),
        Index(
            "ix_agents_user_quotas_user",
            "user_id",
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(nullable=False)
    user_id: UUID = Field(nullable=False)
    daily_limit_usd: Decimal | None = Field(
        default=None,
        sa_column=Column(Numeric(10, 2), nullable=True),
    )
    monthly_limit_usd: Decimal | None = Field(
        default=None,
        sa_column=Column(Numeric(10, 2), nullable=True),
    )
    daily_image_limit: int | None = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
    )
    monthly_image_limit: int | None = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
    )
    hard_limit: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, default=False),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )

    def __repr__(self) -> str:
        """Return string representation of AgentUserQuota."""
        return (
            f"<AgentUserQuota(org={self.organization_id}, "
            f"user={self.user_id}, hard_limit={self.hard_limit})>"
        )
