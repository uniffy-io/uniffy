"""Explicit role grants for any content type.

`role=BLOCKED` is an explicit deny that overrides every other grant for
the subject. `PermissionChecker` resolves the highest non-blocked role
across direct + group paths; any matching BLOCKED row wins.
"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, Index, UniqueConstraint
from sqlmodel import Field, SQLModel

from uniffy.core.models.shared import ContentRole, ContentType, SubjectType
from uniffy.core.types import generate_id


class ContentMember(SQLModel, table=True):
    """Explicit role grant for a subject (USER or GROUP) on one content item.

    `(content_type, content_id)` and `(subject_type, subject_id)` are polymorphic;
    no FK because the targets live in different tables. ORGANIZATION subjects
    are NOT stored here - org-wide access uses `access_mode=OPEN_TO_ORG` on the
    content row itself.
    """

    __tablename__ = "permissions_content_members"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "content_type",
            "content_id",
            "subject_type",
            "subject_id",
            name="uq_content_member",
        ),
        Index("ix_content_member_content", "content_type", "content_id"),
        Index("ix_content_member_subject", "subject_type", "subject_id"),
        Index("ix_content_member_org", "organization_id"),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False)
    content_type: ContentType = Field(nullable=False)
    content_id: UUID = Field(nullable=False)
    subject_type: SubjectType = Field(nullable=False)
    subject_id: UUID = Field(nullable=False)
    role: ContentRole = Field(nullable=False)
    added_by_user_id: UUID = Field(foreign_key="login_users.id", nullable=False)
    added_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)),
    )
    expires_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))

    def __repr__(self) -> str:
        return (
            f"<ContentMember(content_type={self.content_type}, "
            f"content_id={self.content_id}, subject_type={self.subject_type}, "
            f"subject_id={self.subject_id}, role={self.role})>"
        )
