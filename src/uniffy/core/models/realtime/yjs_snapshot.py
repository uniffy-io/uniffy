"""Compacted Yjs (CRDT) snapshot blob shared by every realtime-enabled content type."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import BigInteger, Column, DateTime, Enum, LargeBinary
from sqlmodel import Field, SQLModel

from uniffy.core.types import ContentType


class RealtimeYjsSnapshot(SQLModel, table=True):
    """Durable CRDT authority and its last projected revision."""

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
    organization_id: UUID | None = None
    generation: str | None = None
    revision: int = Field(default=0, sa_column=Column(BigInteger, nullable=False))
    rendered_revision: int = Field(default=0, sa_column=Column(BigInteger, nullable=False))
    actor_id: UUID | None = None
    seed_owner: str | None = None
    seed_expires_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
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
