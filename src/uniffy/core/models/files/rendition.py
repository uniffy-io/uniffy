"""Storage cleanup facts survive source replacement and file deletion."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import Column, DateTime
from sqlmodel import Field, SQLModel


class FileRendition(SQLModel, table=True):
    __tablename__ = "files_renditions"

    storage_key: str = Field(primary_key=True, max_length=1000)
    file_id: UUID = Field(index=True)
    expires_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False, index=True)
    )
    upload_id: str | None = Field(default=None, max_length=1000)
