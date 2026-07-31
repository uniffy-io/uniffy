"""Argument parsing shared by the built-in tool executors."""

from __future__ import annotations

from uuid import UUID

# A model can put anything in a numeric argument, including a string, a float,
# zero, or a page number in the millions. Every value that reaches SQL as LIMIT
# or OFFSET goes through clamp_int first: a negative LIMIT is a driver error, a
# zero LIMIT silently returns nothing, and an unbounded page turns into an
# OFFSET scan over the whole table.
MAX_PAGE = 200


def clamp_int(value: object, default: int, minimum: int, maximum: int) -> int:
    """Coerce a tool argument to an int inside [minimum, maximum]."""
    try:
        parsed = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default
    return max(minimum, min(parsed, maximum))


def clamp_page(value: object) -> int:
    """Page numbers are capped: deep paging is a search query, not an offset."""
    return clamp_int(value, 1, 1, MAX_PAGE)


def parse_uuid(value: str, field_name: str) -> tuple[UUID | None, str | None]:
    """Parse a UUID string, returning (uuid, error)."""
    try:
        return UUID(value), None
    except ValueError:
        return None, f"Invalid {field_name}: {value}"


def parse_uuid_list(
    values: list,
    field_name: str,
) -> tuple[list[UUID] | None, str | None]:
    """Parse a list of UUID strings, returning (uuids, error)."""
    uuids: list[UUID] = []
    for v in values:
        parsed, err = parse_uuid(str(v), field_name)
        if err:
            return None, err
        uuids.append(parsed)  # type: ignore[arg-type]
    return uuids, None
