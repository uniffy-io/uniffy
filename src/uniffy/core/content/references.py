"""URN and reference parsing utilities for content stored as Markdown."""

import re
from enum import StrEnum
from uuid import UUID

from uniffy.core.json_codec import loads
from uniffy.core.types import ContentType

# ``[[[label|urn]]]`` mentions, with backslash escapes some editors emit.
# The label group excludes the structural characters so an interpolated title
# can never close the mention early and restructure the surrounding markup.
MENTION_PATTERN = re.compile(r"\\?\[\\?\[\\?\[([^\[\]|]+?)\\?\|(.+?)\\?\]\\?\]\\?\]")

_LABEL_UNSAFE_RE = re.compile(r"[\[\]|\\]+")


def sanitize_mention_label(label: str) -> str:
    """Strip the characters that would let a label escape its slot.

    The stored label is display fallback only (chips render the resolved live
    title), so the strip is lossless for users while making it impossible for
    an attacker-controlled title to mint mentions its author never wrote.
    Every ``[[[label|urn]]]`` writer routes labels through here.
    """
    cleaned = _LABEL_UNSAFE_RE.sub(" ", label or "")
    cleaned = " ".join(cleaned.split())
    return cleaned or "mention"


# Inline file URLs: /api/files, /api/media, /media-stream, /api/thumbnails over (org, file) uuids.
_UUID_RE = r"[0-9a-fA-F-]{36}"
INLINE_FILE_URL_PATTERN = re.compile(
    rf"(?:/api/files|/api/media|/media-stream|/api/thumbnails)/({_UUID_RE})/({_UUID_RE})"
)

CONTENT_URN_PREFIX = "urn:uniffy:content:"
BROADCAST_URN_PREFIX = "urn:uniffy:broadcast:"

_URN_TYPE_MAP: dict[str, ContentType] = {ct.value: ct for ct in ContentType}


class BroadcastMention(StrEnum):
    """Channel-wide mention kinds carried as ``urn:uniffy:broadcast:{kind}``."""

    CHANNEL = "channel"
    HERE = "here"


def broadcast_urn(kind: BroadcastMention) -> str:
    return f"{BROADCAST_URN_PREFIX}{kind.value}"


BROADCAST_URNS: tuple[str, ...] = tuple(broadcast_urn(kind) for kind in BroadcastMention)

_BROADCAST_URN_TO_KIND: dict[str, BroadcastMention] = {
    broadcast_urn(kind): kind for kind in BroadcastMention
}


def strip_broadcast_urns(urns: list[str]) -> list[str]:
    """Drop broadcast URNs; only the gated user send path may mint them.

    A writer that skips ``send_message`` (agent replies) must never let echoed
    or injected ``[[[@channel|...]]]`` markup badge a whole roster.
    """
    return [urn for urn in urns if not urn.startswith(BROADCAST_URN_PREFIX)]


def extract_broadcast_mentions_from_content(content: str) -> set[BroadcastMention]:
    """Broadcast kinds mentioned in the content, from ``[[[label|urn]]]`` markup only."""
    if not content:
        return set()

    result: set[BroadcastMention] = set()
    for match in MENTION_PATTERN.finditer(content):
        kind = _BROADCAST_URN_TO_KIND.get(match.group(2) or "")
        if kind is not None:
            result.add(kind)
    return result


class CanvasNodeType(StrEnum):
    TEXT = "text"
    NOTE = "note"
    MEDIA = "media"


def extract_urns_from_content(content: str) -> list[str]:
    """Unique URNs from ``[[[label|urn]]]`` mentions in markdown."""
    if not content:
        return []

    urns: set[str] = set()
    for match in MENTION_PATTERN.finditer(content):
        urn = match.group(2)
        if urn and urn.startswith("urn:uniffy:"):
            urns.add(urn)

    return list(urns)


