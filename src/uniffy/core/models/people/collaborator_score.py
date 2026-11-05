from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, Column, DateTime, Float, ForeignKey, Index
from sqlmodel import Field, SQLModel


class CollaboratorScore(SQLModel, table=True):
    """How much one member has recently worked with another, as that member experienced it."""

    __tablename__ = "people_collaborator_scores"
    __table_args__ = (
        CheckConstraint("user_id <> peer_id", name="ck_people_collaborator_self"),
        Index("ix_people_collaborator_scores_peer", "peer_id"),
    )

    organization_id: UUID = Field(
        sa_column=Column(ForeignKey("login_organizations.id", ondelete="CASCADE"), primary_key=True)
    )
    user_id: UUID = Field(
        sa_column=Column(ForeignKey("login_users.id", ondelete="CASCADE"), primary_key=True)
    )
    peer_id: UUID = Field(
        sa_column=Column(ForeignKey("login_users.id", ondelete="CASCADE"), primary_key=True)
    )
    # The score as of scored_at; readers decay it to the present.
    score: float = Field(sa_column=Column(Float, nullable=False))
    scored_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    last_interaction_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
