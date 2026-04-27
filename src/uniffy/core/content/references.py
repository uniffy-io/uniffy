"""Shared URN and reference parsing utilities for content with references.

Provides regex patterns and extraction functions used by any domain
that stores markdown content with URN mentions or inline file URLs.
"""

import re
from uuid import UUID

from uniffy.core.types import ContentType

# Regex pattern for URN mentions in markdown: [[[label|urn]]]
# Also handles escaped brackets/pipes from some editors: \[\[\[label\|urn\]\]\]
MENTION_PATTERN = re.compile(r"\\?\[\\?\[\\?\[(.+?)\\?\|(.+?)\\?\]\\?\]\\?\]")

# Regex pattern for inline file URLs in markdown content.
# Matches paths like /api/files/{orgId}/{fileId}, /media-stream/{orgId}/{fileId},
# and /api/thumbnails/{orgId}/{fileId}. Captures the file UUID.
_UUID_RE = r"[0-9a-fA-F-]{36}"
INLINE_FILE_URL_PATTERN = re.compile(
    rf"(?:/api/files|/media-stream|/api/thumbnails)/({_UUID_RE})/({_UUID_RE})"
)

# URN format: urn:uniffy:content:{TYPE}:{uuid}
_URN_PREFIX = "urn:uniffy:content:"

# Map of URN type strings to ContentType enum values
_URN_TYPE_MAP: dict[str, ContentType] = {ct.value: ct for ct in ContentType}


def extract_urns_from_content(content: str) -> list[str]:
    """Extract all unique URNs from markdown content.

    Parses the [[[label|urn]]] mention pattern and returns
    a deduplicated list of URNs.

    Parameters
    ----------
    content : str
        Markdown content to parse.

    Returns
    -------
    list[str]
        Unique URNs found in the content.

    """
    if not content:
        return []

    urns: set[str] = set()
    for match in MENTION_PATTERN.finditer(content):
        urn = match.group(2)  # Second capture group is the URN
        if urn and urn.startswith("urn:uniffy:"):
            urns.add(urn)

    return list(urns)


def extract_inline_file_ids(
    content: str,
    organization_id: UUID | None = None,
) -> list[UUID]:
    """Extract file UUIDs from inline media URLs in markdown content.

    Parses URLs like ``/api/files/{orgId}/{fileId}`` and
    ``/media-stream/{orgId}/{fileId}`` to extract referenced file IDs.

    When ``organization_id`` is provided, only URLs whose embedded
    organization UUID matches are included. This prevents cross-tenant
    references from being extracted.

    Parameters
    ----------
    content : str
        Markdown content to parse.
    organization_id : UUID | None
        If provided, only return files whose URL org ID matches.

    Returns
    -------
    list[UUID]
        Unique file UUIDs found in inline URLs.

    """
    if not content:
        return []

    file_ids: set[UUID] = set()
    for match in INLINE_FILE_URL_PATTERN.finditer(content):
        try:
            url_org_id = UUID(match.group(1))
            file_id = UUID(match.group(2))
        except ValueError:
            continue

        if organization_id is not None and url_org_id != organization_id:
            continue

        file_ids.add(file_id)

    return list(file_ids)


def extract_all_outgoing_references(
    content: str,
    organization_id: UUID | None = None,
) -> list[str]:
    """Extract all outgoing references from content as URN strings.

    Combines two sources:
    1. URN mentions from ``[[[label|urn]]]`` patterns
    2. Inline file URLs (``/api/files/``, ``/media-stream/``,
       ``/api/thumbnails/``) converted to ``urn:uniffy:content:FILE:{uuid}``

    Use this function when populating the ``outgoing_references`` JSONB
    field so that the cascade system can discover both mention-style and
    inline-media-style references.

    Parameters
    ----------
    content : str
        Markdown content to parse.
    organization_id : UUID | None
        If provided, only inline file URLs matching this org are included.

    Returns
    -------
    list[str]
        Unique URN strings found in the content.

    """
    if not content:
        return []

    urns: set[str] = set()

    # 1. URN mentions from [[[label|urn]]] patterns
    for match in MENTION_PATTERN.finditer(content):
        urn = match.group(2)
        if urn and urn.startswith("urn:uniffy:"):
            urns.add(urn)

    # 2. Inline file URLs -> FILE URNs
    for file_id in extract_inline_file_ids(content, organization_id=organization_id):
        urns.add(f"{_URN_PREFIX}FILE:{file_id}")

    return list(urns)


