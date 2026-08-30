"""Projects service implementation."""

from uniffy.core.storage import ObjectStorage
from uniffy.domains.projects.handlers import (
    ProjectsHandlers,
    SprintHandlers,
    WatcherHandlers,
)


class ProjectsServiceImpl(ProjectsHandlers, SprintHandlers, WatcherHandlers):
    def __init__(self, storage: ObjectStorage, search_indexer: SearchIndexer) -> None:
        self.storage = storage
        self.search_indexer = search_indexer


from uniffy.core.search import SearchIndexer
