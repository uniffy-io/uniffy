"""Compacted Yjs (CRDT) snapshot blob shared by every realtime-enabled content type."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, Enum, LargeBinary
from sqlmodel import Field, SQLModel

from uniffy.core.types import ContentType


class RealtimeYjsSnapshot(SQLModel, table=True):
    """One compacted Yjs document blob per realtime-collaborated content row.

    The composite primary key ``(content_type, content_id)`` keeps the
    table domain-agnostic; every content type that adopts realtime
    editing shares one storage shape and one snapshot pipeline. Rows are
    overwritten on each debounced flush (no per-edit history).
    """

    __tablename__ = "realtime_yjs_snapshots"

    content_type: ContentType = Field(
        sa_column=Column(
            Enum(
                ContentType,
                name="contenttype",
                values_callable=lambda x: [e.value for e in x],
                create_type=False,
            ),
            primary_key=True,
            nullable=False,
        ),
    )
    content_id: UUID = Field(primary_key=True, nullable=False)
    state_vector: bytes = Field(sa_column=Column(LargeBinary, nullable=False))
    updates: bytes = Field(sa_column=Column(LargeBinary, nullable=False))
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            onupdate=lambda: datetime.now(UTC),
        ),
    )
