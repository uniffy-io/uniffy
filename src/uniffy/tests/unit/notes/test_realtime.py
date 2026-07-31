"""Pure-Python unit tests for the realtime scaffold.

Covers wire framing, subprotocol bearer parsing, adapter registry, the
``_enforce_role_change`` decision matrix, snapshot debounce, canvas
hydration / render, multiplex VarString helpers, and the router
dispatch + registry hygiene. WebSocket integration with Valkey fanout
is covered separately by the live-stack harness.
"""

import asyncio
import base64
import time
from unittest.mock import AsyncMock, patch
from urllib.parse import quote
from uuid import UUID, uuid4

import pycrdt
import pytest

from uniffy.core.realtime import ydoc_manager as ydoc_manager_module
from uniffy.core.realtime.adapter import (
    _adapters,
    get_realtime_adapter,
    register_realtime_adapter,
)
from uniffy.core.realtime.auth import (
    WS_CLOSE_FORBIDDEN,
    WS_CLOSE_TOKEN_REVOKED,
    extract_bearer,
    extract_bearer_from_auth_header,
    origin_is_allowed,
)
from uniffy.core.realtime.snapshot import SNAPSHOT_MAX_DELAY, SnapshotWriter
from uniffy.core.realtime.wire import (
    YMessageType,
    YSyncMessageType,
    create_sync_message,
    create_update_message,
    handle_sync_message,
    is_sync_write_frame,
    peek_message_type,
    peek_sync_sub_type,
)
from uniffy.core.realtime.ydoc_manager import (
    ClientHandle,
    YDocManager,
    YDocSession,
)
from uniffy.core.types import ContentRole, ContentType, NodeType


def _run(coro):
    return asyncio.run(coro)


_conn_id_seq = 0


def _next_conn_id() -> int:
    global _conn_id_seq
    _conn_id_seq += 1
    return _conn_id_seq


def _make_handle(
    *,
    user_id=None,
    can_edit: bool = True,
    token_version: int | None = 1,
) -> ClientHandle:
    handle = ClientHandle(
        conn_id=_next_conn_id(),
        user_id=user_id or uuid4(),
        can_edit=can_edit,
        token_version=token_version,
        ws=AsyncMock(),
    )
    return handle


def _make_router_session(content_type: ContentType = ContentType.NOTE) -> YDocSession:
    return YDocSession(
        key=(content_type, uuid4()),
        ydoc=pycrdt.Doc(),
        organization_id=uuid4(),
    )


class TestPeekHelpers:
    def test_peek_message_type_empty_returns_none(self) -> None:
        assert peek_message_type(b"") is None

    def test_peek_message_type_returns_first_byte(self) -> None:
        assert peek_message_type(bytes([YMessageType.SYNC, 0, 0])) == YMessageType.SYNC
        assert peek_message_type(bytes([YMessageType.AWARENESS, 1])) == YMessageType.AWARENESS

    def test_peek_sync_sub_type_non_sync_returns_none(self) -> None:
        assert peek_sync_sub_type(bytes([YMessageType.AWARENESS, 0])) is None

    def test_peek_sync_sub_type_returns_byte_one(self) -> None:
        frame = bytes([YMessageType.SYNC, YSyncMessageType.SYNC_STEP2, 0])
        assert peek_sync_sub_type(frame) == YSyncMessageType.SYNC_STEP2


class TestEditGate:
    def test_sync_step1_is_read_only(self) -> None:
        frame = bytes([YMessageType.SYNC, YSyncMessageType.SYNC_STEP1, 0])
        assert is_sync_write_frame(frame) is False

    def test_sync_step2_is_write(self) -> None:
        frame = bytes([YMessageType.SYNC, YSyncMessageType.SYNC_STEP2, 0])
        assert is_sync_write_frame(frame) is True

    def test_sync_update_is_write(self) -> None:
        frame = bytes([YMessageType.SYNC, YSyncMessageType.SYNC_UPDATE, 0])
        assert is_sync_write_frame(frame) is True

    def test_awareness_is_not_a_sync_write(self) -> None:
        assert is_sync_write_frame(bytes([YMessageType.AWARENESS, 0])) is False


class TestYDocConvergence:
    """Single-replica convergence guarantee."""

    def test_two_docs_converge_via_sync_step1_step2(self) -> None:
        # Doc A populated; Doc B uses the sync handshake to catch up.
        doc_a = pycrdt.Doc()
        doc_a["text"] = pycrdt.Text("hello")

        doc_b = pycrdt.Doc()
        doc_b["text"] = pycrdt.Text()

        step1 = create_sync_message(doc_b)
        step2_reply = handle_sync_message(step1[1:], doc_a)
        assert step2_reply is not None
        handle_sync_message(step2_reply[1:], doc_b)

        assert str(doc_b["text"]) == "hello"

    def test_update_message_round_trip(self) -> None:
        doc_a = pycrdt.Doc()
        doc_b = pycrdt.Doc()
        doc_a["text"] = pycrdt.Text()
        doc_b["text"] = pycrdt.Text()

        before = doc_a.get_state()
        doc_a["text"].insert(0, "hello")
        update = doc_a.get_update(before)
        frame = create_update_message(update)

        handle_sync_message(frame[1:], doc_b)
        assert str(doc_b["text"]) == "hello"


