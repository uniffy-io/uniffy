"""Request parsing that decides what reaches the calendar operations."""

from uniffy.domains.scheduling.calendar.rpc.support import parse_reminders


class TestParseReminders:
    def test_values_pass_through(self) -> None:
        assert parse_reminders([15, 60], explicit_empty=False) == [15, 60]

    def test_empty_without_the_flag_is_unspecified(self) -> None:
        assert parse_reminders([], explicit_empty=False) is None

    def test_the_flag_means_none(self) -> None:
        assert parse_reminders([], explicit_empty=True) == []

    def test_the_flag_wins_over_values(self) -> None:
        assert parse_reminders([15], explicit_empty=True) == []
