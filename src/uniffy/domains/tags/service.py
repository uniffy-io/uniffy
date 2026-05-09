"""Tags service wrapper for ConnectRPC mounting."""

from uniffy.domains.tags.filters.handlers import SavedTagFilterHandlersMixin
from uniffy.domains.tags.handlers import TagsHandlers


class TagsServiceImpl(SavedTagFilterHandlersMixin, TagsHandlers):
    """Combined tags service implementation.

    Inherits from ``TagsHandlers`` for the core tag namespace plus
    ``SavedTagFilterHandlersMixin`` for the explorer's saved-filter
    CRUD. The mixin order keeps the saved-filter handlers in a separate
    file (Phase 5 surface) without cluttering the core handlers module.
    """

    pass
