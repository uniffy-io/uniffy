"""Time-bound, audited platform-operator grant into one tenant.

A `SupportSession` is the ONLY sanctioned path for a platform admin to
read tenant content - `is_system_admin=True` alone does not bypass
`PermissionChecker`. The audit writer reads the active session from a
ContextVar and tags every event with `actor_kind="support"` +
`support_session_id` so the org owner can audit operator access.
"""

from datetime import UTC, datetime
from enum import Enum
from uuid import UUID

from sqlalchemy import Column, DateTime
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class SupportSessionScope(str, Enum):
    """Access scope granted; only ACTIVE READ_ONLY sessions confer read access today."""

    READ_ONLY = "READ_ONLY"
    READ_WRITE = "READ_WRITE"


class SupportSessionState(str, Enum):
    """Lifecycle state. `PermissionChecker` only honors ACTIVE."""

    PENDING = "PENDING"
    ACTIVE = "ACTIVE"
    EXPIRED = "EXPIRED"
    REVOKED = "REVOKED"
    REJECTED = "REJECTED"


class SupportSession(SQLModel, table=True):
    """One support session grant. `expires_at` is a hard cap enforced live + by cron."""

    __tablename__ = "platform_support_sessions"

    id: UUID = Field(
        default_factory=generate_id,
        primary_key=True,
        nullable=False,
    )
    organization_id: UUID = Field(
        foreign_key="login_organizations.id",
        nullable=False,
        index=True,
    )
    support_user_id: UUID = Field(
        foreign_key="login_users.id",
        nullable=False,
        index=True,
    )
    requested_by_user_id: UUID = Field(
        foreign_key="login_users.id",
        nullable=False,
    )
    granted_by_user_id: UUID | None = Field(
        default=None,
        foreign_key="login_users.id",
        nullable=True,
    )
    revoked_by_user_id: UUID | None = Field(
        default=None,
        foreign_key="login_users.id",
        nullable=True,
    )
    reason: str = Field(max_length=2000, nullable=False)
    scope: SupportSessionScope = Field(
        default=SupportSessionScope.READ_ONLY, nullable=False
    )
    state: SupportSessionState = Field(
        default=SupportSessionState.PENDING, nullable=False, index=True
    )
    requested_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    granted_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    expires_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False, index=True),
    )
    revoked_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)
        ),
    )

    def __repr__(self) -> str:
        return (
            f"<SupportSession(id={self.id}, org={self.organization_id}, "
            f"support_user={self.support_user_id}, state={self.state})>"
        )
