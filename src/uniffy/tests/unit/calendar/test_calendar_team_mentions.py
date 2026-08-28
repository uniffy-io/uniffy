"""Team mentions on calendar events: attendees and the actor never double-notify."""

from unittest.mock import AsyncMock, MagicMock, patch

from uniffy.core.content.team_mentions import TeamExpansion
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.types import generate_id
from uniffy.domains.calendar.operations import CalendarEventOperations

ORG = generate_id()
ACTOR = generate_id()


def _event() -> CalendarEvent:
    return CalendarEvent(
        id=generate_id(),
        organization_id=ORG,
        owner_id=ACTOR,
        title="Quarterly review",
        start_time=None,
        end_time=None,
    )


def _ops() -> CalendarEventOperations:
    ops = CalendarEventOperations.__new__(CalendarEventOperations)
    ops.session = MagicMock()
    return ops


async def _emit(team_ids, excluded, expansions):
    emitted: list = []
    ops = _ops()
    with (
        patch(
            "uniffy.domains.calendar.events.notifications.emit_notification",
            AsyncMock(side_effect=lambda event: emitted.append(event)),
        ),
        patch(
            "uniffy.domains.calendar.events.notifications.expand_team_mentions",
            AsyncMock(return_value=expansions),
        ) as expander,
    ):
        await ops._emit_team_mention_notifications(_event(), ACTOR, ORG, team_ids, excluded)
    return emitted, expander


class TestCalendarTeamMentions:
    async def test_team_members_notified_with_team_copy(self) -> None:
        member = generate_id()
        team = generate_id()
        expansion = TeamExpansion(team, "Engineering", (member,))

        emitted, _ = await _emit([team], set(), [expansion])

        assert len(emitted) == 1
        assert emitted[0].title == "Mentioned Engineering in: Quarterly review"
        assert emitted[0].target_user_ids == [member]
        assert emitted[0].metadata == {"team_id": str(team), "team_name": "Engineering"}

    async def test_attendees_and_actor_are_subtracted(self) -> None:
        attendee, plain = generate_id(), generate_id()
        team = generate_id()
        expansion = TeamExpansion(team, "Engineering", (ACTOR, attendee, plain))

        emitted, _ = await _emit([team], {ACTOR, attendee}, [expansion])

        assert emitted[0].target_user_ids == [plain]

    async def test_fully_excluded_team_emits_nothing(self) -> None:
        attendee = generate_id()
        team = generate_id()
        expansion = TeamExpansion(team, "Engineering", (attendee,))

        emitted, _ = await _emit([team], {attendee}, [expansion])

        assert emitted == []

    async def test_second_team_does_not_re_notify_shared_members(self) -> None:
        shared = generate_id()
        first, second = generate_id(), generate_id()
        expansions = [
            TeamExpansion(first, "Engineering", (shared,)),
            TeamExpansion(second, "Design", (shared,)),
        ]

        emitted, _ = await _emit([first, second], set(), expansions)

        assert len(emitted) == 1
        assert emitted[0].title == "Mentioned Engineering in: Quarterly review"

    async def test_no_team_ids_skips_expansion(self) -> None:
        emitted, expander = await _emit([], set(), [])

        assert emitted == []
        expander.assert_not_awaited()
