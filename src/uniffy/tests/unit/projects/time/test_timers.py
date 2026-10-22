import pytest

from uniffy.domains.projects.time.timers import round_minutes

ONE_HOUR_33_MINUTES_40_SECONDS = 1 * 3600 + 33 * 60 + 40


@pytest.mark.parametrize(
    ("seconds", "increment", "expected"),
    [
        (ONE_HOUR_33_MINUTES_40_SECONDS, 5, 95),
        (ONE_HOUR_33_MINUTES_40_SECONDS, 1, 94),
        (ONE_HOUR_33_MINUTES_40_SECONDS, 6, 96),
        (ONE_HOUR_33_MINUTES_40_SECONDS, 10, 90),
        (ONE_HOUR_33_MINUTES_40_SECONDS, 15, 90),
        # Under one increment produces one increment.
        (20, 5, 5),
        (0, 1, 1),
        (0, 15, 15),
        # Exactly half an increment rounds up.
        (150, 5, 5),
        (30, 1, 1),
        (29, 1, 1),
        (90, 1, 2),
        # Whole increments stay put.
        (600, 10, 10),
        (3600, 15, 60),
    ],
)
def test_round_minutes_rounds_half_up_with_a_floor_of_one_increment(
    seconds: int, increment: int, expected: int
) -> None:
    assert round_minutes(seconds, increment) == expected


def test_round_minutes_rejects_a_non_positive_increment() -> None:
    with pytest.raises(ValueError, match="increment"):
        round_minutes(60, 0)
