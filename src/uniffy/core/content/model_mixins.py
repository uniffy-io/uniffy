"""Reusable SQLModel field definitions shared by content models."""

from datetime import datetime

from sqlalchemy import Column, DateTime
from sqlmodel import Field


def is_deleted_field(default: bool = False) -> bool:
    return Field(default=default, nullable=False)


def deleted_at_field() -> datetime | None:
    return Field(default=None, sa_column=Column(DateTime(timezone=True)))
