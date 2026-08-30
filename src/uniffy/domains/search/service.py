from uniffy.core.search.workspace import WorkspaceSearch
from uniffy.domains.search.handlers import SearchHandlers


class SearchServiceImpl(SearchHandlers):
    def __init__(self, search: WorkspaceSearch) -> None:
        self.search_engine = search
