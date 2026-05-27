"""Pending peer co-sign requests for platform-admin MFA resets.

Two-of-N invariant: a platform admin cannot reset another platform
admin's MFA on their own. The flow is

1. Admin A calls ``RequestPlatformPeerReset(target=B, reason=...)``;
   a row lands here with ``expires_at = now + 10 min`` and
   ``approved_at = NULL``.
2. A different admin C (not A, not B) calls
   ``ApprovePlatformPeerReset(request_id=...)`` before ``expires_at``;
   the row is stamped with ``approved_at`` + ``approver_user_id`` and
   the actual reset runs in the same transaction.

Rows are kept (not deleted) after approval for the audit trail; an
approved row is rejected by ``ApprovePlatformPeerReset`` so the same
co-sign cannot be replayed.
"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, Index, Text, text
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class PlatformMfaResetRequest(SQLModel, table=True):
    """One pending or completed peer-co-sign reset request."""

    __tablename__ = "platform_mfa_reset_requests"
    __table_args__ = (
        Index(
            "ix_platform_mfa_reset_requests_pending",
            "expires_at",
            postgresql_where=text("approved_at IS NULL"),
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    requester_user_id: UUID = Field(
        foreign_key="login_users.id",
        nullable=False,
        index=True,
    )
    target_user_id: UUID = Field(
        foreign_key="login_users.id",
        nullable=False,
        index=True,
    )
    reason: str = Field(
        sa_column=Column(Text, nullable=False, server_default=""),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    expires_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    approved_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    approver_user_id: UUID | None = Field(
        default=None,
        foreign_key="login_users.id",
        nullable=True,
    )
