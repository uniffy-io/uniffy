"""ContentMemberEvent model: append-only audit log for access-control changes.

Every mutation that touches a content item's access policy or its member
list writes a row here. Rows are immutable -- no updates, no deletes.

State fields use a "previous/new" pair per kind of state (role,
access mode, baseline role, owner id). Each action populates only the
pairs that are meaningful for that action; the rest stay NULL:

    MEMBER_ADDED             previous_role=NULL,       new_role=<role>
    MEMBER_ROLE_CHANGED      previous_role=<old>,      new_role=<new>
    MEMBER_REMOVED           previous_role=<old>,      new_role=NULL
    ACCESS_MODE_CHANGED      previous_access_mode,     new_access_mode
    BASELINE_ROLE_CHANGED    previous_baseline_role,   new_baseline_role
    OWNERSHIP_TRANSFERRED    previous_owner_id,        new_owner_id
                              (and a MEMBER_ADDED event for the former owner
                              being demoted to ADMIN is also written)

The ``subject_type``/``subject_id`` fields identify the subject of member
events (the user or group being added/changed/removed). They are NULL for
access-mode / baseline-role / ownership-transfer events. For ownership
transfer events, ``subject_id`` carries the new owner's user id for
convenience.

Cross-table references (``subject_id``, ``previous_owner_id``,
``new_owner_id``) are polymorphic: they can reference users or groups, and
those rows may be deleted over time. The audit log does not enforce
foreign keys so history survives subject deletion.
"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, Index
from sqlmodel import Field, SQLModel

from uniffy.core.models.login.organization_member import OrganizationRole
from uniffy.core.models.shared import (
    AccessMode,
    ContentMemberAction,
    ContentRole,
    ContentType,
    SubjectType,
)
from uniffy.core.types import generate_id


class ContentMemberEvent(SQLModel, table=True):
    """
    Append-only audit log entry for a content member / access policy change.

    Attributes
    ----------
    id : UUID
        Unique identifier (UUIDv7, sorts chronologically).
    organization_id : UUID
        Organization scope.
    content_type : ContentType
        Type of content the event describes.
    content_id : UUID
        ID of the content item.
    action : ContentMemberAction
        What kind of change this event records.
    subject_type : SubjectType | None
        For member events: USER or GROUP. NULL otherwise.
    subject_id : UUID | None
        For member events: the user or group being added/changed/removed.
        For OWNERSHIP_TRANSFERRED: the new owner's user id.
        NULL otherwise.
    previous_role : ContentRole | None
        Previous role for MEMBER_ROLE_CHANGED and MEMBER_REMOVED.
    new_role : ContentRole | None
        New role for MEMBER_ADDED and MEMBER_ROLE_CHANGED.
    previous_access_mode : AccessMode | None
        Previous access mode for ACCESS_MODE_CHANGED.
    new_access_mode : AccessMode | None
        New access mode for ACCESS_MODE_CHANGED.
    previous_baseline_role : ContentRole | None
        Previous baseline role for BASELINE_ROLE_CHANGED.
    new_baseline_role : ContentRole | None
        New baseline role for BASELINE_ROLE_CHANGED.
    previous_owner_id : UUID | None
        Previous owner for OWNERSHIP_TRANSFERRED. Polymorphic -- no FK.
    new_owner_id : UUID | None
        New owner for OWNERSHIP_TRANSFERRED. Polymorphic -- no FK.
    actor_user_id : UUID
        User who performed the action (may no longer exist).
    actor_org_role : OrganizationRole
        Snapshot of the actor's organization role at the time of the
        action. Preserved even if the actor's role changes later.
    note : str
        Optional free-text note providing context for the change.
        Defaults to an empty string. Max length 500.
    occurred_at : datetime
        When the event happened.

    """

    __tablename__ = "permissions_content_member_events"
    __table_args__ = (
        Index(
            "ix_cme_content",
            "content_type",
            "content_id",
            "occurred_at",
        ),
        Index("ix_cme_actor", "actor_user_id", "occurred_at"),
        Index("ix_cme_org", "organization_id", "occurred_at"),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False)
    content_type: ContentType = Field(nullable=False)
    content_id: UUID = Field(nullable=False)
    action: ContentMemberAction = Field(nullable=False)

    # Subject identification (member-oriented events)
    subject_type: SubjectType | None = Field(default=None)
    subject_id: UUID | None = Field(default=None)

    # State transitions
    previous_role: ContentRole | None = Field(default=None)
    new_role: ContentRole | None = Field(default=None)
    previous_access_mode: AccessMode | None = Field(default=None)
    new_access_mode: AccessMode | None = Field(default=None)
    previous_baseline_role: ContentRole | None = Field(default=None)
    new_baseline_role: ContentRole | None = Field(default=None)
    previous_owner_id: UUID | None = Field(default=None)
    new_owner_id: UUID | None = Field(default=None)

    # Actor (no FK -- audit log survives user deletion)
    actor_user_id: UUID = Field(nullable=False)
    actor_org_role: OrganizationRole = Field(nullable=False)

    # Free-text context
    note: str = Field(default="", max_length=500, nullable=False)

    occurred_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )

    def __repr__(self) -> str:
        """Return string representation of ContentMemberEvent."""
        return (
            f"<ContentMemberEvent(action={self.action}, "
            f"content_type={self.content_type}, content_id={self.content_id}, "
            f"actor={self.actor_user_id}, occurred_at={self.occurred_at})>"
        )