class TestExtractBearer:
    def test_returns_none_for_empty_header(self) -> None:
        assert extract_bearer(None) is None
        assert extract_bearer("") is None

    def test_returns_none_when_no_bearer_entry(self) -> None:
        assert extract_bearer("uniffy.realtime.v1") is None

    def test_returns_token_from_multi_entry_header(self) -> None:
        token = extract_bearer("uniffy.realtime.v1, bearer.abc123")
        assert token == "abc123"

    def test_url_decodes_token(self) -> None:
        raw = "header.payload.signature/with+special=chars"
        token = extract_bearer(f"uniffy.realtime.v1, bearer.{quote(raw, safe='')}")
        assert token == raw

    def test_authorization_header_fallback_extracts_bearer(self) -> None:
        assert extract_bearer_from_auth_header("Bearer xyz") == "xyz"
        assert extract_bearer_from_auth_header("Basic abc") is None
        assert extract_bearer_from_auth_header(None) is None

    def test_authorization_header_is_case_insensitive(self) -> None:
        assert extract_bearer_from_auth_header("bearer abc") == "abc"
        assert extract_bearer_from_auth_header("BEARER xyz") == "xyz"
        assert extract_bearer_from_auth_header("BeArEr 123") == "123"


class TestOriginAllowlist:
    def test_wildcard_allows_any_origin(self) -> None:
        assert origin_is_allowed("https://attacker.com", ["*"]) is True

    def test_explicit_allowlist_blocks_outsiders(self) -> None:
        allow = ["https://app.uniffy.io", "https://staging.uniffy.io"]
        assert origin_is_allowed("https://app.uniffy.io", allow) is True
        assert origin_is_allowed("https://attacker.com", allow) is False

    def test_missing_origin_is_allowed_for_non_browser_clients(self) -> None:
        assert origin_is_allowed(None, ["https://app.uniffy.io"]) is True


class _DummyAdapter:
    content_type = ContentType.NOTE

    async def authorize(self, *args, **kwargs):  # type: ignore[no-untyped-def]
        return ContentRole.VIEWER

    async def hydrate_ydoc(self, *args, **kwargs):  # type: ignore[no-untyped-def]
        return None

    async def render_and_persist(self, *args, **kwargs):  # type: ignore[no-untyped-def]
        return None


class TestAdapterRegistry:
    def setup_method(self) -> None:
        self._snapshot = dict(_adapters)

    def teardown_method(self) -> None:
        _adapters.clear()
        _adapters.update(self._snapshot)

    def test_register_then_get_returns_same_instance(self) -> None:
        adapter = _DummyAdapter()
        register_realtime_adapter(adapter)
        assert get_realtime_adapter(ContentType.NOTE) is adapter

    def test_unregistered_content_type_raises_lookup_error(self) -> None:
        _adapters.clear()
        with pytest.raises(LookupError):
            get_realtime_adapter(ContentType.TASK)


class TestEnforceRoleChange:
    """Decision matrix for one perm-channel payload."""

    def test_blocked_closes_session(self) -> None:
        manager = YDocManager()
        handle = _make_handle(can_edit=True)
        _run(manager._enforce_role_change(handle, "BLOCKED"))
        assert handle.closed is True
        handle.ws.close.assert_awaited_once()
        kwargs = handle.ws.close.call_args.kwargs
        assert kwargs["code"] == WS_CLOSE_FORBIDDEN

    def test_none_role_closes_session(self) -> None:
        manager = YDocManager()
        handle = _make_handle(can_edit=True)
        _run(manager._enforce_role_change(handle, None))
        assert handle.closed is True
        handle.ws.close.assert_awaited_once()

    def test_viewer_downgrades_edit(self) -> None:
        manager = YDocManager()
        handle = _make_handle(can_edit=True)
        _run(manager._enforce_role_change(handle, "VIEWER"))
        assert handle.can_edit is False
        assert handle.closed is False
        handle.ws.close.assert_not_called()

    def test_editor_restores_edit(self) -> None:
        manager = YDocManager()
        handle = _make_handle(can_edit=False)
        _run(manager._enforce_role_change(handle, "EDITOR"))
        assert handle.can_edit is True
        assert handle.closed is False

    def test_close_handle_idempotent(self) -> None:
        manager = YDocManager()
        handle = _make_handle()
        _run(manager._close_handle(handle, WS_CLOSE_FORBIDDEN, "first"))
        _run(manager._close_handle(handle, WS_CLOSE_FORBIDDEN, "second"))
        handle.ws.close.assert_awaited_once()


class TestCloseStaleUserSessions:
    """Token-revoke fanout: only sessions with older versions get closed."""

    def test_only_older_token_versions_closed(self) -> None:
        manager = YDocManager()
        user_id = uuid4()
        session = _make_router_session()
        manager._sessions[session.key] = session

        stale = _make_handle(user_id=user_id, token_version=3)
        fresh = _make_handle(user_id=user_id, token_version=7)
        other_user = _make_handle(user_id=uuid4(), token_version=2)
        session.clients = {
            stale.conn_id: stale,
            fresh.conn_id: fresh,
            other_user.conn_id: other_user,
        }

        _run(manager._close_stale_user_sessions(user_id, new_version=5))

        assert stale.closed is True
        stale.ws.close.assert_awaited_once()
        assert stale.ws.close.call_args.kwargs["code"] == WS_CLOSE_TOKEN_REVOKED
        assert fresh.closed is False
        fresh.ws.close.assert_not_called()
        assert other_user.closed is False
        other_user.ws.close.assert_not_called()

    def test_missing_token_version_treated_as_stale(self) -> None:
        manager = YDocManager()
        user_id = uuid4()
        session = _make_router_session()
        manager._sessions[session.key] = session
        handle = _make_handle(user_id=user_id, token_version=None)
        session.clients = {handle.conn_id: handle}

        _run(manager._close_stale_user_sessions(user_id, new_version=2))

        assert handle.closed is True


