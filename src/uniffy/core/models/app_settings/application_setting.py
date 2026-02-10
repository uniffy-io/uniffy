"""Application-level key-value settings stored in the database.

Used for auto-generated secrets (e.g. VAPID keys) that should not
require manual environment variable configuration.
"""

from datetime import UTC, datetime

from sqlalchemy import Column, DateTime, String, Text
from sqlmodel import Field, SQLModel


class ApplicationSetting(SQLModel, table=True):
    """Key-value setting persisted in the database.

    Values marked ``is_encrypted`` are Fernet-encrypted using
    a key derived from JWT_SECRET_KEY.

    Attributes
    ----------
    key : str
        Setting name (primary key, max 255 chars).
    value : str
        Setting value (plaintext or Fernet ciphertext).
    is_encrypted : bool
        Whether ``value`` is Fernet-encrypted.
    description : str
        Human-readable description of this setting.
    created_at : datetime
        When the setting was created.
    updated_at : datetime
        When the setting was last modified.

    """

    __tablename__ = "application_settings"

    key: str = Field(
        sa_column=Column(String(255), primary_key=True),
        description="Setting name (natural key).",
    )
    value: str = Field(
        sa_column=Column(Text, nullable=False),
        description="Setting value (plaintext or encrypted).",
    )
    is_encrypted: bool = Field(
        default=False,
        description="Whether the value is Fernet-encrypted.",
    )
    description: str = Field(
        default="",
        sa_column=Column(String(500), nullable=False, server_default=""),
        description="Human-readable description.",
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