def extract_all_outgoing_references_from_canvas(
    canvas_data: dict | str,
    organization_id: UUID | None = None,
) -> list[str]:
    """Extract all outgoing references from canvas data.

    Parses the canvas structure and extracts URNs from:
    1. ``type:"text"`` nodes: calls ``extract_all_outgoing_references()`` on their content
    2. ``type:"note"`` nodes: adds their ``urn`` field
    3. ``type:"media"`` nodes: builds ``urn:uniffy:content:FILE:{fileId}``

    Parameters
    ----------
    canvas_data : dict | str
        Canvas state as a dict (from JSONB) or JSON string (legacy).
    organization_id : UUID | None
        If provided, only inline file URLs matching this org are included.

    Returns
    -------
    list[str]
        Unique URN strings found in the canvas.

    """
    if not canvas_data:
        return []

    # Accept both dict (from JSONB column) and str (legacy)
    if isinstance(canvas_data, str):
        import json as _json

        try:
            data = _json.loads(canvas_data)
        except ValueError, TypeError:
            return []
    else:
        data = canvas_data

    nodes = data.get("nodes", [])
    urns: set[str] = set()

    for node in nodes:
        node_data = node.get("data", {})
        node_type = node_data.get("type", "")

        if node_type == "text":
            content = node_data.get("content", "")
            if content:
                for urn in extract_all_outgoing_references(content, organization_id):
                    urns.add(urn)

        elif node_type == "note":
            urn = node_data.get("urn", "")
            if urn and urn.startswith("urn:uniffy:"):
                urns.add(urn)

        elif node_type == "media":
            file_id = node_data.get("fileId", "")
            if file_id:
                urns.add(f"{_URN_PREFIX}FILE:{file_id}")

    return list(urns)


def extract_urns_with_types(content: str) -> list[tuple[str, ContentType]]:
    """Extract (urn, content_type) pairs from markdown content.

    Parses [[[label|urn:uniffy:content:TYPE:uuid]]] mentions and returns
    each URN with its resolved ContentType. Unknown types are skipped.

    Parameters
    ----------
    content : str
        Markdown content to parse.

    Returns
    -------
    list[tuple[str, ContentType]]
        List of (urn_string, content_type) pairs.

    """
    if not content:
        return []

    results: list[tuple[str, ContentType]] = []
    seen: set[str] = set()
    for match in MENTION_PATTERN.finditer(content):
        urn = match.group(2)
        if not urn or not urn.startswith(_URN_PREFIX) or urn in seen:
            continue
        seen.add(urn)
        parsed = parse_urn(urn)
        if parsed:
            results.append((urn, parsed[0]))
    return results


def extract_mentioned_agent_ids_from_content(content: str) -> set[UUID]:
    """Extract agent UUIDs from [[[label|urn:uniffy:content:AGENT:uuid]]] mentions.

    Mirror of ``extract_mentioned_user_ids_from_content`` for agents. Used by
    the chat domain to populate ``chat_messages.mentioned_agent_ids`` on
    send/update so the agent context-builder can query by GIN index.

    Parameters
    ----------
    content : str
        Markdown content to parse.

    Returns
    -------
    set[UUID]
        Set of mentioned agent IDs.

    """
    if not content:
        return set()

    agent_prefix = f"{_URN_PREFIX}AGENT:"
    result: set[UUID] = set()
    for match in MENTION_PATTERN.finditer(content):
        urn = match.group(2)
        if urn and urn.startswith(agent_prefix):
            try:
                result.add(UUID(urn[len(agent_prefix) :]))
            except ValueError:
                continue
    return result


def extract_mentioned_user_ids_from_content(content: str) -> set[UUID]:
    """Extract user UUIDs from [[[label|urn:uniffy:content:USER:uuid]]] mentions.

    Convenience function that combines mention parsing with USER type
    filtering. Use this when you need mentioned user IDs directly from
    markdown content (e.g., chat notifications) rather than from a
    pre-computed outgoing_references list.

    Parameters
    ----------
    content : str
        Markdown content to parse.

    Returns
    -------
    set[UUID]
        Set of mentioned user IDs.

    """
    if not content:
        return set()

    user_prefix = f"{_URN_PREFIX}USER:"
    result: set[UUID] = set()
    for match in MENTION_PATTERN.finditer(content):
        urn = match.group(2)
        if urn and urn.startswith(user_prefix):
            try:
                result.add(UUID(urn[len(user_prefix) :]))
            except ValueError:
                continue
    return result


