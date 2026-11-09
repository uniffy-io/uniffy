"""Column helpers shared by the provider sync models."""

from datetime import UTC, datetime
from enum import StrEnum

from sqlalchemy import Enum as SAEnum


def text_enum(kind: type[StrEnum], length: int) -> SAEnum:
    """Stored as text so a new member needs no migration, and read back as the enum."""
    return SAEnum(
        kind,
        native_enum=False,
        create_constraint=False,
        length=length,
        values_callable=lambda members: [member.value for member in members],
    )


def utc_now() -> datetime:
    return datetime.now(UTC)
