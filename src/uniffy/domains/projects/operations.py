"""Stable public operations façade for the projects domain."""

from uniffy.domains.projects.fields.operations import ProjectFieldOperations
from uniffy.domains.projects.projects import ProjectOperations
from uniffy.domains.projects.sprints.operations import SprintOperations
from uniffy.domains.projects.tasks.operations import TaskOperations
from uniffy.domains.projects.tasks.reader import TaskReader
from uniffy.domains.projects.views.operations import ProjectViewOperations
from uniffy.domains.projects.watchers.operations import WatcherOperations

__all__ = [
    "ProjectFieldOperations",
    "ProjectOperations",
    "ProjectViewOperations",
    "SprintOperations",
    "TaskOperations",
    "TaskReader",
    "WatcherOperations",
]
