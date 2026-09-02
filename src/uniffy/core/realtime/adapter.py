"""Extension point between generic realtime state and domain persistence."""

from typing import Protocol
from uuid import UUID

import pycrdt
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.types import ContentRole, ContentType


class RealtimeContentAdapter(Protocol):
    """Per-content-type plug-in for the generic realtime stack."""

    content_type: ContentType

    async def authorize(
        self,
        session: AsyncSession,
        user_id: UUID,
        organization_id: UUID,
        content_id: UUID,
    ) -> ContentRole | None:
        """Effective role on this content item, or ``None`` for no access."""
        ...

    async def hydrate_ydoc(
        self,
        session: AsyncSession,
        ydoc: pycrdt.Doc,
        content_id: UUID,
        organization_id: UUID,
    ) -> None:
        """Seed Y types from domain storage on cold start (snapshot row empty)."""
        ...

    async def render_and_persist(
        self,
        session: AsyncSession,
        ydoc: pycrdt.Doc,
        content_id: UUID,
        organization_id: UUID,
    ) -> bool:
        """Persist the rendered shape, or return false when the target no longer exists."""
        ...

    def apply_external_content(self, ydoc: pycrdt.Doc, content: str) -> bool:
        """Graft a domain column write into the live doc as a CRDT edit.

        Returns ``False`` when the doc already matches (no update to fan out).
        Caller holds the session lock.
        """
        ...


_adapters: dict[ContentType, RealtimeContentAdapter] = {}


def register_realtime_adapter(adapter: RealtimeContentAdapter) -> None:
    _adapters[adapter.content_type] = adapter


def get_realtime_adapter(content_type: ContentType) -> RealtimeContentAdapter:
    if content_type not in _adapters:
        raise LookupError(f"No realtime adapter registered for {content_type}")
    return _adapters[content_type]
