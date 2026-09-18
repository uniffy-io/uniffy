"""Projects service implementation."""

from uniffy.core.search import SearchIndexer
from uniffy.core.storage import ObjectStorage
from uniffy.domains.projects.handlers import (
    ProjectsHandlers,
    SprintHandlers,
    WatcherHandlers,
)
from uniffy.domains.projects.views.handlers import ViewHandlers


class ProjectsServiceImpl(ProjectsHandlers, SprintHandlers, WatcherHandlers, ViewHandlers):
    def __init__(self, storage: ObjectStorage, search_indexer: SearchIndexer) -> None:
        self.storage = storage
        self.search_indexer = search_indexer
