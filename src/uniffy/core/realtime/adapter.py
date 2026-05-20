"""``RealtimeContentAdapter`` protocol + registry.

Domains self-register their adapter at module import time; the WS
route, ``YDocManager``, and snapshot pipeline dispatch through this
registry so they never reference any concrete domain.
"""

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
        """Return the effective role on this content item, or None for no access."""
        ...

    async def hydrate_ydoc(
        self,
        session: AsyncSession,
        ydoc: pycrdt.Doc,
        content_id: UUID,
        organization_id: UUID,
    ) -> None:
        """Seed Y types from current domain storage on cold start.

        Called once by ``YDocManager`` when the snapshot row is empty.
        Subsequent loads come from the snapshot blob.
        """
        ...

    async def render_and_persist(
        self,
        session: AsyncSession,
        ydoc: pycrdt.Doc,
        content_id: UUID,
        organization_id: UUID,
    ) -> None:
        """Persist the rendered domain shape on each debounced flush.

        Must be idempotent: it can be invoked repeatedly with the
        same ``ydoc`` state.
        """
        ...


_adapters: dict[ContentType, RealtimeContentAdapter] = {}


def register_realtime_adapter(adapter: RealtimeContentAdapter) -> None:
    """Register a ``RealtimeContentAdapter`` for its declared content type."""
    _adapters[adapter.content_type] = adapter


def get_realtime_adapter(content_type: ContentType) -> RealtimeContentAdapter:
    """Return the adapter for a content type or raise ``LookupError``."""
    if content_type not in _adapters:
        raise LookupError(f"No realtime adapter registered for {content_type}")
    return _adapters[content_type]