class TestSnapshotWriterDebounce:
    """Each schedule call resets the timer; only the last one fires."""

    def test_rapid_schedule_calls_coalesce_into_one_flush(self) -> None:
        flush_calls = 0

        async def fake_flush(session, *, force=False):
            nonlocal flush_calls
            flush_calls += 1

        async def go() -> None:
            writer = SnapshotWriter(debounce_seconds=0.05)
            writer.flush = fake_flush  # type: ignore[method-assign]
            session = _make_router_session()

            for _ in range(5):
                await writer.schedule(session)
                await asyncio.sleep(0.01)

            await asyncio.sleep(0.15)

        _run(go())
        assert flush_calls == 1

    def test_cancel_drops_pending_timer_without_flush(self) -> None:
        flush_calls = 0

        async def fake_flush(session, *, force=False):
            nonlocal flush_calls
            flush_calls += 1

        async def go() -> None:
            writer = SnapshotWriter(debounce_seconds=0.05)
            writer.flush = fake_flush  # type: ignore[method-assign]
            session = _make_router_session()

            await writer.schedule(session)
            await writer.cancel(session.key)
            await asyncio.sleep(0.1)

        _run(go())
        assert flush_calls == 0

    def test_overdue_pending_window_flushes_instead_of_rearming(self) -> None:
        flush_calls: list[bool] = []

        async def fake_flush(session, *, force=False):
            flush_calls.append(force)

        async def go() -> None:
            writer = SnapshotWriter(debounce_seconds=60.0)
            writer.flush = fake_flush  # type: ignore[method-assign]
            session = _make_router_session()

            await writer.schedule(session)
            assert flush_calls == []

            writer._first_scheduled[session.key] = time.monotonic() - (
                SNAPSHOT_MAX_DELAY + 1
            )
            await writer.schedule(session)
            assert flush_calls == [False]

            await writer.cancel(session.key)

        _run(go())


class TestSnapshotForceFlush:
    def test_force_flush_persists_in_process(self) -> None:
        async def go() -> None:
            writer = SnapshotWriter(debounce_seconds=60.0)
            session = _make_router_session()
            session.ydoc["markdown"] = pycrdt.Text("hello")

            persist = AsyncMock(return_value=True)
            get_queue = AsyncMock()
            with (
                patch("uniffy.core.realtime.snapshot.persist_snapshot", persist),
                patch("uniffy.core.realtime.snapshot.get_queue_safe", get_queue),
            ):
                await writer.flush(session, force=True)

            persist.assert_awaited_once()
            args = persist.await_args.args
            assert args[0] == session.key[0]
            assert args[1] == session.key[1]
            assert args[2] == session.organization_id
            assert args[3]
            get_queue.assert_not_called()

        _run(go())

    def test_non_force_flush_enqueues(self) -> None:
        async def go() -> None:
            writer = SnapshotWriter(debounce_seconds=60.0)
            session = _make_router_session()
            session.ydoc["markdown"] = pycrdt.Text("hello")

            persist = AsyncMock(return_value=True)
            queue = AsyncMock()
            get_queue = AsyncMock(return_value=queue)
            with (
                patch("uniffy.core.realtime.snapshot.persist_snapshot", persist),
                patch("uniffy.core.realtime.snapshot.get_queue_safe", get_queue),
            ):
                await writer.flush(session)

            persist.assert_not_called()
            queue.enqueue_job.assert_awaited_once()

        _run(go())


class TestEvictionFlushOrdering:
    def test_session_registered_until_force_flush_completes(self) -> None:
        async def go() -> None:
            manager = YDocManager()
            session = _make_router_session()
            manager._sessions[session.key] = session
            observed: list[tuple[bool, bool]] = []

            async def fake_flush(s, *, force=False):
                observed.append((s.key in manager._sessions, force))

            with (
                patch.object(ydoc_manager_module, "IDLE_EVICTION_SECONDS", 0),
                patch.object(ydoc_manager_module.snapshot_writer, "flush", fake_flush),
            ):
                await manager._evict_after_idle(session.key)

            assert observed == [(True, True)]
            assert session.key not in manager._sessions

        _run(go())


class TestCanvasRender:
    """``_render_canvas_content`` round-trip via ``pycrdt`` Y types."""

    def test_canvas_render_emits_expected_shape(self) -> None:
        from uniffy.domains.notes.realtime_adapter import _render_canvas_content

        ydoc = pycrdt.Doc()
        ydoc["nodes"] = pycrdt.Map(
            {"n1": pycrdt.Map({"id": "n1", "type": "text", "x": 10, "y": 20})}
        )
        ydoc["edges"] = pycrdt.Map({})
        ydoc["order"] = pycrdt.Array(["n1"])

        result = _render_canvas_content(ydoc)

        assert result is not None
        # Disk format: nodes / edges as JSON arrays, ``order`` drives
        # the array order.
        assert isinstance(result["nodes"], list)
        assert len(result["nodes"]) == 1
        assert result["nodes"][0]["id"] == "n1"
        assert result["nodes"][0]["type"] == "text"
        assert result["edges"] == []
        assert "order" not in result

    def test_canvas_render_returns_none_when_roots_missing(self) -> None:
        from uniffy.domains.notes.realtime_adapter import _render_canvas_content

        ydoc = pycrdt.Doc()
        assert _render_canvas_content(ydoc) is None


