"""Shared enum re-exports for the models layer.

All enum definitions live in :mod:`uniffy.core.types` so that module
has no dependency on the models package (avoids circular imports). This
module exists purely as a convenience re-export for code that expects
``from uniffy.core.models.shared import X``.
"""

from uniffy.core.types import (
    AccessMode,
    AttendeeRole,
    AttendeeStatus,
    BookingStatus,
    CalendarType,
    ContentMemberAction,
    ContentRole,
    ContentType,
    DayOfWeek,
    DomainType,
    EventStatus,
    EventTransparency,
    EventVisibility,
    NodeType,
    NotificationType,
    RecurrencePattern,
    ResourceType,
    RoomStatus,
    RoomType,
    SubjectType,
)

__all__ = [
    "AccessMode",
    "AttendeeRole",
    "AttendeeStatus",
    "BookingStatus",
    "CalendarType",
    "ContentMemberAction",
    "ContentRole",
    "ContentType",
    "DayOfWeek",
    "DomainType",
    "EventStatus",
    "EventTransparency",
    "EventVisibility",
    "NodeType",
    "NotificationType",
    "RecurrencePattern",
    "ResourceType",
    "RoomStatus",
    "RoomType",
    "SubjectType",
]
