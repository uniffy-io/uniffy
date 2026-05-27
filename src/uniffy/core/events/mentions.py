"""Utilities for extracting mentioned users from URN references."""

from uuid import UUID

USER_URN_PREFIX = "urn:uniffy:content:USER:"


def extract_mentioned_user_ids(outgoing_references: list[str] | None) -> set[UUID]:
    """User UUIDs from USER URNs in an ``outgoing_references`` list."""
    if not outgoing_references:
        return set()
    result: set[UUID] = set()
    for urn in outgoing_references:
        if urn.startswith(USER_URN_PREFIX):
            try:
                result.add(UUID(urn[len(USER_URN_PREFIX) :]))
            except ValueError:
                continue
    return result
