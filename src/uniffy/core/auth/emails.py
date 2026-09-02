"""Canonical email normalization shared by identity workflows."""


def normalize_email(value: str | None) -> str:
    if value is None:
        return ""
    return value.strip().lower()


__all__ = ["normalize_email"]
