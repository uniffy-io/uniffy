"""Password strength policy shared by identity workflows."""

from __future__ import annotations

import re

from uniffy.core.errors import ValidationError

MIN_LENGTH = 12
MIN_LENGTH_WITH_COMPLEXITY = 8
MAX_LENGTH = 72

_HAS_UPPER = re.compile(r"[A-Z]")
_HAS_LOWER = re.compile(r"[a-z]")
_HAS_DIGIT = re.compile(r"\d")
_HAS_SYMBOL = re.compile(r"[^A-Za-z0-9]")


def validate_password(password: str) -> None:
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
