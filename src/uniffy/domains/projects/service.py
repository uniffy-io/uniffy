"""Projects service implementation."""

from uniffy.core.search import SearchIndexer
from uniffy.core.storage import ObjectStorage
from uniffy.domains.projects.export.handlers import ExportHandlers
from uniffy.domains.projects.fields.handlers import FieldHandlers
from uniffy.domains.projects.handlers import ProjectsHandlers
from uniffy.domains.projects.sprints.handlers import SprintHandlers
from uniffy.domains.projects.tasks.handlers import TaskHandlers
from uniffy.domains.projects.views.handlers import ViewHandlers
from uniffy.domains.projects.watchers.handlers import WatcherHandlers


class ProjectsServiceImpl(
    ProjectsHandlers,
    TaskHandlers,
    FieldHandlers,
    SprintHandlers,
    WatcherHandlers,
    ViewHandlers,
    ExportHandlers,
):
    def __init__(self, storage: ObjectStorage, search_indexer: SearchIndexer) -> None:
        self.storage = storage
        self.search_indexer = search_indexer
