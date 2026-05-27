"""Type contract content models must satisfy to use :class:`BaseContentOperations`."""

from datetime import datetime
from typing import Protocol, TypeVar, runtime_checkable
from uuid import UUID

from uniffy.core.types import AccessMode, ContentRole


@runtime_checkable
class ContentModel(Protocol):
    """Attributes every content model must expose."""

    id: UUID
    organization_id: UUID
    owner_id: UUID
    access_mode: AccessMode
    baseline_role: ContentRole | None
    is_deleted: bool
    deleted_at: datetime | None
    created_at: datetime
    updated_at: datetime


TModel = TypeVar("TModel")
