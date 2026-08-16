"""Persisted requests for access to restricted content."""

from datetime import UTC, datetime
from enum import StrEnum
from uuid import UUID

from sqlalchemy import Column, DateTime, Enum, Index, String, Text, text
from sqlmodel import Field, SQLModel

from uniffy.core.types import ContentRole, ContentType, generate_id


class ContentAccessRequestState(StrEnum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    DENIED = "DENIED"
    CANCELED = "CANCELED"


class ContentAccessRequest(SQLModel, table=True):
    """One requester's access request, including the target that receives the grant."""

    __tablename__ = "permissions_content_access_requests"
    __table_args__ = (
        Index(
            "uq_content_access_request_pending_target",
            "organization_id",
            "requester_id",
            "canonical_content_type",
            "canonical_content_id",
            unique=True,
            postgresql_where=text("state = 'PENDING'"),
        ),
        Index(
            "ix_content_access_request_requester_recent",
            "organization_id",
            "requester_id",
            "created_at",
        ),
        Index(
            "ix_content_access_request_canonical_status",
            "organization_id",
            "canonical_content_type",
            "canonical_content_id",
            "state",
            "created_at",
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(
        foreign_key="login_organizations.id",
        nullable=False,
    )
    requester_id: UUID = Field(foreign_key="login_users.id", nullable=False)
    requested_urn: str = Field(sa_column=Column(String(255), nullable=False))
    original_content_type: ContentType = Field(nullable=False)
    original_content_id: UUID = Field(nullable=False)
    canonical_content_type: ContentType = Field(nullable=False)
    canonical_content_id: UUID = Field(nullable=False)
    state: ContentAccessRequestState = Field(
        default=ContentAccessRequestState.PENDING,
        sa_column=Column(
            Enum(
                ContentAccessRequestState,
                name="contentaccessrequeststate",
                values_callable=lambda enum: [member.value for member in enum],
            ),
            nullable=False,
        ),
    )
    message: str = Field(default="", sa_column=Column(String(500), nullable=False))
    decision_note: str = Field(default="", sa_column=Column(Text, nullable=False))
    approved_role: ContentRole | None = Field(
        default=None,
        sa_column=Column(
            Enum(
                ContentRole,
                name="contentrole",
                values_callable=lambda enum: [member.value for member in enum],
                create_type=False,
            ),
            nullable=True,
        ),
    )
    responded_by_user_id: UUID | None = Field(
        default=None,
        foreign_key="login_users.id",
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
    responded_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
