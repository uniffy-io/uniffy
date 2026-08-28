"""Calendar availability and meeting-time scheduling."""

from uniffy.domains.calendar.scheduling.availability import (
    MAX_FREE_BUSY_USERS,
    MAX_WINDOW_DAYS,
    BusyInterval,
    Interval,
    get_busy_intervals,
    merge_intervals,
    occupancy,
)
from uniffy.domains.calendar.scheduling.operations import (
    Suggestion,
    intersect_intervals,
    subtract_intervals,
    suggest_meeting_times,
    working_windows,
)

__all__ = [
    "BusyInterval",
    "Interval",
    "MAX_FREE_BUSY_USERS",
    "MAX_WINDOW_DAYS",
    "Suggestion",
    "get_busy_intervals",
    "intersect_intervals",
    "merge_intervals",
    "occupancy",
    "subtract_intervals",
    "suggest_meeting_times",
    "working_windows",
]
