"""Content-derived note fields and search text."""

import re
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from uniffy.core.content.references import (
    CanvasNodeType,
    extract_all_outgoing_references,
    extract_all_outgoing_references_from_canvas,
)
from uniffy.core.types import ContentType, NodeType
from uniffy.domains.notes import queries

_MENTION_ESCAPED_RE = re.compile(r"\\?\[\\?\[\\?\[([^\[\]|]+)\|[^\]]+\\?\]\\?\]\\?\]")
_MENTION_RE = re.compile(r"\[\[\[([^\[\]|]+)\|[^\]]+\]\]\]")
_IMAGE_RE = re.compile(r"!\[([^\]]*)\]\([^)]+\)")
_LINK_RE = re.compile(r"\[([^\]]+)\]\([^)]+\)")
_HTML_TAG_RE = re.compile(r"<[^>]+>")
_FENCED_CODE_RE = re.compile(r"```[\s\S]*?```")
_INLINE_CODE_RE = re.compile(r"`([^`]+)`")
_HEADER_RE = re.compile(r"^#{1,6}\s+", re.MULTILINE)
_BOLD_STAR_RE = re.compile(r"\*\*([^*]+)\*\*")
_ITALIC_STAR_RE = re.compile(r"\*([^*]+)\*")
_BOLD_UNDER_RE = re.compile(r"__([^_]+)__")
_ITALIC_UNDER_RE = re.compile(r"_([^_]+)_")
_STRIKE_RE = re.compile(r"~~([^~]+)~~")
_BLOCKQUOTE_RE = re.compile(r"^>\s+", re.MULTILINE)
_UL_MARKER_RE = re.compile(r"^[\s]*[-*+]\s+", re.MULTILINE)
_OL_MARKER_RE = re.compile(r"^[\s]*\d+\.\s+", re.MULTILINE)
_TABLE_SEP_RE = re.compile(
    r"^\|?[\s:]*[-]{2,}[\s:]*(\|[\s:]*[-]{2,}[\s:]*)*\|?\s*$",
    re.MULTILINE,
)
_HR_RE = re.compile(r"^[-*_]{3,}\s*$", re.MULTILINE)
_WS_RE = re.compile(r"\s+")
_FILE_URN_PREFIX = f"urn:uniffy:content:{ContentType.FILE.value}:"


@dataclass(frozen=True)
class NoteContentFields:
    content: str
    canvas_content: dict[str, Any] | None
    outgoing_references: list[str] | None
    parsed_inline_tag_names: list[str]


def strip_markdown(text: str) -> str:
    """Return plain text while preserving mention labels."""
    if not text:
        return ""
    stripped = _MENTION_ESCAPED_RE.sub(r"\1", text)
    stripped = _MENTION_RE.sub(r"\1", stripped)
    stripped = _IMAGE_RE.sub(r"\1", stripped)
    stripped = _LINK_RE.sub(r"\1", stripped)
    stripped = _HTML_TAG_RE.sub(" ", stripped)
    stripped = _FENCED_CODE_RE.sub(" ", stripped)
    stripped = _INLINE_CODE_RE.sub(r"\1", stripped)
    stripped = _HEADER_RE.sub("", stripped)
    stripped = _BOLD_STAR_RE.sub(r"\1", stripped)
    stripped = _ITALIC_STAR_RE.sub(r"\1", stripped)
    stripped = _BOLD_UNDER_RE.sub(r"\1", stripped)
    stripped = _ITALIC_UNDER_RE.sub(r"\1", stripped)
    stripped = _STRIKE_RE.sub(r"\1", stripped)
    stripped = _BLOCKQUOTE_RE.sub("", stripped)
    stripped = _UL_MARKER_RE.sub("", stripped)
    stripped = _OL_MARKER_RE.sub("", stripped)
    stripped = _TABLE_SEP_RE.sub("", stripped)
    stripped = stripped.replace("|", " ")
    stripped = _HR_RE.sub("", stripped)
    return _WS_RE.sub(" ", stripped).strip()


def extract_canvas_text(canvas_data: dict) -> list[str]:
    texts: list[str] = []
    for node in canvas_data.get("nodes", []):
        node_data = node.get("data", {})
        kind = node_data.get("type", "")
        if kind == CanvasNodeType.TEXT:
            content = node_data.get("content", "")
            if content:
                texts.append(content)
        elif kind in ("shape", "mindmap"):
            label = node_data.get("label", "")
            if label:
                texts.append(label)
    return texts


def extract_content_fields(
    node_type: NodeType,
    content: str,
    canvas_content: dict[str, Any] | None,
    organization_id: UUID,
) -> NoteContentFields:
    if node_type == NodeType.CANVAS:
        outgoing = (
            extract_all_outgoing_references_from_canvas(canvas_content, organization_id)
            if canvas_content
            else None
        ) or None
        parsed = queries.extract_inline_tags_from_canvas(canvas_content) if canvas_content else []
        return NoteContentFields("", canvas_content, outgoing, parsed)

    outgoing = (
        extract_all_outgoing_references(content, organization_id) if content else None
    ) or None
    parsed = queries.extract_inline_tags_from_content(content) if content else []
    return NoteContentFields(content, None, outgoing, parsed)


def referenced_file_ids(outgoing_references: list[str] | None) -> set[UUID]:
    ids: set[UUID] = set()
    for urn in outgoing_references or []:
        if not urn.startswith(_FILE_URN_PREFIX):
            continue
        try:
            ids.add(UUID(urn[len(_FILE_URN_PREFIX) :]))
        except ValueError:
            continue
    return ids
