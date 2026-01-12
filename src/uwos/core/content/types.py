"""
Type definitions for content module.

Provides TypeVars and Protocols that define the contract
for content models used with BaseContentOperations.
"""

from datetime import datetime
from typing import Protocol, TypeVar, runtime_checkable
from uuid import UUID

from uwos.core.types import VisibilityScope


@runtime_checkable
class ContentModel(Protocol):
    """
    Protocol defining required attributes for content models.

    Any model used with BaseContentOperations must implement
    these attributes. This ensures consistent permission checking
    and search indexing across all content types.

    Attributes
    ----------
    id : UUID
        Unique identifier for the content.
    organization_id : UUID
        Organization this content belongs to.
    owner_id : UUID
        User who owns this content.
    visibility : VisibilityScope
        Who can access this content.
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
    visibility: VisibilityScope
    is_deleted: bool
    deleted_at: datetime | None
    created_at: datetime
    updated_at: datetime


# TypeVar for generic operations - use this in Generic[TModel]
TModel = TypeVar("TModel")