def strip_mentions_to_labels(content: str) -> str:
    """Replace all [[[label|urn]]] mentions with just the label text.

    Useful for producing plaintext from markdown content for search
    indexing or notification previews.

    Parameters
    ----------
    content : str
        Markdown content with URN mentions.

    Returns
    -------
    str
        Content with mentions replaced by their label text.

    """
    if not content:
        return ""
    return MENTION_PATTERN.sub(lambda m: m.group(1), content)


def replace_mention_label(content: str, target_urn: str, new_label: str) -> str:
    """Replace the label in all mentions of a specific URN.

    Finds all ``[[[label|target_urn]]]`` patterns and replaces the label
    with ``new_label``, preserving any bracket/pipe escaping.

    Parameters
    ----------
    content : str
        Markdown content to update.
    target_urn : str
        URN whose mention labels should be replaced.
    new_label : str
        New label text.

    Returns
    -------
    str
        Updated content with replaced labels.

    """
    if not content or not target_urn:
        return content

    def _replacer(match: re.Match) -> str:
        urn = match.group(2)
        if urn == target_urn:
            # Reconstruct the mention preserving original bracket/pipe escaping
            full = match.group(0)
            # Find the separator between label and URN
            # Replace everything between the opening brackets and the separator
            sep_idx = full.find(urn)
            if sep_idx == -1:
                return full
            # Find the pipe character before the URN
            pipe_idx = full.rfind("|", 0, sep_idx)
            if pipe_idx == -1:
                pipe_idx = full.rfind("\\|", 0, sep_idx)
                if pipe_idx == -1:
                    return full
            # Determine the opening bracket style
            if full.startswith("\\[\\[\\["):
                prefix = "\\[\\[\\["
                suffix_start = sep_idx + len(urn)
                suffix = full[suffix_start:]
                sep = full[pipe_idx:sep_idx]
                return f"{prefix}{new_label}{sep}{urn}{suffix}"
            else:
                prefix = "[[["
                suffix_start = sep_idx + len(urn)
                suffix = full[suffix_start:]
                sep = full[pipe_idx:sep_idx]
                return f"{prefix}{new_label}{sep}{urn}{suffix}"
        return match.group(0)

    return MENTION_PATTERN.sub(_replacer, content)


def replace_mention_label_in_canvas(
    canvas_data: dict,
    target_urn: str,
    new_label: str,
) -> tuple[dict, bool]:
    """Replace mention labels in canvas text nodes.

    Iterates over all ``type:"text"`` nodes in the canvas and runs
    ``replace_mention_label()`` on their content.

    Parameters
    ----------
    canvas_data : dict
        Canvas state dict (from JSONB).
    target_urn : str
        URN whose mention labels should be replaced.
    new_label : str
        New label text.

    Returns
    -------
    tuple[dict, bool]
        Updated canvas data and whether any changes were made.

    """
    if not canvas_data:
        return canvas_data, False

    import copy as _copy

    nodes = canvas_data.get("nodes", [])
    changed = False
    new_data = None

    for i, node in enumerate(nodes):
        node_data = node.get("data", {})
        if node_data.get("type") != "text":
            continue
        content = node_data.get("content", "")
        if not content:
            continue
        updated = replace_mention_label(content, target_urn, new_label)
        if updated != content:
            if not changed:
                new_data = _copy.deepcopy(canvas_data)
                changed = True
            new_data["nodes"][i]["data"]["content"] = updated

    return (new_data if changed else canvas_data), changed


def parse_urn(urn: str) -> tuple[ContentType, UUID] | None:
    """Parse a URN string into its content type and UUID.

    Parameters
    ----------
    urn : str
        URN string in the format ``urn:uniffy:content:{TYPE}:{uuid}``.

    Returns
    -------
    tuple[ContentType, UUID] | None
        (content_type, uuid) if valid, None if malformed or unknown type.

    """
    if not urn or not urn.startswith(_URN_PREFIX):
        return None

    remainder = urn[len(_URN_PREFIX) :]
    parts = remainder.split(":", 1)
    if len(parts) != 2:
        return None

    type_str, uuid_str = parts
    content_type = _URN_TYPE_MAP.get(type_str)
    if content_type is None:
        return None

    try:
        parsed_uuid = UUID(uuid_str)
    except ValueError:
        return None

    return content_type, parsed_uuid
