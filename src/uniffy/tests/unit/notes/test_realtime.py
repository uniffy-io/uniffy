"""Pure realtime wire, auth parsing, canvas rendering and adapter registry behavior."""

from urllib.parse import quote

import pycrdt
import pytest

from uniffy.core.realtime.adapter import get_realtime_adapter, register_realtime_adapter
from uniffy.core.realtime.auth import (
    extract_bearer,
    extract_bearer_from_auth_header,
    origin_is_allowed,
)
from uniffy.core.realtime.multiplex import (
    encode_doc_frame,
    peek_var_string,
    read_var_string,
    read_var_uint,
    write_var_string,
    write_var_uint,
)
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
from uniffy.core.types import ContentRole, ContentType
from uniffy.domains.notes.adapter import (
    _render_canvas_content,
    _render_markdown,
    _seed_canvas_ydoc,
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


class _ChatAdapter:
    """No live content type is chat, so registering this one cannot displace a real adapter."""

    content_type = ContentType.CHAT

    async def authorize(self, *args: object, **kwargs: object) -> ContentRole:
        return ContentRole.VIEWER


class TestAdapterRegistry:
    def test_register_then_get_returns_same_instance(self) -> None:
        adapter = _ChatAdapter()
        register_realtime_adapter(adapter)
        assert get_realtime_adapter(ContentType.CHAT) is adapter

    def test_unregistered_content_type_raises_lookup_error(self) -> None:
        with pytest.raises(LookupError):
            get_realtime_adapter(ContentType.FILE)


class TestCanvasRender:
    """``_render_canvas_content`` round-trip via ``pycrdt`` Y types."""

    def test_canvas_render_emits_expected_shape(self) -> None:
        ydoc = pycrdt.Doc()
        ydoc["nodes"] = pycrdt.Map({
            "n1": pycrdt.Map({"id": "n1", "type": "text", "x": 10, "y": 20})
        })
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
        ydoc = pycrdt.Doc()
        assert _render_canvas_content(ydoc) is None


class TestMarkdownRender:
    def test_markdown_render_reads_y_text(self) -> None:
        ydoc = pycrdt.Doc()
        ydoc["markdown"] = pycrdt.Text("# hello\n\nworld")

        assert _render_markdown(ydoc) == "# hello\n\nworld"

    def test_markdown_render_returns_empty_when_root_missing(self) -> None:
        ydoc = pycrdt.Doc()
        assert _render_markdown(ydoc) == ""


class TestCanvasHydration:
    """Cold-start hydration keeps existing canvas content, so a first flush cannot blank it."""

    def test_seed_canvas_ydoc_populates_y_types_from_content(self) -> None:
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
        """Text fields seed as ``pycrdt.Text`` so concurrent typing in one cell merges."""

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
        """Nodes without a text field get a ``pycrdt.Map`` for ``data`` and no ``pycrdt.Text``."""

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
        """An empty seed renders as ``None``, so projection leaves the stored canvas alone."""

        ydoc = pycrdt.Doc()
        _seed_canvas_ydoc(ydoc, None)

        assert _render_canvas_content(ydoc) is None


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
