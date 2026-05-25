"""Organization invitation table.

Tokens granted to email addresses so they can join an organization. The
raw token (32 url-safe bytes) lives only in the invite email; we store
the SHA256 hex digest so a DB leak cannot be replayed against the
``AcceptInvitation`` RPC.
"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, String
from sqlmodel import Field, SQLModel

from uniffy.core.models.login.organization_member import OrganizationRole
from uniffy.core.types import generate_id


class Invitation(SQLModel, table=True):
    """One row per outstanding invite; ``accepted_at`` enforces single-use."""

    __tablename__ = "login_invitations"

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(
        foreign_key="login_organizations.id",
        nullable=False,
        index=True,
    )
    email: str = Field(
        sa_column=Column(String(320), nullable=False, index=True),
        description="Lowercased recipient address.",
    )
    role: OrganizationRole = Field(default=OrganizationRole.MEMBER, nullable=False)
    invited_by_user_id: UUID = Field(
        foreign_key="login_users.id",
        nullable=False,
    )
    token_hash: str = Field(
        sa_column=Column(String(64), nullable=False, unique=True, index=True),
        description="SHA256 hex digest of the raw token; raw never persisted.",
    )
    expires_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    accepted_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    accepted_by_user_id: UUID | None = Field(
        default=None,
        foreign_key="login_users.id",
        nullable=True,
    )
    revoked_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    revoked_by_user_id: UUID | None = Field(
        default=None,
        foreign_key="login_users.id",
        nullable=True,
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            onupdate=lambda: datetime.now(UTC),
        ),
    )
