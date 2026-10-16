"""Fragment seed rules shared by lease election and seed acceptance."""

from datetime import UTC, datetime

import pycrdt

from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime.markdown import (
    MARKDOWN_MIRROR_FIELD,
    PROSEMIRROR_FRAGMENT_FIELD,
    markdown_text,
)

_PARAGRAPH_TAG = "paragraph"
_SEED_CLAIM_PREFIX = "seeded_by:"


def has_fragment_content(root: pycrdt.XmlFragment | pycrdt.XmlElement) -> bool:
    # ySyncPlugin can publish an empty paragraph before the assigned client seeds.
    for child in root.children:
        if isinstance(child, pycrdt.XmlText):
            if str(child):
                return True
        elif child.tag != _PARAGRAPH_TAG or has_fragment_content(child):
            return True
    return False


def seed_allowed(
    row: RealtimeYjsSnapshot,
    before: pycrdt.Doc,
    after: pycrdt.Doc,
    *,
    owner: str | None,
    token: str | None,
    base: str | None,
) -> bool:
    """Only the live lease holder adds a seed claim, onto an empty fragment over unchanged source."""
    previous = before.get(MARKDOWN_MIRROR_FIELD, type=pycrdt.Map)
    claimed = any(
        key.startswith(_SEED_CLAIM_PREFIX) and key not in previous
        for key in after.get(MARKDOWN_MIRROR_FIELD, type=pycrdt.Map)
    )
    if owner is None:
        return not claimed
    return (
        row.seed_owner == owner
        and row.seed_expires_at is not None
        and row.seed_expires_at > datetime.now(UTC)
        and row.seed_expires_at.isoformat() == token
        and str(markdown_text(before)) == base
        and str(markdown_text(after)) == base
        and claimed
        and not has_fragment_content(before.get(PROSEMIRROR_FRAGMENT_FIELD, type=pycrdt.XmlFragment))
    )
