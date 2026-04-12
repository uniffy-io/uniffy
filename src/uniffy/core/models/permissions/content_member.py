"""ContentMember model: explicit role grants for any content type.

Each row grants a single subject (user or group) a specific role on a
specific piece of content. Rows are the source of truth for non-baseline
access; baseline access comes from the content item's ``access_mode`` and
``baseline_role`` columns.

Semantics:
- ``role`` may be any value from :class:`ContentRole`, including ``BLOCKED``
  which is an explicit deny that overrides any baseline for the subject.
- A user may have grants via multiple paths (direct + multiple groups).
  The permission checker picks the highest applicable role, with ``BLOCKED``
  from any source winning.
- ``expires_at`` is optional. Expired rows are filtered by the read path.
- ``added_by_user_id`` is the audit actor; use ``ContentMemberEvent`` for
  the full history of additions, role changes, and removals.
"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, Index, UniqueConstraint
from sqlmodel import Field, SQLModel

from uniffy.core.models.shared import ContentRole, ContentType, SubjectType
from uniffy.core.types import generate_id


class ContentMember(SQLModel, table=True):
    """
    Explicit role grant for a subject (user or group) on a content item.

    Attributes
    ----------
    id : UUID
        Unique identifier (primary key, UUIDv7).
    organization_id : UUID
        Organization the grant belongs to (foreign key).
    content_type : ContentType
        Type of content this grant applies to.
    content_id : UUID
        ID of the content item. Polymorphic -- no foreign key constraint
        because different content types live in different tables.
    subject_type : SubjectType
        USER or GROUP. (ORGANIZATION subjects are not used for content
        members; org-wide access is modeled via ``access_mode=OPEN_TO_ORG``
        on the content itself.)
    subject_id : UUID
        ID of the user or group. Polymorphic -- no foreign key constraint.
    role : ContentRole
        Role granted to the subject. May be ``BLOCKED`` for explicit deny.
    added_by_user_id : UUID
        User who created this grant (for audit; see ``ContentMemberEvent``
        for the full history).
    added_at : datetime
        When the grant was created.
    updated_at : datetime
        When the grant's role was last changed.
    expires_at : datetime | None
        Optional expiration time. Expired rows are ignored by read paths.

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
    expires_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
    )

    def __repr__(self) -> str:
        """Return string representation of ContentMember."""
        return (
            f"<ContentMember(content_type={self.content_type}, "
            f"content_id={self.content_id}, subject_type={self.subject_type}, "
            f"subject_id={self.subject_id}, role={self.role})>"
        )
