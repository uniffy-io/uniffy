from collections.abc import Awaitable, Collection
from enum import StrEnum
from typing import Any, Protocol
from uuid import UUID

from sqlalchemy import false, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.types import ContentType


class ReferenceRowState(StrEnum):
    LIVE = "LIVE"
    DELETED = "DELETED"
    MISSING = "MISSING"


class ReferenceStateLoader(Protocol):
    def __call__(
        self,
        session: AsyncSession,
        organization_id: UUID,
        content_ids: Collection[UUID],
    ) -> Awaitable[dict[UUID, ReferenceRowState]]: ...


_REFERENCE_STATE_LOADERS: dict[ContentType, ReferenceStateLoader] = {}


def register_reference_state_loader(
    content_type: ContentType,
    loader: ReferenceStateLoader,
) -> None:
    _REFERENCE_STATE_LOADERS[content_type] = loader


def model_reference_state_loader(
    model: Any,
    *,
    deleted_attribute: str | None = "is_deleted",
    extra_conditions: tuple[Any, ...] = (),
) -> ReferenceStateLoader:
    async def load(
        session: AsyncSession,
        organization_id: UUID,
        content_ids: Collection[UUID],
    ) -> dict[UUID, ReferenceRowState]:
        if not content_ids:
            return {}

        deleted_column = (
            getattr(model, deleted_attribute) if deleted_attribute is not None else false()
        )
        rows = (
            await session.execute(
                select(model.id, deleted_column).where(
                    model.organization_id == organization_id,
                    model.id.in_(content_ids),
                    *extra_conditions,
                )
            )
        ).all()
        return {
            row_id: ReferenceRowState.DELETED if is_deleted else ReferenceRowState.LIVE
            for row_id, is_deleted in rows
        }

    return load


async def resolve_reference_states(
    session: AsyncSession,
    organization_id: UUID,
    references: dict[ContentType, set[UUID]],
) -> dict[tuple[ContentType, UUID], ReferenceRowState]:
    states: dict[tuple[ContentType, UUID], ReferenceRowState] = {}
    for content_type, content_ids in references.items():
        loader = _REFERENCE_STATE_LOADERS.get(content_type)
        if loader is None:
            continue
        loaded = await loader(session, organization_id, content_ids)
        for content_id in content_ids:
            states[(content_type, content_id)] = loaded.get(
                content_id,
                ReferenceRowState.MISSING,
            )
    return states
