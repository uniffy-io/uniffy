"""Importing the service pulls in every handler and converter, so a runtime API slip fails here."""

import inspect

from uniffy_proto.projects.v1.projects_connect import ProjectsService

from uniffy.domains.projects.service import ProjectsServiceImpl
from uniffy.domains.projects.time.approvals import TimesheetHandlers
from uniffy.domains.projects.time.handlers import TimeHandlers

TIME_RPCS = (
    "create_worklog",
    "update_worklog",
    "delete_worklog",
    "list_task_worklogs",
    "list_user_worklogs",
    "aggregate_worklogs",
    "get_time_policy",
    "update_time_policy",
    "start_timer",
    "pause_timer",
    "resume_timer",
    "stop_timer",
    "get_active_timer",
    "get_timesheet",
    "submit_timesheet",
    "recall_timesheet",
    "list_review_timesheets",
    "approve_timesheet",
    "reject_timesheet",
    "grant_grace",
    "close_period",
    "reopen_period",
    "list_periods",
    "create_internal_time_project",
    "get_sprint_capacity",
)


def test_projects_service_exposes_the_time_rpcs() -> None:
    assert issubclass(ProjectsServiceImpl, TimeHandlers)
    assert issubclass(ProjectsServiceImpl, TimesheetHandlers)
    for name in TIME_RPCS:
        assert callable(getattr(ProjectsServiceImpl, name)), name


def test_projects_service_implements_every_rpc_of_the_generated_protocol() -> None:
    """The generated service is a Protocol: a missing method breaks every RPC, not one."""
    rpcs = [
        name
        for name, member in inspect.getmembers(ProjectsService)
        if not name.startswith("_") and inspect.isfunction(member)
    ]
    assert rpcs, "no RPC methods found on the generated protocol"
    missing = [name for name in rpcs if not callable(getattr(ProjectsServiceImpl, name, None))]
    assert missing == [], f"ProjectsServiceImpl lacks: {missing}"