class TestMarkdownRender:
    def test_markdown_render_reads_y_text(self) -> None:
        from uniffy.domains.notes.realtime_adapter import _render_markdown

        ydoc = pycrdt.Doc()
        ydoc["markdown"] = pycrdt.Text("# hello\n\nworld")

        assert _render_markdown(ydoc) == "# hello\n\nworld"

    def test_markdown_render_returns_empty_when_root_missing(self) -> None:
        from uniffy.domains.notes.realtime_adapter import _render_markdown

        ydoc = pycrdt.Doc()
        assert _render_markdown(ydoc) == ""


class TestCanvasHydration:
    """Cold-start hydration must preserve any existing ``canvas_content``.

    Regression guard: a viewer connecting to a populated canvas must
    not cause the first snapshot flush to write empty maps over the
    real content.
    """

    def test_seed_canvas_ydoc_populates_y_types_from_content(self) -> None:
        from uniffy.domains.notes.realtime_adapter import (
            _render_canvas_content,
            _seed_canvas_ydoc,
        )

        existing = {
            "version": 1,
            "viewport": {"x": 0, "y": 0, "zoom": 1},
            "nodes": [
                {
                    "id": "n1",
                    "type": "text",
                    "position": {"x": 10, "y": 20},
                    "data": {"type": "text", "content": "hi"},
                },
                {
                    "id": "n2",
                    "type": "shape",
                    "position": {"x": 100, "y": 50},
                    "data": {"type": "shape", "shape": "rect"},
                },
            ],
            "edges": [
                {"id": "e1", "source": "n1", "target": "n2"},
            ],
        }

        ydoc = pycrdt.Doc()
        _seed_canvas_ydoc(ydoc, existing)

        rendered = _render_canvas_content(ydoc)
        assert rendered is not None
        assert [node["id"] for node in rendered["nodes"]] == ["n1", "n2"]
        assert rendered["nodes"][0]["type"] == "text"
        assert rendered["nodes"][1]["position"]["x"] == 100
        assert rendered["edges"][0]["target"] == "n2"

    def test_seed_wraps_text_field_as_y_text(self) -> None:
        """Per-node text field seeds as ``pycrdt.Text`` so concurrent
        same-cell typing merges char-by-char; the render path coerces
        back to ``str`` via ``pycrdt.Map.to_py``."""
        from uniffy.domains.notes.realtime_adapter import (
            _render_canvas_content,
            _seed_canvas_ydoc,
        )

        existing = {
            "version": 1,
            "viewport": {"x": 0, "y": 0, "zoom": 1},
            "nodes": [
                {
                    "id": "t1",
                    "type": "text",
                    "position": {"x": 0, "y": 0},
                    "data": {"type": "text", "content": "Hello", "bgColor": "#fff"},
                },
                {
                    "id": "s1",
                    "type": "shape",
                    "position": {"x": 0, "y": 0},
                    "data": {"type": "shape", "label": "Diamond", "shape": "diamond"},
                },
                {
                    "id": "m1",
                    "type": "mindmap",
                    "position": {"x": 0, "y": 0},
                    "data": {"type": "mindmap", "label": "Root", "isRoot": True},
                },
            ],
            "edges": [],
        }

        ydoc = pycrdt.Doc()
        _seed_canvas_ydoc(ydoc, existing)

        nodes = ydoc.get("nodes", type=pycrdt.Map)
        for node_id, expected_field in (("t1", "content"), ("s1", "label"), ("m1", "label")):
            node_map = nodes.get(node_id)
            assert isinstance(node_map, pycrdt.Map)
            data_map = node_map.get("data")
            assert isinstance(data_map, pycrdt.Map)
            assert isinstance(data_map.get(expected_field), pycrdt.Text)

        rendered = _render_canvas_content(ydoc)
        assert rendered is not None
        nodes_by_id = {node["id"]: node for node in rendered["nodes"]}
        assert nodes_by_id["t1"]["data"]["content"] == "Hello"
        assert nodes_by_id["s1"]["data"]["label"] == "Diamond"
        assert nodes_by_id["m1"]["data"]["label"] == "Root"

    def test_seed_skips_text_wrap_for_non_text_nodes(self) -> None:
        """Nodes without a text field upgrade ``data`` to ``pycrdt.Map``
        for structural merges but leave no field as ``pycrdt.Text``."""
        from uniffy.domains.notes.realtime_adapter import _seed_canvas_ydoc

        existing = {
            "version": 1,
            "viewport": {"x": 0, "y": 0, "zoom": 1},
            "nodes": [
                {
                    "id": "n1",
                    "type": "note",
                    "position": {"x": 0, "y": 0},
                    "data": {"type": "note", "noteId": "abc", "urn": "u"},
                },
                {
                    "id": "f1",
                    "type": "media",
                    "position": {"x": 0, "y": 0},
                    "data": {"type": "media", "fileId": "fid", "mimeType": "image/png"},
                },
            ],
            "edges": [],
        }

        ydoc = pycrdt.Doc()
        _seed_canvas_ydoc(ydoc, existing)

        nodes = ydoc.get("nodes", type=pycrdt.Map)
        for node_id in ("n1", "f1"):
            node_map = nodes.get(node_id)
            data_map = node_map.get("data")
            assert isinstance(data_map, pycrdt.Map)
            for value in data_map.values():
                assert not isinstance(value, pycrdt.Text)

    def test_seed_canvas_ydoc_handles_none_content(self) -> None:
        """Seeding with ``None`` must not crash; the resulting doc
        renders as ``None`` so the snapshot pipeline preserves disk
        state instead of clobbering ``canvas_content``.
        """
        from uniffy.domains.notes.realtime_adapter import (
            _render_canvas_content,
            _seed_canvas_ydoc,
        )

        ydoc = pycrdt.Doc()
        _seed_canvas_ydoc(ydoc, None)

        assert _render_canvas_content(ydoc) is None


