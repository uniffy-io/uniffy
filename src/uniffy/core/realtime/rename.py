"""Rename mention labels inside live CRDT state without replacing its generation."""

from collections.abc import Iterable
from uuid import UUID

import pycrdt
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.content.references import replace_mention_label
from uniffy.core.realtime.buffer import UpdateBuffer
from uniffy.core.realtime.checkpoint import Enqueue, enqueue_core
from uniffy.core.realtime.live import AfterCommit, load_live_document, stage_live_checkpoint
from uniffy.core.realtime.markdown import markdown_text, replace_external_markdown
from uniffy.core.realtime.merge import text_edits
from uniffy.core.realtime.state import DocKey

# Documents one rename transaction locks at most; larger candidate sets commit in batches.
RENAME_BATCH_DOCUMENTS = 100


def rename_batches(keys: Iterable[DocKey]) -> list[list[DocKey]]:
    """Batches for one transaction each, in the order ``lock_documents`` takes their locks."""
    ordered = sorted(set(keys), key=lambda key: (key[0].value, str(key[1])))
    return [
        ordered[start : start + RENAME_BATCH_DOCUMENTS]
        for start in range(0, len(ordered), RENAME_BATCH_DOCUMENTS)
    ]


def _rename_canvas_text(doc: pycrdt.Doc, urn: str, label: str) -> bool:
    changed = False
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
    return changed


async def stage_mention_rename(
    buffer: UpdateBuffer,
    db: AsyncSession,
    key: DocKey,
    organization_id: UUID,
    urn: str,
    label: str,
    *,
    enqueue: Enqueue = enqueue_core,
) -> AfterCommit | None:
    """Rename ``urn`` labels in live state under the caller's lock; ``None`` when none changed.

    The rename commits as the checkpoint covering the buffered tail, so pending edits survive
    and projection renders the result after the commit.
    """
    live = await load_live_document(buffer, db, key)
    if live is None or live.row.organization_id != organization_id:
        return None
    doc = live.decode()
    before = doc.get_state()
    changed = replace_external_markdown(
        doc, replace_mention_label(str(markdown_text(doc)), urn, label)
    )
    if not _rename_canvas_text(doc, urn, label) and not changed:
        return None
    return await stage_live_checkpoint(
        buffer,
        db,
        live,
        organization_id,
        pycrdt.merge_updates(live.updates, doc.get_update(before)),
        actor_id=live.tail[-1].actor_id if live.tail else live.row.actor_id,
        project=True,
        enqueue=enqueue,
    )
