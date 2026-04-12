"""
Type definitions for the content module.

Provides TypeVars and Protocols that describe the contract content
models must satisfy to be used with :class:`BaseContentOperations`.
"""

from datetime import datetime
from typing import Protocol, TypeVar, runtime_checkable
from uuid import UUID

from uniffy.core.types import AccessMode, ContentRole


@runtime_checkable
class ContentModel(Protocol):
    """
    Protocol describing the attributes every content model must expose.

    Attributes
    ----------
    id : UUID
        Unique identifier for the content.
    organization_id : UUID
        Organization this content belongs to.
    owner_id : UUID
        User who owns this content.
    access_mode : AccessMode
        How access to the content is governed.
    baseline_role : ContentRole | None
        Default role granted by the access mode.
    is_deleted : bool
        Whether the content is soft-deleted.
    deleted_at : datetime | None
        When the content was deleted.
    created_at : datetime
        When the content was created.
    updated_at : datetime
        When the content was last updated.

    """

    id: UUID
    organization_id: UUID
    owner_id: UUID
    access_mode: AccessMode
    baseline_role: ContentRole | None
    is_deleted: bool
    deleted_at: datetime | None
    created_at: datetime
    updated_at: datetime


# TypeVar for generic operations - use this in Generic[TModel]
TModel = TypeVar("TModel")
