"""Utilities for extracting mentioned subjects from URN references."""

from uuid import UUID

USER_URN_PREFIX = "urn:uniffy:content:USER:"
TEAM_URN_PREFIX = "urn:uniffy:content:TEAM:"


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


def extract_mentioned_team_ids(outgoing_references: list[str] | None) -> list[UUID]:
    """Team UUIDs from TEAM URNs, in reference order.

    Order decides which team's name titles the notification when a recipient
    belongs to more than one mentioned team.
    """
    if not outgoing_references:
        return []
    seen: set[UUID] = set()
    result: list[UUID] = []
    for urn in outgoing_references:
        if not urn.startswith(TEAM_URN_PREFIX):
            continue
        try:
            team_id = UUID(urn[len(TEAM_URN_PREFIX) :])
        except ValueError:
            continue
        if team_id in seen:
            continue
        seen.add(team_id)
        result.append(team_id)
    return result