def extract_inline_file_ids(
    content: str,
    organization_id: UUID | None = None,
) -> list[UUID]:
    """Unique file UUIDs from inline ``/api/files/`` / ``/media-stream/`` /
    ``/api/thumbnails/`` URLs.

    When ``organization_id`` is set, mismatched URLs are dropped (prevents
    cross-tenant references).
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
    """Union of mention URNs and inline file URLs (converted to FILE URNs).

    The canonical source for the ``outgoing_references`` JSONB column.
    """
    if not content:
        return []

    urns: set[str] = set()

    for match in MENTION_PATTERN.finditer(content):
        urn = match.group(2)
        if urn and urn.startswith("urn:uniffy:"):
            urns.add(urn)

    for file_id in extract_inline_file_ids(content, organization_id=organization_id):
        urns.add(f"{CONTENT_URN_PREFIX}FILE:{file_id}")

    return list(urns)


def extract_all_outgoing_references_from_canvas(
    canvas_data: dict | str,
    organization_id: UUID | None = None,
) -> list[str]:
    """URNs extracted from canvas ``text`` (markdown), ``note`` (urn), and
    ``media`` (fileId) nodes.
    """
    if not canvas_data:
        return []

    if isinstance(canvas_data, str):
        try:
            data = loads(canvas_data)
        except ValueError, TypeError:
            return []
    else:
        data = canvas_data

    nodes = data.get("nodes", [])
    urns: set[str] = set()

    for node in nodes:
        node_data = node.get("data", {})
        node_type = node_data.get("type", "")

        if node_type == CanvasNodeType.TEXT:
            content = node_data.get("content", "")
            if content:
                for urn in extract_all_outgoing_references(content, organization_id):
                    urns.add(urn)

        elif node_type == CanvasNodeType.NOTE:
            urn = node_data.get("urn", "")
            if urn and urn.startswith("urn:uniffy:"):
                urns.add(urn)

        elif node_type == CanvasNodeType.MEDIA:
            file_id = node_data.get("fileId", "")
            if file_id:
                urns.add(f"{CONTENT_URN_PREFIX}FILE:{file_id}")

    return list(urns)


def extract_urns_with_types(content: str) -> list[tuple[str, ContentType]]:
    """``(urn, content_type)`` pairs from mentions; unknown types are skipped."""
    if not content:
        return []

    results: list[tuple[str, ContentType]] = []
    seen: set[str] = set()
    for match in MENTION_PATTERN.finditer(content):
        urn = match.group(2)
        if not urn or not urn.startswith(CONTENT_URN_PREFIX) or urn in seen:
            continue
        seen.add(urn)
        parsed = parse_urn(urn)
        if parsed:
            results.append((urn, parsed[0]))
    return results


def extract_mentioned_agent_ids_from_content(content: str) -> set[UUID]:
    """Agent UUIDs from AGENT mentions; powers ``chat_messages.mentioned_agent_ids``."""
    if not content:
        return set()

    agent_prefix = f"{CONTENT_URN_PREFIX}AGENT:"
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
    """User UUIDs from USER mentions; for chat notifications and similar paths."""
    if not content:
        return set()

    user_prefix = f"{CONTENT_URN_PREFIX}USER:"
    result: set[UUID] = set()
    for match in MENTION_PATTERN.finditer(content):
        urn = match.group(2)
        if urn and urn.startswith(user_prefix):
            try:
                result.add(UUID(urn[len(user_prefix) :]))
            except ValueError:
                continue
    return result


def extract_mentioned_team_ids_from_content(content: str) -> list[UUID]:
    """TEAM group UUIDs from TEAM mentions, in first-occurrence order.

    Order is load-bearing: a recipient who belongs to two mentioned teams is
    notified once, under the team that was mentioned first.
    """
    if not content:
        return []

    team_prefix = f"{CONTENT_URN_PREFIX}TEAM:"
    seen: set[UUID] = set()
    result: list[UUID] = []
    for match in MENTION_PATTERN.finditer(content):
        urn = match.group(2)
        if not urn or not urn.startswith(team_prefix):
            continue
        try:
            team_id = UUID(urn[len(team_prefix) :])
        except ValueError:
            continue
        if team_id in seen:
            continue
        seen.add(team_id)
        result.append(team_id)
    return result


def strip_mentions_to_labels(content: str) -> str:
    """Replace each mention with just its label text (for plaintext search / previews)."""
    if not content:
        return ""
    return MENTION_PATTERN.sub(lambda m: m.group(1), content)


def is_mention_only_content(content: str) -> bool:
    """True when the content is only mentions + whitespace; suppress search indexing in that case.

    Indexing a message whose body is purely a mention surfaces it under a
    search for the *referenced* item's name, which is misleading.
    """
    if not content:
        return True
    without_mentions = MENTION_PATTERN.sub("", content)
    return not without_mentions.strip()


def replace_mention_label(content: str, target_urn: str, new_label: str) -> str:
    """Rewrite the label in every mention of ``target_urn`` while preserving escaping."""
    if not content or not target_urn:
        return content

    # Rename fanout writes into other users' documents; a raw title here would
    # inject markup with zero victim interaction.
    new_label = sanitize_mention_label(new_label)

    def _replacer(match: re.Match) -> str:
        urn = match.group(2)
        if urn == target_urn:
            full = match.group(0)
            sep_idx = full.find(urn)
            if sep_idx == -1:
                return full
            pipe_idx = full.rfind("|", 0, sep_idx)
            if pipe_idx == -1:
                pipe_idx = full.rfind("\\|", 0, sep_idx)
                if pipe_idx == -1:
                    return full
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
    """Run :func:`replace_mention_label` over canvas text nodes; returns ``(data, changed)``."""
    if not canvas_data:
        return canvas_data, False

    import copy as _copy

    nodes = canvas_data.get("nodes", [])
    changed = False
    new_data = None

    for i, node in enumerate(nodes):
        node_data = node.get("data", {})
        if node_data.get("type") != CanvasNodeType.TEXT:
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
    """Parse ``urn:uniffy:content:{TYPE}:{uuid}``; ``None`` on malformed / unknown type."""
    if not urn or not urn.startswith(CONTENT_URN_PREFIX):
        return None

    remainder = urn[len(CONTENT_URN_PREFIX) :]
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
