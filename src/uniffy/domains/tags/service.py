from uniffy.domains.tags.filters.handlers import SavedTagFilterHandlersMixin
from uniffy.domains.tags.handlers import TagsHandlers


class TagsServiceImpl(SavedTagFilterHandlersMixin, TagsHandlers):
    def __init__(self, search_indexer: SearchIndexer) -> None:
        self.search_indexer = search_indexer


from uniffy.core.search import SearchIndexer
