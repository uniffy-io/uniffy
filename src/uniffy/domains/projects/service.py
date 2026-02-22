"""Projects service implementation."""

from uniffy.domains.projects.handlers import ProjectsHandlers, SprintHandlers


class ProjectsServiceImpl(ProjectsHandlers, SprintHandlers):
    """Combined projects service implementation."""

    pass
