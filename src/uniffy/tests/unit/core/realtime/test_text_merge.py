import pycrdt
import pytest

from uniffy.core.errors import ValidationError
from uniffy.core.realtime.markdown import (
    MARKDOWN_MIRROR_FIELD,
    MIRROR_ACTIVE_KEY,
    markdown_text,
    replace_external_markdown,
    seed_markdown,
)
from uniffy.core.realtime.merge import TEXT_MERGE_LIMIT, merge_plain_text, text_edits


class TestMergePlainText:
    def test_missing_base_rejected_even_when_live_equals_incoming(self) -> None:
        with pytest.raises(ValidationError, match="Original content"):
            merge_plain_text(base=None, live="same", incoming="same")

    def test_clear_keeps_concurrent_insert(self) -> None:
        assert merge_plain_text(base="base", live="base human", incoming="") == " human"

    def test_live_insert_outside_changed_region_survives(self) -> None:
        merged = merge_plain_text(
            base="alpha beta gamma",
            live="alpha beta gamma delta",
            incoming="alpha BETA gamma",
        )
        assert merged == "alpha BETA gamma delta"

    def test_plain_change_inside_untouched_region_lands(self) -> None:
        merged = merge_plain_text(
            base="intro\n\nbody text\n\noutro\n",
            live="intro typed\n\nbody text\n\noutro\n",
            incoming="intro\n\nbody rewritten\n\noutro\n",
        )
        assert merged == "intro typed\n\nbody rewritten\n\noutro\n"

    def test_identical_base_and_live_yields_incoming(self) -> None:
        assert merge_plain_text(base="same", live="same", incoming="anything else") == (
            "anything else"
        )

    def test_unchanged_incoming_keeps_live(self) -> None:
        assert merge_plain_text(base="base", live="base human", incoming="base") == "base human"

    def test_overlapping_edits_keep_both(self) -> None:
        merged = merge_plain_text(base="the cat sat", live="the dog sat", incoming="the cow sat")
        assert merged.startswith("the ") and merged.endswith(" sat")
        assert "dog" in merged and "cow" in merged
        assert "cat" not in merged

    def test_live_only_text_is_never_deleted(self) -> None:
        merged = merge_plain_text(
            base="one two three", live="one two 2.5 three", incoming="one three"
        )
        assert merged == "one 2.5 three"

    def test_concurrent_appends_keep_live_first(self) -> None:
        assert merge_plain_text(base="base", live="base human", incoming="base agent") == (
            "base human agent"
        )

    def test_large_merge_keeps_concurrent_live_insert(self) -> None:
        base = "a" * (TEXT_MERGE_LIMIT + 1)
        assert (
            merge_plain_text(base=base, live=base + " live", incoming="incoming") == "incoming live"
        )

    def test_edits_reproduce_target_exactly(self) -> None:
        a = "line one\nline two\n\nline four\nline five\n"
        b = "line one\nline 2\n\nline four\nnew line\nline five\n"
        out, cursor = [], 0
        for a1, a2, b1, b2 in text_edits(a, b):
            out.append(a[cursor:a1])
            out.append(b[b1:b2])
            cursor = a2
        out.append(a[cursor:])
        assert "".join(out) == b


class TestGraft:
    def test_large_graft_keeps_concurrent_insert_at_original_position(self) -> None:
        server = pycrdt.Doc()
        base = "a" * (TEXT_MERGE_LIMIT + 1)
        seed_markdown(server, base)
        peer = pycrdt.Doc()
        peer.apply_update(server.get_update())
        before = peer.get_state()
        markdown_text(peer).insert(100, "PEER")
        replace_external_markdown(server, base + " appended")
        server.apply_update(peer.get_update(before))
        assert str(markdown_text(server)) == base[:100] + "PEER" + base[100:] + " appended"

    def test_minimal_graft_keeps_concurrent_insert_in_place(self) -> None:
        server = pycrdt.Doc()
        seed_markdown(server, "alpha beta gamma")
        client = pycrdt.Doc()
        client.apply_update(server.get_update())
        before = client.get_state()
        markdown_text(client).insert(6, "LIVE ")
        client_update = client.get_update(before)

        assert replace_external_markdown(server, "alpha beta gamma delta")
        server.apply_update(client_update)
        assert str(markdown_text(server)) == "alpha LIVE beta gamma delta"
        assert server.get(MARKDOWN_MIRROR_FIELD, type=pycrdt.Map)[MIRROR_ACTIVE_KEY] is False

    def test_graft_converts_offsets_for_non_ascii_text(self) -> None:
        doc = pycrdt.Doc()
        seed_markdown(doc, "café \U0001f600 end über")
        assert replace_external_markdown(doc, "café \U0001f600 END über!")
        assert str(markdown_text(doc)) == "café \U0001f600 END über!"

    def test_equal_text_is_a_no_op(self) -> None:
        doc = pycrdt.Doc()
        seed_markdown(doc, "same")
        doc.get(MARKDOWN_MIRROR_FIELD, type=pycrdt.Map)[MIRROR_ACTIVE_KEY] = True
        assert not replace_external_markdown(doc, "same")
        assert doc.get(MARKDOWN_MIRROR_FIELD, type=pycrdt.Map)[MIRROR_ACTIVE_KEY] is True
