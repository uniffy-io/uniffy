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
