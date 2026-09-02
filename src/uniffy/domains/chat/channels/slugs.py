"""Stable channel slug suffix generation."""

from uuid import UUID


def slug_suffix(channel_id: UUID) -> str:
    """Take the uuid tail: uuid7 leading hex is timestamp-derived and repeats within a window."""
    return str(channel_id)[-8:]
