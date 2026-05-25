"""Global email-suppression list.

A bounced or complained-about address is unreachable regardless of which
organization sent the message, so the suppression list is single-table
and scoped only by ``email``. ``MailSender`` consults it before every
dispatch.
"""

from datetime import UTC, datetime
from enum import Enum
from uuid import UUID

from sqlalchemy import Column, DateTime, String
from sqlalchemy import Enum as SAEnum
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class EmailSuppressionReason(str, Enum):
    """Why an address landed on the suppression list."""

    BOUNCED = "BOUNCED"
    COMPLAINED = "COMPLAINED"
    MANUAL = "MANUAL"


class EmailSuppression(SQLModel, table=True):
    """One row per suppressed address (lowercased)."""

    __tablename__ = "mail_suppressions"

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    email: str = Field(
        sa_column=Column(String(320), nullable=False, unique=True, index=True),
    )
    reason: EmailSuppressionReason = Field(
        sa_column=Column(
            SAEnum(
                EmailSuppressionReason,
                name="emailsuppressionreason",
                values_callable=lambda x: [e.value for e in x],
                create_type=False,
            ),
            nullable=False,
        ),
    )
    source: str = Field(
        sa_column=Column(String(64), nullable=False),
        description="Origin tag, e.g. 'admin', 'smtp_bounce'.",
    )
    provider_event_id: str | None = Field(
        default=None,
        sa_column=Column(String(255), nullable=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
