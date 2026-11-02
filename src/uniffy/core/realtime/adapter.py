"""Extension point between generic realtime state and domain persistence."""

from collections.abc import Awaitable, Callable, Collection
from enum import Enum, auto
from typing import Protocol
from uuid import UUID

import pycrdt
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.realtime.buffer_keys import BufferedUpdate
from uniffy.core.realtime.state import DocKey
from uniffy.core.types import ContentRole, ContentType


class RealtimeRenderConflict(Exception):
    """Transient domain contention must preserve the persisted CRDT snapshot."""


class DeferredProjection(Enum):
    SOFT_DELETED = auto()


class RealtimeContentAdapter(Protocol):
    """Per-content-type plug-in for the generic realtime stack."""

    content_type: ContentType

    async def stage_render(
        self,
        session: AsyncSession,
        ydoc: pycrdt.Doc,
        content_id: UUID,
        organization_id: UUID,
        *,
        actor_id: UUID | None = None,
    ) -> Callable[[], Awaitable[None]] | DeferredProjection | None: ...

    async def after_projection(
        self, session: AsyncSession, content_id: UUID, organization_id: UUID
    ) -> None: ...

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

    async def authorize_many(
        self,
        session: AsyncSession,
        user_ids: Collection[UUID],
        organization_id: UUID,
        content_id: UUID,
    ) -> dict[UUID, ContentRole | None]: ...

    async def hydrate_ydoc(
        self,
        session: AsyncSession,
        ydoc: pycrdt.Doc,
        content_id: UUID,
        organization_id: UUID,
    ) -> None:
        """Seed Y types from domain storage on cold start (snapshot row empty)."""
        ...


_adapters: dict[ContentType, RealtimeContentAdapter] = {}
type StageEdits = Callable[[AsyncSession, UUID, UUID, Collection[BufferedUpdate]], Awaitable[None]]
_edit_writers: dict[ContentType, StageEdits] = {}


def register_realtime_adapter(
    adapter: RealtimeContentAdapter, *, stage_edits: StageEdits | None = None
) -> None:
    _adapters[adapter.content_type] = adapter
    if stage_edits is None:
        _edit_writers.pop(adapter.content_type, None)
    else:
        _edit_writers[adapter.content_type] = stage_edits


async def stage_buffered_edits(
    session: AsyncSession,
    key: DocKey,
    organization_id: UUID,
    updates: Collection[BufferedUpdate],
) -> None:
    """Commit contributor facts with the checkpoint before its accepted records are trimmed."""
    writer = _edit_writers.get(key[0])
    if writer is not None and updates:
        await writer(session, key[1], organization_id, updates)


def get_realtime_adapter(content_type: ContentType) -> RealtimeContentAdapter:
    if content_type not in _adapters:
        raise LookupError(f"No realtime adapter registered for {content_type}")
    return _adapters[content_type]
