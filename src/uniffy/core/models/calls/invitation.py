from datetime import UTC, datetime
from enum import StrEnum
from uuid import UUID

from sqlalchemy import Column, DateTime, ForeignKey, Index
from sqlalchemy import Enum as SAEnum
from sqlmodel import Field, SQLModel


class CallInvitationOutcome(StrEnum):
    RINGING = "RINGING"
    ANSWERED = "ANSWERED"
    DECLINED = "DECLINED"
    MISSED = "MISSED"


class CallInvitation(SQLModel, table=True):
    __tablename__ = "calls_invitations"
    __table_args__ = (
        Index("ix_calls_invitations_user", "organization_id", "user_id", "call_id"),
        Index("ix_calls_invitations_pending", "expires_at", postgresql_where="outcome = 'RINGING'"),
    )

    call_id: UUID = Field(
        sa_column=Column(ForeignKey("calls_calls.id", ondelete="CASCADE"), primary_key=True)
    )
    user_id: UUID = Field(
        sa_column=Column(ForeignKey("login_users.id", ondelete="CASCADE"), primary_key=True)
    )
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False)
    outcome: CallInvitationOutcome = Field(
        default=CallInvitationOutcome.RINGING,
        sa_column=Column(
            SAEnum(
                CallInvitationOutcome,
                name="callinvitationoutcome",
                values_callable=lambda values: [v.value for v in values],
            ),
            nullable=False,
        ),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    expires_at: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False))
    responded_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))
