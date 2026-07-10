"""Per-channel and per-org call configuration rows."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, ForeignKey
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class ChannelCallSettings(SQLModel, table=True):
    """Per-channel call config; absent row means defaults."""

    __tablename__ = "calls_channel_settings"

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    channel_id: UUID = Field(
        sa_column=Column(
            ForeignKey("chat_channels.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
    )
    organization_id: UUID = Field(
        foreign_key="login_organizations.id", nullable=False, index=True
    )
    # False turns the channel into listen-only for plain members (town-hall).
    allow_member_publish: bool = Field(default=True, nullable=False)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)),
    )


class OrgCallPolicy(SQLModel, table=True):
    """Per-org call policy; absent row means defaults."""

    __tablename__ = "calls_org_policies"

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(
        foreign_key="login_organizations.id", nullable=False, unique=True
    )
    calls_enabled: bool = Field(default=True, nullable=False)
    max_participants: int = Field(default=50, nullable=False)
    max_duration_minutes: int = Field(default=480, nullable=False)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)),
    )
