"""Extension point between generic realtime state and domain persistence."""

from datetime import datetime
from typing import Protocol
from uuid import UUID

import pycrdt
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.realtime.state import DocKey
from uniffy.core.types import ContentRole, ContentType


class RealtimeRenderConflict(Exception):
    """Transient domain contention must preserve the persisted CRDT snapshot."""


class RealtimeRenderSuperseded(Exception):
    """A plain write changed the row after this snapshot was encoded; the column is newer."""


def check_not_superseded(
    updated_at: datetime | None,
    supersede_after: datetime | None,
    *,
    stored: str | None,
    rendered: str,
    label: str,
) -> None:
    """Raise when a plain write landed after the encode and left different text behind.

    Equal text means the live doc already grafted that write, so rendering is a no-op
    and may proceed.
    """
    if supersede_after is None or updated_at is None:
        return
    if updated_at > supersede_after and (stored or "") != rendered:
        raise RealtimeRenderSuperseded(f"{label} changed after the snapshot was encoded")


class RealtimeContentAdapter(Protocol):
    """Per-content-type plug-in for the generic realtime stack."""

    content_type: ContentType

    async def policy_key(
        self,
        session: AsyncSession,
        content_id: UUID,
        organization_id: UUID,
    ) -> DocKey | None: ...

    async def authorize(
        self,
        session: AsyncSession,
        user_id: UUID,
        organization_id: UUID,
        content_id: UUID,
        *,
        checker: PermissionChecker | None = None,
    ) -> ContentRole | None:
        """Effective role on this content item, or ``None`` for no access.

        A fanout passes one ``checker`` so authorization facts load once per user.
        """
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
        *,
        actor_id: UUID | None = None,
        supersede_after: datetime | None = None,
    ) -> bool:
        """Persist the rendered shape, or return false when the target no longer exists.

        ``actor_id`` is the last live editor when known; side effects attribute to it.
        ``supersede_after`` is the snapshot's encode time when no snapshot row existed before
        this write; a domain row a plain write updated later with different text must raise
        :class:`RealtimeRenderSuperseded` (see :func:`check_not_superseded`) instead of
        being overwritten.
        """
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
