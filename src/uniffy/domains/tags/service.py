from uniffy.domains.tags.filters.handlers import SavedTagFilterHandlersMixin
from uniffy.domains.tags.handlers import TagsHandlers


class TagsServiceImpl(SavedTagFilterHandlersMixin, TagsHandlers):
    pass
