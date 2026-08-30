"""``RealtimeContentAdapter`` for ``ContentType.NOTE``: markdown + canvas."""

from typing import Any
from uuid import UUID

import pycrdt
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.models.notes.note import Note
from uniffy.core.realtime.adapter import register_realtime_adapter
from uniffy.core.search import SearchIndexer
from uniffy.core.types import ContentRole, ContentType, NodeType
from uniffy.domains.notes.operations import NoteOperations

LOGGER_COMPONENT = "realtime.notes_adapter"

# Per-node text fields stored as ``Y.Text``; mirrors ``NODE_TEXT_FIELDS``
# in the frontend ``canvasBinding.ts`` and must stay in lockstep.
_NODE_TEXT_FIELDS: dict[str, str] = {
    "text": "content",
    "shape": "label",
    "mindmap": "label",
}


class NoteRealtimeAdapter:
    """Realtime adapter for notes and canvases."""

    content_type = ContentType.NOTE

    def __init__(self, search_indexer: SearchIndexer) -> None:
        self.search_indexer = search_indexer

    async def authorize(
        self,
        session: AsyncSession,
        user_id: UUID,
        organization_id: UUID,
        content_id: UUID,
    ) -> ContentRole | None:
        note = (
            await session.execute(
                select(Note).where(
                    Note.id == content_id,
                    Note.organization_id == organization_id,
                )
            )
        ).scalar_one_or_none()
        if note is None or note.is_deleted:
            return None

        return await PermissionChecker(session).effective_role(
            user_id=user_id,
            organization_id=organization_id,
            content_type=ContentType.NOTE,
            content_id=content_id,
            owner_id=note.owner_id,
            access_mode=note.access_mode,
            baseline_role=note.baseline_role,
        )

    async def hydrate_ydoc(
        self,
        session: AsyncSession,
        ydoc: pycrdt.Doc,
        content_id: UUID,
        organization_id: UUID,
    ) -> None:
        note = (
            await session.execute(
                select(Note).where(
                    Note.id == content_id,
                    Note.organization_id == organization_id,
                )
            )
        ).scalar_one_or_none()
        if note is None:
            return

        if note.node_type == NodeType.CANVAS:
            _seed_canvas_ydoc(ydoc, note.canvas_content)
        else:
            ydoc["markdown"] = pycrdt.Text(note.content or "")

    async def render_and_persist(
        self,
        session: AsyncSession,
        ydoc: pycrdt.Doc,
        content_id: UUID,
        organization_id: UUID,
    ) -> None:
        note = (
            await session.execute(
                select(Note).where(
                    Note.id == content_id,
                    Note.organization_id == organization_id,
                    Note.is_deleted == False,  # noqa: E712
                )
            )
        ).scalar_one_or_none()
        if note is None:
            logger.debug(
                f"snapshot for missing or soft-deleted note {content_id}; skipping render",
                component=LOGGER_COMPONENT,
            )
            return

        if note.node_type == NodeType.CANVAS:
            content = ""
            canvas_content = _render_canvas_content(ydoc)
            # ``None`` here would NULL ``canvas_content`` on disk; skip the write.
            if canvas_content is None:
                logger.debug(
                    f"skipping canvas render for {content_id}: empty YDoc",
                    component=LOGGER_COMPONENT,
                )
                return
        else:
            content = _render_markdown(ydoc)
            canvas_content = None

        await NoteOperations(session, search_indexer=self.search_indexer).realtime_save(
            organization_id=organization_id,
            note_id=content_id,
            content=content,
            canvas_content=canvas_content,
        )

    def apply_external_content(self, ydoc: pycrdt.Doc, content: str) -> bool:
        """Replace ``Y.Text("markdown")`` with a column write from the legacy
        ``UpdateNote`` path. Markdown docs only; canvas writes never publish
        a content replace.
        """
        ytext = ydoc.get("markdown", type=pycrdt.Text)
        if str(ytext) == content:
            return False
        with ydoc.transaction():
            del ytext[:]
            ytext += content
        return True


def register_note_realtime_adapter(search_indexer: SearchIndexer) -> None:
    register_realtime_adapter(NoteRealtimeAdapter(search_indexer))


