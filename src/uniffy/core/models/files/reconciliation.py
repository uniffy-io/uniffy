"""Inline attachment cleanup requested by committed content writes."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime
from sqlmodel import Field, SQLModel


class InlineAttachmentReconciliation(SQLModel, table=True):
    __tablename__ = "files_inline_reconciliations"

    content_type: str = Field(primary_key=True)
    content_id: UUID = Field(primary_key=True)
    organization_id: UUID = Field(foreign_key="login_organizations.id", ondelete="CASCADE")
    attempted_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False, index=True),
    )