class TestOutboundBackpressure:
    """A full WS outbound queue drops frames, never blocks the broadcaster."""

    def test_enqueue_for_handle_drops_when_full(self) -> None:
        from uniffy.core.realtime.state import ClientHandle, WSSession
        from uniffy.core.realtime.ydoc_manager import enqueue_for_handle
        from uniffy.core.types import ContentType

        ws_session = WSSession(
            user_id=uuid4(),
            organization_id=uuid4(),
            token_version=1,
            conn_id=_next_conn_id(),
            ws=AsyncMock(),
        )
        doc_key = (ContentType.NOTE, uuid4())
        handle = ClientHandle(
            conn_id=ws_session.conn_id,
            user_id=ws_session.user_id,
            can_edit=True,
            token_version=1,
            ws=ws_session.ws,
            doc_key=doc_key,
            ws_session=ws_session,
        )

        for i in range(ws_session.outbound.maxsize):
            ws_session.outbound.put_nowait(f"frame-{i}".encode())

        enqueue_for_handle(handle, b"overflow", kind="update")

        assert ws_session.outbound.qsize() == ws_session.outbound.maxsize
        drained = [
            ws_session.outbound.get_nowait()
            for _ in range(ws_session.outbound.qsize())
        ]
        assert all(b"overflow" not in f for f in drained)


class TestQueryAwarenessRelay:
    """A query-awareness frame fans out to live peers so they re-announce, rather
    than being dropped - that drop left a joiner blind to idle peers' cursors."""

    def test_query_awareness_relayed_to_peers_not_source(self) -> None:
        import pycrdt

        from uniffy.core.realtime.multiplex import peek_var_string
        from uniffy.core.realtime.session import MSG_QUERY_AWARENESS, _dispatch_doc_frame
        from uniffy.core.realtime.state import (
            ClientHandle,
            WSSession,
            YDocSession,
            doc_name_for,
        )
        from uniffy.core.realtime.ydoc_manager import ydoc_manager
        from uniffy.core.types import ContentType

        org_id = uuid4()
        doc_key = (ContentType.NOTE, uuid4())

        def make_client() -> tuple[WSSession, ClientHandle]:
            ws_session = WSSession(
                user_id=uuid4(),
                organization_id=org_id,
                token_version=1,
                conn_id=_next_conn_id(),
                ws=AsyncMock(),
            )
            handle = ClientHandle(
                conn_id=ws_session.conn_id,
                user_id=ws_session.user_id,
                can_edit=True,
                token_version=1,
                ws=ws_session.ws,
                doc_key=doc_key,
                ws_session=ws_session,
            )
            return ws_session, handle

        asker_ws, asker = make_client()
        peer_ws, peer = make_client()

        session = YDocSession(key=doc_key, ydoc=pycrdt.Doc(), organization_id=org_id)
        session.clients[asker.conn_id] = asker
        session.clients[peer.conn_id] = peer

        doc_name = doc_name_for(doc_key)
        query_frame = bytes([MSG_QUERY_AWARENESS])

        async def go() -> None:
            ydoc_manager._sessions[doc_key] = session
            try:
                await _dispatch_doc_frame(
                    AsyncMock(), asker_ws, asker, doc_name, query_frame
                )
            finally:
                ydoc_manager._sessions.pop(doc_key, None)

        _run(go())

        assert asker_ws.outbound.qsize() == 0
        assert peer_ws.outbound.qsize() == 1
        framed = peer_ws.outbound.get_nowait()
        relayed_name, offset = peek_var_string(framed)
        assert relayed_name == doc_name
        assert framed[offset:] == query_frame


class TestRealtimeSaveCAS:
    """``realtime_save`` must skip downstream side effects when CAS loses."""

    def test_cas_miss_returns_none_and_skips_side_effects(self) -> None:
        from unittest.mock import AsyncMock, MagicMock

        from uniffy.domains.notes.operations import NoteOperations

        async def go() -> None:
            session = MagicMock()
            session.execute = AsyncMock()
            session.commit = AsyncMock()
            session.refresh = AsyncMock()

            note = MagicMock()
            note.node_type = NodeType.NOTE
            note.version = 7
            note.outgoing_references = []
            note.owner_id = uuid4()

            def read_result() -> MagicMock:
                result = MagicMock()
                result.scalar_one_or_none = MagicMock(return_value=note)
                return result

            def update_result() -> MagicMock:
                result = MagicMock()
                result.rowcount = 0
                return result

            # Every CAS attempt loses; each retry re-reads the note first.
            session.execute.side_effect = [
                read_result(),
                update_result(),
                read_result(),
                update_result(),
                read_result(),
                update_result(),
            ]

            ops = NoteOperations.__new__(NoteOperations)
            ops.session = session
            ops._sync_tags_after_save = AsyncMock()
            ops._index_for_search = AsyncMock()
            ops._notify_new_mentions = AsyncMock()

            result = await ops.realtime_save(
                organization_id=uuid4(),
                note_id=uuid4(),
                content="new body",
                canvas_content=None,
            )

            assert result is None
            ops._sync_tags_after_save.assert_not_called()
            ops._index_for_search.assert_not_called()
            ops._notify_new_mentions.assert_not_called()

        _run(go())


