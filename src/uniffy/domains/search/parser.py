"""Google-style keyword search parser.

Syntax: `note:` / `file:` / `user:` / `calendar:` / `chat:` / `book:` /
`password:` / `space:` for type, `tag:` / `project:` for metadata,
`my:` for current-user content, quoted phrases preserved in the residual text.
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

FILTER_PREFIXES = [
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
    "tag",
    "project",
    "my",
    "owner",
]

# Matches `keyword:value` or `keyword:"quoted value"`.
FILTER_PATTERN = re.compile(
    rf'\b({"|".join(FILTER_PREFIXES)}):\s*(?:"([^"]+)"|(\S+))',
    re.IGNORECASE,
)

# Negative lookbehind avoids matching filter values like tag:"value".
PHRASE_PATTERN = re.compile(r'(?<![a-z]:)"([^"]+)"', re.IGNORECASE)


def parse_search_query(query: str) -> ParsedSearchQuery:
    result = ParsedSearchQuery(text="", raw_query=query)

    if not query or not query.strip():
        return result

    remaining_text = query
    extracted_filters: list[tuple[str, str, str]] = []

    for match in FILTER_PATTERN.finditer(query):
        full_match = match.group(0)
        keyword = match.group(1).lower()
        quoted_value = match.group(2)
        unquoted_value = match.group(3)
        value = (quoted_value or unquoted_value or "").strip()

        if value:
            extracted_filters.append((full_match, keyword, value))

    for full_match, keyword, value in extracted_filters:
        remaining_text = remaining_text.replace(full_match, " ", 1)

        if keyword in TYPE_KEYWORD_MAP:
            entity_type = TYPE_KEYWORD_MAP[keyword]
            if entity_type not in result.type_filters:
                result.type_filters.append(entity_type)
            continue

        if keyword == "tag":
            if value not in result.tags:
                result.tags.append(value)
            continue

        if keyword == "project":
            if value not in result.projects:
                result.projects.append(value)
            continue

        if keyword == "my":
            result.my_content_only = True
            continue

        if keyword == "owner":
            result.owner = value
            continue

    remaining_text = re.sub(r"\s+", " ", remaining_text).strip()
    result.text = remaining_text

    # Quotes stay inside the residual text so Meilisearch can use them; we only
    # capture phrases here for analytics.
    for phrase_match in PHRASE_PATTERN.finditer(remaining_text):
        phrase = phrase_match.group(1).strip()
        if phrase and phrase not in result.exact_phrases:
            result.exact_phrases.append(phrase)

    return result


def has_active_filters(parsed: ParsedSearchQuery) -> bool:
    return (
        len(parsed.type_filters) > 0
        or len(parsed.tags) > 0
        or len(parsed.projects) > 0
        or parsed.my_content_only
        or parsed.owner is not None
        or len(parsed.exact_phrases) > 0
    )