def _seed_canvas_ydoc(ydoc: pycrdt.Doc, canvas_content: dict[str, Any] | None) -> None:
    """Stamp existing ``canvas_content`` into the doc's Y types on cold start."""
    payload = canvas_content or {}
    raw_nodes = payload.get("nodes") or []
    raw_edges = payload.get("edges") or []
    raw_defaults = payload.get("defaults") or {}

    nodes_map: dict[str, Any] = {}
    order_list: list[str] = []
    for node in raw_nodes:
        if not isinstance(node, dict):
            continue
        node_id = node.get("id")
        if node_id is None:
            continue
        node_id = str(node_id)
        nodes_map[node_id] = _build_node_map(node)
        order_list.append(node_id)

    edges_map: dict[str, Any] = {}
    for edge in raw_edges:
        if not isinstance(edge, dict):
            continue
        edge_id = edge.get("id")
        if edge_id is None:
            continue
        edges_map[str(edge_id)] = pycrdt.Map(dict(edge))

    defaults_map = dict(raw_defaults) if isinstance(raw_defaults, dict) else {}

    ydoc["nodes"] = pycrdt.Map(nodes_map)
    ydoc["edges"] = pycrdt.Map(edges_map)
    ydoc["order"] = pycrdt.Array(order_list)
    ydoc["defaults"] = pycrdt.Map(defaults_map)


def _build_node_map(node: dict[str, Any]) -> pycrdt.Map:
    # Wraps the node's text field as ``pycrdt.Text`` so concurrent typing
    # merges char-by-char. Nodes without a text field pass ``data`` through.
    shell = dict(node)
    raw_data = shell.pop("data", None)
    node_type = node.get("type")
    text_field = _NODE_TEXT_FIELDS.get(node_type) if isinstance(node_type, str) else None
    if not isinstance(raw_data, dict) or text_field is None:
        if isinstance(raw_data, dict):
            shell["data"] = pycrdt.Map(dict(raw_data))
        elif raw_data is not None:
            shell["data"] = raw_data
        return pycrdt.Map(shell)
    data_map: dict[str, Any] = {}
    for key, value in raw_data.items():
        if key == text_field:
            data_map[key] = pycrdt.Text(value if isinstance(value, str) else "")
        else:
            data_map[key] = value
    shell["data"] = pycrdt.Map(data_map)
    return pycrdt.Map(shell)


def _render_markdown(ydoc: pycrdt.Doc) -> str:
    # ``get(..., type=...)`` declares + retrieves so roots seeded purely via
    # ``apply_update`` are read correctly.
    ytext = ydoc.get("markdown", type=pycrdt.Text)
    return str(ytext)


def _render_canvas_content(ydoc: pycrdt.Doc) -> dict[str, Any] | None:
    """Materialise canvas Y types to on-disk shape; ``None`` if doc is empty."""
    nodes = ydoc.get("nodes", type=pycrdt.Map)
    edges = ydoc.get("edges", type=pycrdt.Map)
    order = ydoc.get("order", type=pycrdt.Array)
    defaults = ydoc.get("defaults", type=pycrdt.Map)
    if len(nodes) == 0 and len(edges) == 0 and len(order) == 0 and len(defaults) == 0:
        return None

    nodes_dict = nodes.to_py()
    edges_dict = edges.to_py()
    order_list = [str(node_id) for node_id in order.to_py()]

    # ``order`` is the source of truth for z-order; missing nodes append.
    # Dedupe by id - a stale IDB-persisted ``Y.Array`` merged with the
    # server seed can duplicate ids and crash React's key warnings.
    seen_ids: set[str] = set()
    nodes_array: list[dict[str, Any]] = []
    for node_id in order_list:
        if node_id in seen_ids:
            continue
        node_obj = nodes_dict.get(node_id)
        if isinstance(node_obj, dict):
            seen_ids.add(node_id)
            nodes_array.append(node_obj)
    for node_id, node_obj in nodes_dict.items():
        if node_id in seen_ids:
            continue
        if isinstance(node_obj, dict):
            nodes_array.append(node_obj)

    edges_array: list[dict[str, Any]] = [
        edge_obj for edge_obj in edges_dict.values() if isinstance(edge_obj, dict)
    ]

    content: dict[str, Any] = {
        "version": 1,
        "viewport": {"x": 0, "y": 0, "zoom": 1},
        "nodes": nodes_array,
        "edges": edges_array,
    }
    if len(defaults) > 0:
        content["defaults"] = defaults.to_py()
    return content