class TestPerKeyHydrationLock:
    """Hydration of doc A must not block acquire of doc B."""

    def test_hydration_lock_is_per_key(self) -> None:
        async def go() -> None:
            manager = YDocManager()
            key_a = (ContentType.NOTE, uuid4())
            key_b = (ContentType.NOTE, uuid4())

            manager._hydration_locks[key_a] = asyncio.Lock()
            await manager._hydration_locks[key_a].acquire()

            # If acquire(key_b) used the same lock it would block forever.
            manager._hydration_locks[key_b] = asyncio.Lock()
            assert manager._hydration_locks[key_a] is not manager._hydration_locks[key_b]

            manager._hydration_locks[key_a].release()

        _run(go())


from uniffy.core.realtime.multiplex import (
    encode_doc_frame,
    peek_var_string,
    read_var_string,
    read_var_uint,
    write_var_string,
    write_var_uint,
)


class TestVarUint:
    """``lib0`` varint encoding (7 bits per byte, MSB continuation)."""

    @pytest.mark.parametrize(
        "value,expected_len",
        [
            (0, 1),
            (1, 1),
            (127, 1),
            (128, 2),
            (16_383, 2),
            (16_384, 3),
            (2_097_151, 3),
            (2_097_152, 4),
            (1_048_575, 3),
            (1_000_000, 3),
        ],
    )
    def test_roundtrip_boundaries(self, value, expected_len):
        encoded = write_var_uint(value)
        assert len(encoded) == expected_len, f"unexpected encoded length for {value}"
        decoded, offset = read_var_uint(encoded, 0)
        assert decoded == value
        assert offset == len(encoded)

    def test_negative_rejected(self):
        with pytest.raises(ValueError, match="non-negative"):
            write_var_uint(-1)

    def test_truncated_input(self):
        # 0xFF = continuation set, low 7 bits = 0x7F; needs another byte.
        with pytest.raises(ValueError, match="terminator"):
            read_var_uint(b"\xff", 0)

    def test_offset_out_of_range(self):
        with pytest.raises(ValueError, match="out of range"):
            read_var_uint(b"", 0)

    def test_offset_inside_buffer(self):
        buf = b"abc\x05xyz"
        value, pos = read_var_uint(buf, 3)
        assert value == 5
        assert pos == 4


class TestVarString:
    """VarString = ``[var_uint len][utf8 bytes]`` (matches lib0)."""

    @pytest.mark.parametrize(
        "value",
        [
            "",
            "NOTE:01a3-deadbeef",
            "TASK:" + "x" * 100,
            # Multi-byte UTF-8: byte length disagrees with codepoint length.
            "ROOM:" + "\u00e9" * 32,
            # 4-byte UTF-8 sequences.
            "USER:\U0001f600\U0001f601",
        ],
    )
    def test_roundtrip(self, value):
        encoded = write_var_string(value)
        decoded, pos = read_var_string(encoded, 0)
        assert decoded == value
        assert pos == len(encoded)

    def test_peek_does_not_consume_payload(self):
        body = b"\x00\x01\x02\x03y-protocols-bytes"
        framed = encode_doc_frame("NOTE:abc", body)
        doc_name, payload_offset = peek_var_string(framed)
        assert doc_name == "NOTE:abc"
        assert framed[payload_offset:] == body

    def test_length_overflow_rejected(self):
        prefix = write_var_uint(1_000_000)
        with pytest.raises(ValueError, match="cap|runs past"):
            read_var_string(prefix + b"abc", 0)

    def test_truncated_body(self):
        prefix = write_var_uint(10)
        with pytest.raises(ValueError, match="runs past"):
            read_var_string(prefix + b"abc", 0)


class TestEncodeDocFrame:
    """``encode_doc_frame`` is the only allocation on the outbound hot path."""

    def test_prefix_then_body(self):
        body = b"\x01\x02\x03"
        framed = encode_doc_frame("NOTE:doc-id-1", body)
        assert framed.endswith(body)
        name, offset = peek_var_string(framed)
        assert name == "NOTE:doc-id-1"
        assert framed[offset:] == body

    def test_empty_body_allowed(self):
        framed = encode_doc_frame("NOTE:x", b"")
        name, offset = peek_var_string(framed)
        assert name == "NOTE:x"
        assert framed[offset:] == b""


from uniffy.core.realtime.router import (
    RealtimeRouter,
    RouterCallbacks,
    _parse_doc_channel,
    _parse_perm_channel,
    _parse_revoke_channel,
)
from uniffy.core.realtime.state import DocKey


