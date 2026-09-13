"""Identity-only cancellations survive deletion without retaining meeting details."""

from datetime import UTC, date
from typing import Self

from icalendar import Calendar, Event, vCalAddress
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

from uniffy.domains.scheduling.calendar.ical.emit import ICAL_VERSION, PRODUCT_ID


class EventWithdrawal(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    uid: str = Field(min_length=1, max_length=500)
    organizer_email: str = Field(min_length=1, max_length=320)
    sequence: int = Field(ge=1)
    timestamp: AwareDatetime
    occurrence_on: date | None = None
    occurrence_at: AwareDatetime | None = None
    this_and_following: bool = False

    @model_validator(mode="after")
    def validate_occurrence(self) -> Self:
        if self.occurrence_on is not None and self.occurrence_at is not None:
            raise ValueError("Withdrawal has more than one recurrence identity")
        if self.this_and_following and self.occurrence_on is None and self.occurrence_at is None:
            raise ValueError("Range withdrawal requires a recurrence identity")
        return self


def withdrawal_document(withdrawal: EventWithdrawal, recipient_email: str) -> bytes:
    calendar = Calendar()
    calendar.add("prodid", PRODUCT_ID)
    calendar.add("version", ICAL_VERSION)
    calendar.add("method", "CANCEL")
    event = Event()
    event.add("uid", withdrawal.uid)
    event.add("dtstamp", withdrawal.timestamp.astimezone(UTC))
    event.add("sequence", withdrawal.sequence)
    event.add("organizer", vCalAddress(f"MAILTO:{withdrawal.organizer_email}"))
    event.add("attendee", vCalAddress(f"MAILTO:{recipient_email}"))
    event.add("status", "CANCELLED")
    occurrence = (
        withdrawal.occurrence_at.astimezone(UTC)
        if withdrawal.occurrence_at is not None
        else withdrawal.occurrence_on
    )
    if occurrence is not None:
        event.add(
            "recurrence-id",
            occurrence,
            parameters={"RANGE": "THISANDFUTURE"} if withdrawal.this_and_following else None,
        )
    calendar.add_component(event)
    return calendar.to_ical()
