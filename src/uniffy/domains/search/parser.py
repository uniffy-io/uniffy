"""Google-style keyword search parser.

Type keywords (`note:`, `file:`, `message:`, ...) and `my:` are bare
prefixes: they only toggle a filter and the text after them stays in the
free-text query. Only `tag:` / `owner:` / `type:` consume a value
(`tag:work`, `tag:"project alpha"`). Standalone quoted phrases are left
in the residual text so Meilisearch enforces the exact match.
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

    my_content_only: bool = False
    """Only show current user's content."""

    owner: str | None = None
    """Filter by owner username."""

    exact_phrases: list[str] = Field(default_factory=list)
    """Exact match phrases detected in query (for logging/analytics)."""

    raw_query: str = ""
    """Original raw query string."""


# Keyword -> canonical entity_type (the keys of ENTITY_TYPE_TO_PROTO in
# converters.py). Mirrors the frontend queryParser.ts map - keep in sync.
TYPE_KEYWORD_MAP: dict[str, str] = {
    "note": "note",
    "notes": "note",
    "file": "file",
    "files": "file",
    "folder": "folder",
    "folders": "folder",
    "agentfolder": "agent_folder",
    "agentfolders": "agent_folder",
    "agent-folder": "agent_folder",
    "agent-folders": "agent_folder",
    "user": "user",
    "users": "user",
    "calendar": "calendar_event",
    "event": "calendar_event",
    "events": "calendar_event",
    "chat": "chat",
    "chats": "chat",
    "agentchat": "agent_chat",
    "agentchats": "agent_chat",
    "agent-chat": "agent_chat",
    "agent-chats": "agent_chat",
    "chatmessage": "chat_message",
    "message": "chat_message",
    "msg": "chat_message",
    "project": "project",
    "projects": "project",
    "task": "task",
    "tasks": "task",
    "agent": "agent",
    "agents": "agent",
    "prompt": "prompt",
    "prompts": "prompt",
    "room": "room",
    "rooms": "room",
    "tagentity": "tag",
    "tagentities": "tag",
}

# Longest-first so `agent-chats:` wins over `agent:`.
_BARE_PREFIXES = sorted([*TYPE_KEYWORD_MAP, "my"], key=len, reverse=True)

# Bare prefixes consume only the `keyword:` token itself.
BARE_FILTER_PATTERN = re.compile(
    rf'\b({"|".join(_BARE_PREFIXES)}):',
    re.IGNORECASE,
)

# Value keywords consume `keyword:value` or `keyword:"quoted value"`; a
# dangling `keyword:` with no value is stripped without adding a filter.
VALUE_FILTER_PATTERN = re.compile(
    r'\b(tag|owner|type):\s*(?:"([^"]+)"|([^\s"]+))?',
    re.IGNORECASE,
)

# Standalone quoted phrases (quote not glued to a `keyword:`); protected
# from filter extraction so `"note: literal"` stays literal search text.
QUOTED_SEGMENT_SPLIT = re.compile(r'((?<!:)"[^"]*")')

# Negative lookbehind avoids matching filter values like tag:"value".
PHRASE_PATTERN = re.compile(r'(?<![a-z]:)"([^"]+)"', re.IGNORECASE)


def parse_search_query(query: str) -> ParsedSearchQuery:
    result = ParsedSearchQuery(text="", raw_query=query)

    if not query or not query.strip():
        return result

    def add_type_filter(keyword: str) -> None:
        entity_type = TYPE_KEYWORD_MAP.get(keyword)
        if entity_type and entity_type not in result.type_filters:
            result.type_filters.append(entity_type)

    def extract_value_filters(match: re.Match) -> str:
        keyword = match.group(1).lower()
        value = (match.group(2) or match.group(3) or "").strip()
        if not value:
            return " "
        if keyword == "tag":
            if value not in result.tags:
                result.tags.append(value)
        elif keyword == "owner":
            result.owner = value
        elif keyword == "type":
            add_type_filter(value.lower())
        return " "

    def strip_bare_filters(match: re.Match) -> str:
        keyword = match.group(1).lower()
        if keyword == "my":
            result.my_content_only = True
        else:
            add_type_filter(keyword)
        return " "

    pieces = QUOTED_SEGMENT_SPLIT.split(query)
    for i, piece in enumerate(pieces):
        if i % 2 == 1:
            continue
        piece = VALUE_FILTER_PATTERN.sub(extract_value_filters, piece)
        pieces[i] = BARE_FILTER_PATTERN.sub(strip_bare_filters, piece)

    result.text = re.sub(r"\s+", " ", "".join(pieces)).strip()

    # Quotes stay inside the residual text so Meilisearch can use them; we only
    # capture phrases here for analytics.
    for phrase_match in PHRASE_PATTERN.finditer(result.text):
        phrase = phrase_match.group(1).strip()
        if phrase and phrase not in result.exact_phrases:
            result.exact_phrases.append(phrase)

    return result


def has_active_filters(parsed: ParsedSearchQuery) -> bool:
    return (
        len(parsed.type_filters) > 0
        or len(parsed.tags) > 0
        or parsed.my_content_only
        or parsed.owner is not None
        or len(parsed.exact_phrases) > 0
    )
