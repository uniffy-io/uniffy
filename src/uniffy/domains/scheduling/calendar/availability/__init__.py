"""Calendar availability and meeting-time scheduling."""

from uniffy.domains.scheduling.calendar.availability.busy import (
    MAX_FREE_BUSY_USERS,
    MAX_WINDOW_DAYS,
    BusyInterval,
    get_busy_intervals,
    occupancy,
)
from uniffy.domains.scheduling.calendar.availability.operations import (
    Suggestion,
    suggest_meeting_times,
    working_windows,
)
from uniffy.domains.scheduling.intervals import (
    Interval,
    intersect_intervals,
    merge_intervals,
    subtract_intervals,
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
