"""Projects service implementation."""

from uniffy.domains.projects.handlers import (
    ProjectsHandlers,
    SprintHandlers,
    WatcherHandlers,
)


class ProjectsServiceImpl(ProjectsHandlers, SprintHandlers, WatcherHandlers):
    """Combined projects service implementation."""

    pass
