"""Time-bound, audited grants for platform operators into one tenant.

A :class:`SupportSession` is the only sanctioned path for a platform
admin to read tenant content. The row carries the grant's reason,
scope, lifecycle state, and the actors on each side. The audit
writer reads the active session from a ContextVar and tags every
audit event written during the session with
``actor_kind="support"``, ``support_session_id`` and ``scope`` so
the org owner can filter their audit log for support access.
"""

from datetime import UTC, datetime
from enum import Enum
from uuid import UUID

from sqlalchemy import Column, DateTime
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class SupportSessionScope(str, Enum):
    """Access scope granted by the session.

    v1 ships READ_ONLY only. READ_WRITE is reserved for a future
    phase that wires the cipher + audit write-path; the enum value
    exists so the table schema does not need a migration when it
    lands.
    """

    READ_ONLY = "READ_ONLY"
    READ_WRITE = "READ_WRITE"


class SupportSessionState(str, Enum):
    """Lifecycle state of a session row."""

    PENDING = "PENDING"
    ACTIVE = "ACTIVE"
    EXPIRED = "EXPIRED"
    REVOKED = "REVOKED"
    REJECTED = "REJECTED"


class SupportSession(SQLModel, table=True):
    """One support session grant.

    Attributes
    ----------
    id : UUID
        Primary key.
    organization_id : UUID
        Target tenant. FK to ``login_organizations`` cascade.
    support_user_id : UUID
        Platform admin who will operate under this session.
    requested_by_user_id : UUID
        Identical to ``support_user_id`` today; reserved for future
        delegated-request flows.
    granted_by_user_id : UUID | None
        Org OWNER/ADMIN who approved (OWNER_APPROVED mode). ``None``
        for OPERATOR_JUSTIFIED rows or while PENDING.
    revoked_by_user_id : UUID | None
        Whoever ended the session early (org admin or the support
        user themselves).
    reason : str
        Free text. Recorded in audit + surfaced on the owner banner.
    scope : SupportSessionScope
        READ_ONLY in v1.
    state : SupportSessionState
        Lifecycle position. Read by :class:`PermissionChecker` -
        only ``ACTIVE`` confers access.
    requested_at : datetime
        Row creation time.
    granted_at : datetime | None
        When the state flipped to ACTIVE.
    expires_at : datetime
        Hard cap. ACTIVE sessions past this are flipped to EXPIRED
        by the ARQ cron and refused mid-request by the permission
        check.
    revoked_at : datetime | None
        Set when an admin or the support user revokes.
    """

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
        """Return string representation of SupportSession."""
        return (
            f"<SupportSession(id={self.id}, org={self.organization_id}, "
            f"support_user={self.support_user_id}, state={self.state})>"
        )
