"""Change and cancellation mail: what warrants telling everyone, and what the
message says once several edits have collapsed into one."""

from datetime import UTC, date, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.calendar.mail_delivery import CalendarMailKind
from uniffy.core.types import AccessMode, generate_id
from uniffy.domains.scheduling.calendar.mail.staging import (
    CHANGE_LABELS,
    MAIL_TRIGGERING_ACTIONS,
    describe_changes,
    stage_cancellation_mail,
    stage_change_mail,
)

ACTOR = generate_id()


def _event() -> CalendarEvent:
    event = CalendarEvent(
        organization_id=generate_id(),
        organizer_id=ACTOR,
        calendar_id=generate_id(),
        title="Standup",
        start_time=datetime(2026, 3, 18, 9, tzinfo=UTC),
        end_time=datetime(2026, 3, 18, 9, 30, tzinfo=UTC),
        access_mode=AccessMode.OWNER_ONLY,
    )
    event.created_at = event.updated_at = datetime(2026, 1, 1, tzinfo=UTC)
    return event


def _session(attendee_ids: list) -> MagicMock:
    session = MagicMock()
    scalars = MagicMock()
    scalars.all = MagicMock(return_value=attendee_ids)
    session.execute = AsyncMock(return_value=MagicMock(scalars=MagicMock(return_value=scalars)))
    return session





class TestWhatWarrantsAMessage:
    @pytest.mark.parametrize(
        "action",
        ["schedule_changed", "location_changed", "meeting_changed", "recurrence_changed"],
    )
    def test_moving_when_where_or_how_to_join_does(self, action: str) -> None:
        assert action in MAIL_TRIGGERING_ACTIONS

    @pytest.mark.parametrize(
        "action",
        [
            "title_changed",
            "description_changed",
            "category_changed",
            "reminders_changed",
            "calendar_changed",
            "field_updated",
        ],
    )
    def test_everything_else_does_not(self, action: str) -> None:
        """A retitled meeting or an edited agenda must not mail the whole room."""
        assert action not in MAIL_TRIGGERING_ACTIONS


class TestDescribingChanges:
    def test_nothing_changed_says_nothing(self) -> None:
        assert describe_changes(set()) == []

    def test_each_aspect_reads_as_a_sentence(self) -> None:
        assert describe_changes({"schedule_changed"}) == ["The time has changed"]

    def test_several_aspects_come_back_in_a_stable_order(self) -> None:
        first = describe_changes({"meeting_changed", "schedule_changed", "location_changed"})
        second = describe_changes({"location_changed", "schedule_changed", "meeting_changed"})

        assert first == second
        assert len(first) == 3

    def test_it_describes_aspects_rather_than_a_diff(self) -> None:
        """Edits coalesce into one message, so "the time has changed" stays true
        however many times it moved; naming every intermediate value would not.
        """
        moved_twice = describe_changes({"schedule_changed"})

        assert moved_twice == ["The time has changed"]

    def test_untracked_actions_are_ignored(self) -> None:
        assert describe_changes({"title_changed", "schedule_changed"}) == [
            "The time has changed"
        ]

    def test_every_triggering_action_has_a_label(self) -> None:
        assert set(CHANGE_LABELS) == set(MAIL_TRIGGERING_ACTIONS)


class TestStaging:
    async def test_change_mail_goes_to_everyone_already_invited(self) -> None:
        event = _event()
        attendees = [generate_id(), generate_id()]
        session = _session([*attendees, ACTOR])

        staged = await stage_change_mail(session, event, actor_id=ACTOR)

        assert staged == 2

    async def test_the_editor_is_not_told_about_their_own_edit(self) -> None:
        event = _event()
        session = _session([ACTOR])

        assert await stage_change_mail(session, event, actor_id=ACTOR) == 0

    async def test_somebody_invited_by_the_same_edit_gets_only_the_invitation(self) -> None:
        """They receive the new time in the invitation; a change notice as well
        would be a second message saying the same thing."""
        event = _event()
        invited_now = generate_id()
        existing = generate_id()
        session = _session([existing, invited_now])

        staged = await stage_change_mail(
            session, event, actor_id=ACTOR, exclude={invited_now}
        )

        assert staged == 1

    async def test_cancellation_goes_to_every_attendee(self) -> None:
        event = _event()
        session = _session([generate_id(), generate_id(), ACTOR])

        assert await stage_cancellation_mail(session, event, actor_id=ACTOR) == 2

    async def test_an_event_nobody_else_is_on_stages_nothing(self) -> None:
        event = _event()
        session = _session([])

        assert await stage_cancellation_mail(session, event, actor_id=ACTOR) == 0
        assert await stage_change_mail(session, event, actor_id=ACTOR) == 0

    async def test_cancelling_one_occurrence_records_which_one(self) -> None:
        event = _event()
        session = _session([generate_id()])

        with patch(
            "uniffy.domains.scheduling.calendar.mail.staging.stage_event_mail",
            AsyncMock(return_value=1),
        ) as staged:
            await stage_cancellation_mail(
                session, event, actor_id=ACTOR, occurrence_date=date(2026, 3, 25)
            )

        assert staged.await_args.kwargs["occurrence_date"] == date(2026, 3, 25)
        assert staged.await_args.kwargs["kind"] is CalendarMailKind.CANCELLATION

    async def test_cancelling_a_series_records_no_occurrence(self) -> None:
        event = _event()
        session = _session([generate_id()])

        with patch(
            "uniffy.domains.scheduling.calendar.mail.staging.stage_event_mail",
            AsyncMock(return_value=1),
        ) as staged:
            await stage_cancellation_mail(session, event, actor_id=ACTOR)

        assert staged.await_args.kwargs["occurrence_date"] is None

    async def test_change_mail_names_no_occurrence(self) -> None:
        """A series-wide change is about the series, not one date."""
        event = _event()
        session = _session([generate_id()])

        with patch(
            "uniffy.domains.scheduling.calendar.mail.staging.stage_event_mail",
            AsyncMock(return_value=1),
        ) as staged:
            await stage_change_mail(session, event, actor_id=ACTOR)

        assert staged.await_args.kwargs["kind"] is CalendarMailKind.CHANGE
