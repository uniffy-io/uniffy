"""Optional message parts: file attachments and an inline calendar body."""

from dataclasses import dataclass
from enum import StrEnum

ICALENDAR_SUBTYPE = "calendar"
ICALENDAR_MAINTYPE = "text"


class CalendarMethod(StrEnum):
    """RFC 5546 method for a ``text/calendar`` part.

    The value reaches the recipient as a Content-Type parameter, and mail
    clients decide what to render from it: REQUEST draws accept and decline
    controls, CANCEL withdraws the event.
    """

    REQUEST = "REQUEST"
    CANCEL = "CANCEL"
    REPLY = "REPLY"


@dataclass(frozen=True)
class MailAttachment:
    filename: str
    content: bytes
    maintype: str = ICALENDAR_MAINTYPE
    subtype: str = ICALENDAR_SUBTYPE


@dataclass(frozen=True)
class CalendarPart:
    """A calendar body carried alongside the text and HTML alternatives.

    This is not the same thing as attaching the file. Outlook renders its
    accept and decline controls from an inline ``text/calendar`` alternative,
    while other clients look for an attachment, so an invitation sends both.
    """

    document: bytes
    method: CalendarMethod


__all__ = [
    "ICALENDAR_MAINTYPE",
    "ICALENDAR_SUBTYPE",
    "CalendarMethod",
    "CalendarPart",
    "MailAttachment",
]
