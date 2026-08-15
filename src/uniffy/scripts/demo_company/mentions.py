"""Cross-domain mention resolution for demo content.

Content authors write ordinary markdown links and this module turns them into
`[[[label|urn]]]` mentions once every seeded row has an id:

    [Patient Intake SOP](patient-intake-sop.md)          -> NOTE mention
    [Rila](room:Rila)                                    -> ROOM mention
    [reference ranges](file:Clinical/ranges.csv)         -> FILE mention
    [Lab QA review](event:Lab QA review)                 -> CALENDAR_EVENT mention
    [Maria Nikolova](user:maria@uniffy.io)               -> USER mention
"""

from __future__ import annotations

import re
from uuid import UUID

from loguru import logger

from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import ContentType

logger = logger.bind(component="scripts.demo_company.mentions")

NOTE = "note"
ROOM = "room"
FILE = "file"
EVENT = "event"
USER = "user"

CONTENT_TYPE_BY_KIND: dict[str, ContentType] = {
    NOTE: ContentType.NOTE,
    ROOM: ContentType.ROOM,
    FILE: ContentType.FILE,
    EVENT: ContentType.CALENDAR_EVENT,
    USER: ContentType.USER,
}

_KINDS = "|".join(CONTENT_TYPE_BY_KIND)
LINK_PATTERN = re.compile(rf"\[([^\]]+)\]\(((?:{_KINDS}):[^)]+|[^):]+\.md)\)")


class MentionRegistry:
    """Maps `kind:key` content references to URNs as rows are seeded."""

    def __init__(self) -> None:
        self._urns: dict[str, str] = {}

    def register(self, kind: str, key: str, content_id: UUID) -> None:
        content_type = CONTENT_TYPE_BY_KIND[kind]
        self._urns[f"{kind}:{key}"] = build_content_urn(content_type, content_id)

    def resolve(self, target: str) -> str | None:
        key = target if ":" in target else f"{NOTE}:{target}"  # noqa: PLR2004
        return self._urns.get(key)

    def rewrite(self, text: str, *, source: str) -> str:
        """Replace resolvable links with mentions; unknown targets stay as-is."""
        if not text:
            return text

        def replace(match: re.Match[str]) -> str:
            label, target = match.group(1), match.group(2)
            urn = self.resolve(target)
            if urn is None:
                logger.warning(f"{source}: mention target {target!r} is not in this content set")
                return match.group(0)
            return f"[[[{label}|{urn}]]]"

        return LINK_PATTERN.sub(replace, text)
