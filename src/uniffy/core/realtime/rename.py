"""Rename labels inside committed CRDT state without replacing its generation."""

from datetime import UTC, datetime
from uuid import UUID

import pycrdt
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.content.references import replace_mention_label
from uniffy.core.realtime.markdown import markdown_text, replace_external_markdown
from uniffy.core.realtime.merge import text_edits
from uniffy.core.realtime.state import DocKey
from uniffy.core.realtime.storage import decode_snapshot, load_snapshot


async def stage_mention_rename(
    db: AsyncSession, key: DocKey, organization_id: UUID, urn: str, label: str
) -> bool:
    snapshot = await load_snapshot(db, key)
    if snapshot is None or snapshot.organization_id != organization_id:
        return False
    doc = decode_snapshot(snapshot)
    before = doc.get_state()
    changed = replace_external_markdown(
        doc, replace_mention_label(str(markdown_text(doc)), urn, label)
    )
    nodes = doc.get("nodes", type=pycrdt.Map)
    for node in nodes.values():
        if not isinstance(node, pycrdt.Map):
            continue
        data = node.get("data")
        if not isinstance(data, pycrdt.Map):
            continue
        for field in ("content", "label"):
            value = data.get(field)
            if not isinstance(value, (str, pycrdt.Text)):
                continue
            source = str(value)
            renamed = replace_mention_label(source, urn, label)
            if renamed == source:
                continue
            changed = True
            if isinstance(value, str):
                data[field] = renamed
                continue
            for a1, a2, b1, b2 in reversed(text_edits(source, renamed)):
                start = len(source[:a1].encode())
                if a2 > a1:
                    del value[start : len(source[:a2].encode())]
                if b2 > b1:
                    value.insert(start, renamed[b1:b2])
    if changed:
        snapshot.updates = pycrdt.merge_updates(snapshot.updates, doc.get_update(before))
        snapshot.state_vector = doc.get_state()
        snapshot.revision += 1
        snapshot.updated_at = datetime.now(UTC)
    return changed
