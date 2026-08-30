"""Unit tests for the notes <-> tags wiring.

Covers the pure-Python pieces that don't require a live DB:

- ``NoteOperations._extract_content_fields`` returns parsed inline tag
  names from markdown / canvas content for ``sync_inline_tags`` to
  reconcile.
- ``NoteOperations._build_search_keywords`` does not emit per-tag tokens
  (the dedicated tag-assignment table is the source of truth).
- ``TagOperations.replace_manual_tags`` reconciles desired vs current
  manual assignments by calling ``unassign`` on the diff out and
  ``assign`` on the diff in.

Live-DB integration coverage runs under the notes-domain harness.
"""

from unittest.mock import AsyncMock, MagicMock, patch

from uniffy.core.models.notes.note import Note
from uniffy.core.models.tags.tag import TagAssignment
from uniffy.core.types import NodeType, generate_id
from uniffy.domains.notes.operations import NoteOperations
from uniffy.domains.tags.operations import (
    SOURCE_INLINE,
    SOURCE_MANUAL,
    TagOperations,
)


def _make_note(*, content: str = "", canvas: dict | None = None) -> Note:
    return Note(
        organization_id=generate_id(),
        owner_id=generate_id(),
        node_type=NodeType.CANVAS if canvas is not None else NodeType.NOTE,
        title="t",
        content=content,
        canvas_content=canvas,
        slug="t",
    )


def _make_ops() -> NoteOperations:
    session = MagicMock()
    ops = NoteOperations.__new__(NoteOperations)
    ops.session = session
    return ops


class TestExtractContentFields:
    def test_markdown_content_yields_parsed_inline_names(self) -> None:
        ops = _make_ops()
        fields = ops._extract_content_fields(
            NodeType.NOTE,
            "Hello [[[tag|design-review]]] and [[[tag|launch]]] today",
            None,
            generate_id(),
        )
        assert fields.parsed_inline_tag_names == ["design-review", "launch"]
        assert fields.canvas_content is None

    def test_canvas_content_yields_parsed_inline_names(self) -> None:
        ops = _make_ops()
        canvas = {
            "nodes": [
                {"data": {"type": "text", "content": "todo [[[tag|focus]]]"}},
                {"data": {"type": "text", "content": "[[[tag|focus]]] still"}},
            ]
        }
        fields = ops._extract_content_fields(NodeType.CANVAS, "", canvas, generate_id())
        assert fields.parsed_inline_tag_names == ["focus"]
        assert fields.canvas_content == canvas

    def test_empty_content_yields_no_names(self) -> None:
        ops = _make_ops()
        fields = ops._extract_content_fields(NodeType.NOTE, "", None, generate_id())
        assert fields.parsed_inline_tag_names == []


class TestBuildSearchKeywords:
    def test_keywords_do_not_emit_per_tag_tokens(self) -> None:
        ops = _make_ops()
        note = _make_note(content="body")
        note.title = "Quarterly review"
        out = ops._build_search_keywords(note)
        assert "tag:" not in out
        assert "Quarterly review" in out
        assert "body" in out

    def test_keywords_canvas_extracts_text_nodes(self) -> None:
        ops = _make_ops()
        note = _make_note(
            canvas={
                "nodes": [
                    {"data": {"type": "text", "content": "alpha"}},
                    {"data": {"type": "shape", "label": "beta"}},
                ]
            },
        )
        note.title = "canvas note"
        out = ops._build_search_keywords(note)
        assert "alpha" in out
        assert "beta" in out


