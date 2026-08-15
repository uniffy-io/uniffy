"""Single source of truth for password strength rules.

Register, accept-invitation, and password-reset all go through
:func:`validate_password` so a frontend bypass cannot store a weaker
password than the policy allows. Rules are intentionally lenient on
length once complexity is met; the goal is "no laughably weak
credentials" rather than "force a memorable nightmare".
"""

from __future__ import annotations

import re

from uniffy.core.errors import ValidationError

MIN_LENGTH = 12
MIN_LENGTH_WITH_COMPLEXITY = 8
# bcrypt silently truncates after 72 bytes, so accepting longer is
# theatre. Reject early with a clear message.
MAX_LENGTH = 72

_HAS_UPPER = re.compile(r"[A-Z]")
_HAS_LOWER = re.compile(r"[a-z]")
_HAS_DIGIT = re.compile(r"\d")
_HAS_SYMBOL = re.compile(r"[^A-Za-z0-9]")


def validate_password(password: str) -> None:
    """Raise :class:`ValidationError` when ``password`` violates policy.

    Accepts either:
    * 12+ characters of any composition, or
    * 8-11 characters with at least three of {upper, lower, digit, symbol}.

    Anything shorter than 8 or longer than 72 is rejected outright.
    """
    if password is None:
        raise ValidationError("password", "password is required")
    length = len(password)
    if length < MIN_LENGTH_WITH_COMPLEXITY:
        raise ValidationError(
            "password",
            f"password must be at least {MIN_LENGTH_WITH_COMPLEXITY} characters",
        )
    if length > MAX_LENGTH:
        raise ValidationError(
            "password",
            f"password must be at most {MAX_LENGTH} characters",
        )
    if length >= MIN_LENGTH:
        return
    classes = sum(
        bool(rx.search(password)) for rx in (_HAS_UPPER, _HAS_LOWER, _HAS_DIGIT, _HAS_SYMBOL)
    )
    if classes < 3:
        raise ValidationError(
            "password",
            "passwords shorter than 12 characters must mix at least three of "
            "uppercase, lowercase, digit, and symbol",
        )


__all__ = ["validate_password"]
