"""
Search query parser for keyword-based filtering.

Parses Google-style keyword search queries into structured filters.

Supported syntax:
- Type filters: note:, file:, user:, calendar:, chat:, book:, password:, space:
- Metadata filters: tag:, project:
- Ownership: my: (shorthand for current user's content)
- Quoted phrases: "exact phrase" preserved in text

Examples:
- `note: "how to" tag:work` -> ParsedSearchQuery(text="how to", types=["note"], tags=["work"])
- `user: john` -> ParsedSearchQuery(text="john", types=["user"])
- `my: drafts` -> ParsedSearchQuery(text="drafts", my_content_only=True)
"""

import re

from pydantic import BaseModel, Field


class ParsedSearchQuery(BaseModel):
    """Parsed search query with extracted filters."""

    text: str = ""
    """Remaining free text after extracting filters (for fuzzy search)."""

    type_filters: list[str] = Field(default_factory=list)
    """Content type filters (note, file, user, etc.)."""

    tags: list[str] = Field(default_factory=list)
    """Tag filters."""

    projects: list[str] = Field(default_factory=list)
    """Project filters."""

    my_content_only: bool = False
    """Only show current user's content."""

    owner: str | None = None
    """Filter by owner username."""

    exact_phrases: list[str] = Field(default_factory=list)
    """Exact match phrases detected in query (for logging/analytics)."""

    raw_query: str = ""
    """Original raw query string."""


# Mapping of type filter keywords to entity type strings
TYPE_KEYWORD_MAP: dict[str, str] = {
    "note": "note",
    "notes": "note",
    "file": "file",
    "files": "file",
    "user": "user",
    "users": "user",
    "calendar": "calendar_event",
    "event": "calendar_event",
    "events": "calendar_event",
    "chat": "chat",
    "chats": "chat",
    "book": "book",
    "books": "book",
    "password": "password",
    "passwords": "password",
    "space": "space",
    "spaces": "space",
    "workflow": "workflow",
    "workflows": "workflow",
}

# All recognized filter prefixes
FILTER_PREFIXES = [
    # Type filters
    "note",
    "notes",
    "file",
    "files",
    "user",
    "users",
    "calendar",
    "event",
    "events",
    "chat",
    "chats",
    "book",
    "books",
    "password",
    "passwords",
    "space",
    "spaces",
    "workflow",
    "workflows",
    # Metadata filters
    "tag",
    "project",
    # Ownership filters
    "my",
    "owner",
]

# Regex pattern to match filter syntax: `keyword:value` or `keyword:"quoted value"`
FILTER_PATTERN = re.compile(
    rf'\b({"|".join(FILTER_PREFIXES)}):\s*(?:"([^"]+)"|(\S+))',
    re.IGNORECASE,
)

# Pattern to match standalone quoted phrases (not preceded by filter keywords)
# Uses negative lookbehind to avoid matching filter values like tag:"value"
PHRASE_PATTERN = re.compile(r'(?<![a-z]:)"([^"]+)"', re.IGNORECASE)


def parse_search_query(query: str) -> ParsedSearchQuery:
    """
    Parse a search query string into structured filters.

    Parameters
    ----------
    query : str
        Raw search query string.

    Returns
    -------
    ParsedSearchQuery
        Parsed query with text and filters.

    Examples
    --------
    >>> result = parse_search_query('note: "how to" tag:work')
    >>> result.text
    'how to'
    >>> result.type_filters
    ['note']
    >>> result.tags
    ['work']

    >>> result = parse_search_query('user: john')
    >>> result.text
    'john'
    >>> result.type_filters
    ['user']

    >>> result = parse_search_query('my: drafts')
    >>> result.text
    'drafts'
    >>> result.my_content_only
    True

    """
    result = ParsedSearchQuery(text="", raw_query=query)

    if not query or not query.strip():
        return result

    remaining_text = query
    extracted_filters: list[tuple[str, str, str]] = []

    # Extract all filter matches
    for match in FILTER_PATTERN.finditer(query):
        full_match = match.group(0)
        keyword = match.group(1).lower()
        quoted_value = match.group(2)
        unquoted_value = match.group(3)
        value = (quoted_value or unquoted_value or "").strip()

        if value:
            extracted_filters.append((full_match, keyword, value))

    # Process extracted filters
    for full_match, keyword, value in extracted_filters:
        # Remove the filter from remaining text
        remaining_text = remaining_text.replace(full_match, " ", 1)

        # Type filters
        if keyword in TYPE_KEYWORD_MAP:
            entity_type = TYPE_KEYWORD_MAP[keyword]
            if entity_type not in result.type_filters:
                result.type_filters.append(entity_type)
            continue

        # Tag filter
        if keyword == "tag":
            if value not in result.tags:
                result.tags.append(value)
            continue

        # Project filter
        if keyword == "project":
            if value not in result.projects:
                result.projects.append(value)
            continue

        # My content filter
        if keyword == "my":
            result.my_content_only = True
            continue

        # Owner filter
        if keyword == "owner":
            result.owner = value
            continue

    # Clean up remaining text
    remaining_text = re.sub(r"\s+", " ", remaining_text).strip()
    result.text = remaining_text

    # Extract exact-match phrases for logging/analytics (quotes stay in text for Meilisearch)
    for phrase_match in PHRASE_PATTERN.finditer(remaining_text):
        phrase = phrase_match.group(1).strip()
        if phrase and phrase not in result.exact_phrases:
            result.exact_phrases.append(phrase)

    return result


def has_active_filters(parsed: ParsedSearchQuery) -> bool:
    """
    Check if a parsed query contains any active filters.

    Parameters
    ----------
    parsed : ParsedSearchQuery
        Parsed search query.

    Returns
    -------
    bool
        True if any filters are active.

    """
    return (
        len(parsed.type_filters) > 0
        or len(parsed.tags) > 0
        or len(parsed.projects) > 0
        or parsed.my_content_only
        or parsed.owner is not None
        or len(parsed.exact_phrases) > 0
    )
