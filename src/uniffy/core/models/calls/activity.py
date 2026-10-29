from uuid import UUID

from sqlalchemy import CheckConstraint, Column, ForeignKey, Integer
from sqlmodel import Field, SQLModel


class CallActivity(SQLModel, table=True):
    """Thirty one-second observations packed per device attendance, without audio."""

    __tablename__ = "calls_activity"
    __table_args__ = (
        CheckConstraint("offset_seconds >= 0 AND offset_seconds % 30 = 0"),
        CheckConstraint("observed_mask BETWEEN 0 AND 1073741823"),
        CheckConstraint("speaking_mask >= 0 AND (speaking_mask & observed_mask) = speaking_mask"),
    )

    participant_id: UUID = Field(
        sa_column=Column(ForeignKey("calls_participants.id", ondelete="CASCADE"), primary_key=True)
    )
    offset_seconds: int = Field(sa_column=Column(Integer, primary_key=True))
    observed_mask: int = Field(default=0)
    speaking_mask: int = Field(default=0)
