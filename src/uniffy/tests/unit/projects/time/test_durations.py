import pytest

from uniffy.domains.projects.time.durations import format_minutes, parse_duration


@pytest.mark.parametrize(
    ("text", "minutes"),
    [
        ("1.5h", 90),
        ("1h 30m", 90),
        ("1h30m", 90),
        ("2H", 120),
        ("45m", 45),
        ("45 m", 45),
        ("90", 90),
        ("0.5", 1),
        ("  3h  ", 180),
    ],
)
def test_parse_duration_matches_the_web_grammar(text: str, minutes: int) -> None:
    assert parse_duration(text) == minutes


@pytest.mark.parametrize("text", ["", "   ", "an hour", "1h30", "h", "-5", "1.5.5h", "30s"])
def test_parse_duration_rejects_other_shapes(text: str) -> None:
    assert parse_duration(text) is None


@pytest.mark.parametrize(
    ("minutes", "label"),
    [(0, "0m"), (-5, "0m"), (45, "45m"), (60, "1h"), (90, "1h 30m"), (600, "10h")],
)
def test_format_minutes(minutes: int, label: str) -> None:
    assert format_minutes(minutes) == label
