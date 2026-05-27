"""Application-level key-value settings stored in the database."""

from datetime import UTC, datetime

from sqlalchemy import Column, DateTime, String, Text
from sqlmodel import Field, SQLModel


class ApplicationSetting(SQLModel, table=True):
    """Key-value setting persisted in the database; encrypted values use Fernet."""

    __tablename__ = "application_settings"

    key: str = Field(
        sa_column=Column(String(255), primary_key=True),
    )
    value: str = Field(
        sa_column=Column(Text, nullable=False),
    )
    is_encrypted: bool = Field(default=False)
    description: str = Field(
        default="",
        sa_column=Column(String(500), nullable=False, server_default=""),
    )
    created_at: datetime = Field(
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            default=lambda: datetime.now(UTC),
        ),
    )
    updated_at: datetime = Field(
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            default=lambda: datetime.now(UTC),
            onupdate=lambda: datetime.now(UTC),
        ),
    )