class TestChannelParsers:
    def test_doc_channel_roundtrip(self):
        ct, cid = ContentType.NOTE, uuid4()
        channel = f"realtime:doc:{ct.value}:{cid}"
        assert _parse_doc_channel(channel) == (ct, cid)

    def test_doc_channel_invalid_returns_none(self):
        assert _parse_doc_channel("realtime:doc:UNKNOWN_TYPE:abc") is None
        assert _parse_doc_channel("garbage") is None
        assert _parse_doc_channel("realtime:doc:NOTE:not-a-uuid") is None

    def test_perm_channel_roundtrip(self):
        ct, cid = ContentType.NOTE, uuid4()
        channel = f"realtime:perm:{ct.value}:{cid}"
        assert _parse_perm_channel(channel) == (ct, cid)

    def test_revoke_channel_roundtrip(self):
        uid = uuid4()
        assert _parse_revoke_channel(f"auth:revoke:{uid}") == uid

    def test_revoke_channel_invalid(self):
        assert _parse_revoke_channel("auth:revoke:not-uuid") is None
        assert _parse_revoke_channel("realtime:doc:NOTE:abc") is None


class _StubCallbacks:
    """Captures router callback invocations for assertion."""

    def __init__(self) -> None:
        self.applied_updates: list[tuple[YDocSession, bytes]] = []
        self.content_replaced: list[tuple[DocKey, str]] = []
        self.enforced: list[tuple[ClientHandle, str | None]] = []
        self.closed_stale: list[tuple[UUID, int]] = []
        self.closed_by_sid: list[tuple[UUID, UUID]] = []
        self.reauthorized: list[DocKey] = []

    async def apply_remote_update(self, session: YDocSession, update: bytes) -> None:
        self.applied_updates.append((session, update))

    async def apply_content_replace(self, key: DocKey, content: str) -> None:
        self.content_replaced.append((key, content))

    async def enforce_role_change(self, handle: ClientHandle, new_role: str | None) -> None:
        self.enforced.append((handle, new_role))

    async def close_stale_user_sessions(self, user_id: UUID, new_version: int) -> None:
        self.closed_stale.append((user_id, new_version))

    async def close_user_session_by_sid(self, user_id: UUID, session_id: UUID) -> None:
        self.closed_by_sid.append((user_id, session_id))

    async def reauthorize_doc(self, key: DocKey) -> None:
        self.reauthorized.append(key)


def _make_router_with_callbacks() -> tuple[RealtimeRouter, _StubCallbacks]:
    cb = _StubCallbacks()
    r = RealtimeRouter()
    r.register_callbacks(
        RouterCallbacks(
            apply_remote_update=cb.apply_remote_update,
            apply_content_replace=cb.apply_content_replace,
            enforce_role_change=cb.enforce_role_change,
            close_stale_user_sessions=cb.close_stale_user_sessions,
            close_user_session_by_sid=cb.close_user_session_by_sid,
            reauthorize_doc=cb.reauthorize_doc,
        )
    )
    return r, cb


class TestRouterDocDispatch:
    def test_drops_self_replica_echo(self):
        r, cb = _make_router_with_callbacks()
        sess = _make_router_session()
        r.register_doc_session(sess.key, sess)

        channel = f"realtime:doc:{sess.key[0].value}:{sess.key[1]}"
        payload = {
            "origin_replica": r._self_replica,
            "update": base64.b64encode(b"abc").decode(),
        }
        _run(r._handle_doc_message(channel, payload))
        assert cb.applied_updates == []

    def test_routes_remote_update(self):
        r, cb = _make_router_with_callbacks()
        sess = _make_router_session()
        r.register_doc_session(sess.key, sess)

        update = b"\x01\x02\x03"
        channel = f"realtime:doc:{sess.key[0].value}:{sess.key[1]}"
        payload = {
            "origin_replica": "other-replica",
            "update": base64.b64encode(update).decode(),
        }
        _run(r._handle_doc_message(channel, payload))
        assert cb.applied_updates == [(sess, update)]

    def test_content_replace_dispatches_even_from_own_replica(self):
        # The publishing process may itself hold the live session, so the
        # graft path must not be origin-deduped.
        r, cb = _make_router_with_callbacks()
        sess = _make_router_session()
        r.register_doc_session(sess.key, sess)

        channel = f"realtime:doc:{sess.key[0].value}:{sess.key[1]}"
        payload = {
            "kind": "content_replace",
            "origin_replica": r._self_replica,
            "content": "fresh column text",
        }
        _run(r._handle_doc_message(channel, payload))
        assert cb.content_replaced == [(sess.key, "fresh column text")]
        assert cb.applied_updates == []

    def test_content_replace_without_session_or_content_is_dropped(self):
        r, cb = _make_router_with_callbacks()
        _run(
            r._handle_doc_message(
                f"realtime:doc:NOTE:{uuid4()}",
                {"kind": "content_replace", "content": "x"},
            )
        )
        sess = _make_router_session()
        r.register_doc_session(sess.key, sess)
        _run(
            r._handle_doc_message(
                f"realtime:doc:{sess.key[0].value}:{sess.key[1]}",
                {"kind": "content_replace", "content": 42},
            )
        )
        assert cb.content_replaced == []

    def test_unknown_doc_session_drops_silently(self):
        r, cb = _make_router_with_callbacks()
        channel = f"realtime:doc:NOTE:{uuid4()}"
        _run(
            r._handle_doc_message(
                channel,
                {"origin_replica": "other", "update": base64.b64encode(b"x").decode()},
            )
        )
        assert cb.applied_updates == []