class TestReplaceManualTags:
    @staticmethod
    def _make_ops(session) -> TagOperations:
        ops = TagOperations.__new__(TagOperations)
        ops.session = session
        ops._search_indexer = MagicMock()
        return ops

    async def test_diff_emits_combined_event(self) -> None:
        org_id = generate_id()
        actor_id = generate_id()
        urn = f"urn:uniffy:content:NOTE:{generate_id().hex}"

        keep_id = generate_id()
        drop_id = generate_id()
        add_id = generate_id()

        existing = [
            TagAssignment(
                tag_id=keep_id,
                content_urn=urn,
                content_type="NOTE",
                sources=[SOURCE_MANUAL],
                assigned_by=actor_id,
            ),
            TagAssignment(
                tag_id=drop_id,
                content_urn=urn,
                content_type="NOTE",
                sources=[SOURCE_MANUAL],
                assigned_by=actor_id,
            ),
            TagAssignment(
                tag_id=generate_id(),
                content_urn=urn,
                content_type="NOTE",
                sources=[SOURCE_INLINE],
                assigned_by=actor_id,
            ),
        ]

        session = MagicMock()
        session.commit = AsyncMock()
        session.add = MagicMock()
        session.execute = AsyncMock(return_value=MagicMock())
        ops = self._make_ops(session)

        ops._fetch_assignments = AsyncMock(side_effect=[existing, existing])
        ops._fetch_tags = AsyncMock(
            return_value=[
                MagicMock(id=keep_id),
                MagicMock(id=add_id),
            ]
        )
        ops._invalidate_counts = AsyncMock()
        ops._reindex_tag_docs = AsyncMock(return_value={})

        with patch("uniffy.domains.tags.operations.publish_tag_event", AsyncMock()) as publish_mock:
            await ops.replace_manual_tags(
                actor_id=actor_id,
                organization_id=org_id,
                content_urn=urn,
                tag_ids=[keep_id, add_id],
            )

        publish_mock.assert_awaited_once()
        event_kwargs = publish_mock.await_args.args
        assert event_kwargs[1] == "tag.assignment.changed"
        payload = event_kwargs[2]
        assert payload["added"] == [str(add_id)]
        assert payload["removed"] == [str(drop_id)]
        assert payload["source"] == SOURCE_MANUAL

        ops._reindex_tag_docs.assert_awaited_once()
        affected_ids = set(ops._reindex_tag_docs.await_args.args[1])
        assert affected_ids == {drop_id, add_id}

    async def test_no_change_skips_writes(self) -> None:
        org_id = generate_id()
        actor_id = generate_id()
        urn = f"urn:uniffy:content:NOTE:{generate_id().hex}"
        tag_id = generate_id()
        existing = [
            TagAssignment(
                tag_id=tag_id,
                content_urn=urn,
                content_type="NOTE",
                sources=[SOURCE_MANUAL],
                assigned_by=actor_id,
            )
        ]

        session = MagicMock()
        session.commit = AsyncMock()
        session.add = MagicMock()
        session.execute = AsyncMock()
        ops = self._make_ops(session)
        ops._fetch_assignments = AsyncMock(side_effect=[existing, existing])
        ops._fetch_tags = AsyncMock(return_value=[MagicMock(id=tag_id)])
        ops._invalidate_counts = AsyncMock()
        ops._reindex_tag_docs = AsyncMock(return_value={})

        with patch("uniffy.domains.tags.operations.publish_tag_event", AsyncMock()) as publish_mock:
            await ops.replace_manual_tags(
                actor_id=actor_id,
                organization_id=org_id,
                content_urn=urn,
                tag_ids=[tag_id],
            )

        publish_mock.assert_not_awaited()
        session.commit.assert_not_awaited()

    async def test_clearing_only_drops_manual_source(self) -> None:
        org_id = generate_id()
        actor_id = generate_id()
        urn = f"urn:uniffy:content:NOTE:{generate_id().hex}"
        tag_id = generate_id()
        inline_only_id = generate_id()
        existing = [
            TagAssignment(
                tag_id=tag_id,
                content_urn=urn,
                content_type="NOTE",
                sources=[SOURCE_MANUAL, SOURCE_INLINE],
                assigned_by=actor_id,
            ),
            TagAssignment(
                tag_id=inline_only_id,
                content_urn=urn,
                content_type="NOTE",
                sources=[SOURCE_INLINE],
                assigned_by=actor_id,
            ),
        ]

        session = MagicMock()
        session.commit = AsyncMock()
        session.add = MagicMock()
        session.execute = AsyncMock()
        ops = self._make_ops(session)
        ops._fetch_assignments = AsyncMock(side_effect=[existing, existing])
        ops._fetch_tags = AsyncMock(return_value=[])
        ops._invalidate_counts = AsyncMock()
        ops._reindex_tag_docs = AsyncMock(return_value={})

        with patch("uniffy.domains.tags.operations.publish_tag_event", AsyncMock()) as publish_mock:
            await ops.replace_manual_tags(
                actor_id=actor_id,
                organization_id=org_id,
                content_urn=urn,
                tag_ids=[],
            )

        publish_mock.assert_awaited_once()
        payload = publish_mock.await_args.args[2]
        assert payload["removed"] == []
        assert payload["added"] == []
        assert existing[0].sources == [SOURCE_INLINE]
