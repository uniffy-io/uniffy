"""Call session and participant models."""

from datetime import UTC, datetime
from enum import Enum
from uuid import UUID

from sqlalchemy import Column, DateTime, ForeignKey, Index
from sqlalchemy import Enum as SAEnum
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class CallType(str, Enum):
    DIRECT = "DIRECT"
    GROUP_DM = "GROUP_DM"
    CHANNEL = "CHANNEL"


class CallEndReason(str, Enum):
    HOST_ENDED = "HOST_ENDED"
    ALL_LEFT = "ALL_LEFT"
    MAX_DURATION = "MAX_DURATION"
    SOLO_TIMEOUT = "SOLO_TIMEOUT"
    CHANNEL_ARCHIVED = "CHANNEL_ARCHIVED"


class Call(SQLModel, table=True):
    """One call session in a channel; ended_at IS NULL marks it active.

    The partial unique index on (channel_id) WHERE ended_at IS NULL is the
    concurrency guard for simultaneous starts - the loser of the race joins
    the winner's call instead of creating a second one.
    """

    __tablename__ = "calls_calls"
    __table_args__ = (
        Index(
            "uq_calls_active_per_channel",
            "channel_id",
            unique=True,
            postgresql_where="ended_at IS NULL",
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(
        foreign_key="login_organizations.id", nullable=False, index=True
    )
    channel_id: UUID = Field(
        sa_column=Column(
            ForeignKey("chat_channels.id", ondelete="CASCADE"), nullable=False, index=True
        ),
    )
    call_type: CallType = Field(
        sa_column=Column(
            SAEnum(CallType, name="calltype", values_callable=lambda x: [e.value for e in x]),
            nullable=False,
        ),
    )
    initiator_user_id: UUID = Field(foreign_key="login_users.id", nullable=False)
    host_user_id: UUID = Field(foreign_key="login_users.id", nullable=False)
    # LiveKit room name: "org_{organization_id}:call_{id}" - org prefix is a
    # cross-org isolation defense inside the shared SFU.
    livekit_room_name: str = Field(max_length=120, nullable=False, unique=True)
    started_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    ended_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))
    end_reason: CallEndReason | None = Field(
        default=None,
        sa_column=Column(
            SAEnum(
                CallEndReason,
                name="callendreason",
                values_callable=lambda x: [e.value for e in x],
            ),
            nullable=True,
        ),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)),
    )

    @property
    def is_active(self) -> bool:
        return self.ended_at is None


class CallParticipant(SQLModel, table=True):
    """Per-(call, user, device) join record; left_at IS NULL marks presence.

    A rejoin within the grace window reopens the row (left_at cleared) so the
    partial unique index on (call_id, identity) holds one active row per device.
    """

    __tablename__ = "calls_participants"
    __table_args__ = (
        Index(
            "uq_calls_participants_active_identity",
            "call_id",
            "identity",
            unique=True,
            postgresql_where="left_at IS NULL",
        ),
        Index("ix_calls_participants_call_user", "call_id", "user_id"),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    call_id: UUID = Field(
        sa_column=Column(
            ForeignKey("calls_calls.id", ondelete="CASCADE"), nullable=False, index=True
        ),
    )
    organization_id: UUID = Field(
        foreign_key="login_organizations.id", nullable=False, index=True
    )
    user_id: UUID = Field(foreign_key="login_users.id", nullable=False, index=True)
    device_id: str = Field(max_length=64, nullable=False)
    # LiveKit identity "{user_id}:{device_id}" - webhook events key on this.
    identity: str = Field(max_length=120, nullable=False)
    device_label: str | None = Field(default=None, max_length=120)
    # jti of the participant's most recently minted token; advances on refresh.
    token_jti: str | None = Field(default=None, max_length=64)
    # jti the live SFU media session presents in its webhook events. Set at join,
    # unchanged by a token refresh (the refreshed token is never handed to the
    # Room), reset only when a grace rejoin establishes a fresh session.
    session_jti: str | None = Field(default=None, max_length=64)
    joined_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    left_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))
    # First reconcile pass that saw this row absent from the SFU. A ghost is
    # retired only after a second consecutive absent pass, so an SFU restart
    # mid-window records absence instead of mass-evicting a live call.
    missing_since: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
    )
    mic_enabled: bool = Field(default=True, nullable=False)
    camera_enabled: bool = Field(default=False, nullable=False)
    screen_sharing: bool = Field(default=False, nullable=False)

    @property
    def is_active(self) -> bool:
        return self.left_at is None
