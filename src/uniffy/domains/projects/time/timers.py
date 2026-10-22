"""Timer elapsed-time rounding."""

SECONDS_PER_MINUTE = 60


def round_minutes(seconds: int, increment: int) -> int:
    """Round half up to the increment, never below one increment."""
    if increment <= 0:
        raise ValueError("increment must be positive")
    half_increment_seconds = increment * SECONDS_PER_MINUTE // 2
    units = (max(seconds, 0) + half_increment_seconds) // (increment * SECONDS_PER_MINUTE)
    return max(increment, units * increment)