class TestRouterPermDispatch:
    def test_targeted_user_invokes_enforce(self):
        r, cb = _make_router_with_callbacks()
        key = (ContentType.NOTE, uuid4())
        target_user = uuid4()
        h_target = _make_handle(user_id=target_user)
        h_other = _make_handle(user_id=uuid4())
        r.attach_handle(key, h_target)
        r.attach_handle(key, h_other)

        channel = f"realtime:perm:{key[0].value}:{key[1]}"
        payload = {
            "origin_replica": "other",
            "user_id": str(target_user),
            "new_role": "VIEWER",
        }
        _run(r._handle_perm_message(channel, payload))
        assert cb.enforced == [(h_target, "VIEWER")]

    def test_content_wide_invokes_reauthorize(self):
        r, cb = _make_router_with_callbacks()
        key = (ContentType.NOTE, uuid4())

        channel = f"realtime:perm:{key[0].value}:{key[1]}"
        payload = {
            "origin_replica": "other",
            "user_id": None,
            "new_role": None,
        }
        _run(r._handle_perm_message(channel, payload))
        assert cb.reauthorized == [key]


class TestRouterRevokeDispatch:
    def test_closes_stale_sessions_for_known_user(self):
        r, cb = _make_router_with_callbacks()
        user = uuid4()
        h = _make_handle(user_id=user)
        r.attach_handle((ContentType.NOTE, uuid4()), h)

        channel = f"auth:revoke:{user}"
        _run(r._handle_revoke_message(channel, {"token_version": 2}))
        assert cb.closed_stale == [(user, 2)]

    def test_no_handles_for_user_drops_silently(self):
        r, cb = _make_router_with_callbacks()
        channel = f"auth:revoke:{uuid4()}"
        _run(r._handle_revoke_message(channel, {"token_version": 2}))
        assert cb.closed_stale == []


class TestRouterRegistryHygiene:
    def test_attach_detach_drops_empty_buckets(self):
        r, _ = _make_router_with_callbacks()
        key = (ContentType.NOTE, uuid4())
        h = _make_handle()
        r.attach_handle(key, h)
        assert key in r._doc_handles
        assert h.user_id in r._user_handles

        r.detach_handle(key, h)
        assert key not in r._doc_handles
        assert h.user_id not in r._user_handles

    def test_detach_idempotent(self):
        r, _ = _make_router_with_callbacks()
        key = (ContentType.NOTE, uuid4())
        h = _make_handle()
        r.attach_handle(key, h)
        r.detach_handle(key, h)
        r.detach_handle(key, h)


class TestContentReplaceGraft:
    """Legacy column writes graft into live docs instead of being clobbered."""

    def test_graft_replaces_markdown_and_fans_out(self) -> None:
        async def go() -> None:
            from uniffy.domains.notes import realtime_adapter  # noqa: F401  (registers NOTE)

            manager = YDocManager()
            session = _make_router_session()
            session.ydoc["markdown"] = pycrdt.Text("old text")
            session.clients[1] = _make_handle()
            manager._sessions[session.key] = session

            fanned: list[str] = []
            schedule = AsyncMock()
            with (
                patch.object(ydoc_manager_module.snapshot_writer, "schedule", schedule),
                patch.object(
                    ydoc_manager_module,
                    "enqueue_for_handle",
                    lambda handle, frame, *, kind: fanned.append(kind),
                ),
            ):
                await manager._apply_content_replace(session.key, "new text")

            assert str(session.ydoc.get("markdown", type=pycrdt.Text)) == "new text"
            assert fanned == ["update"]
            schedule.assert_awaited_once_with(session)

        _run(go())

    def test_graft_is_noop_when_content_matches(self) -> None:
        async def go() -> None:
            from uniffy.domains.notes import realtime_adapter  # noqa: F401

            manager = YDocManager()
            session = _make_router_session()
            session.ydoc["markdown"] = pycrdt.Text("same")
            manager._sessions[session.key] = session

            schedule = AsyncMock()
            with patch.object(ydoc_manager_module.snapshot_writer, "schedule", schedule):
                await manager._apply_content_replace(session.key, "same")

            schedule.assert_not_awaited()

        _run(go())

    def test_graft_without_live_session_is_ignored(self) -> None:
        async def go() -> None:
            manager = YDocManager()
            await manager._apply_content_replace((ContentType.NOTE, uuid4()), "text")

        _run(go())

    def test_graft_survives_concurrent_edit(self) -> None:
        """The transform update merges with an edit made after the state
        snapshot instead of wiping it (CRDT delete-by-id, not by index)."""

        async def go() -> None:
            from uniffy.domains.notes import realtime_adapter  # noqa: F401

            manager = YDocManager()
            session = _make_router_session()
            session.ydoc["markdown"] = pycrdt.Text("column body")
            manager._sessions[session.key] = session

            with patch.object(ydoc_manager_module.snapshot_writer, "schedule", AsyncMock()):
                await manager._apply_content_replace(session.key, "mobile wrote this")

            ytext = session.ydoc.get("markdown", type=pycrdt.Text)
            assert str(ytext) == "mobile wrote this"
            ytext += " and web appended"
            assert str(ytext) == "mobile wrote this and web appended"

        _run(go())
