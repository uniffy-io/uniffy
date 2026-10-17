import pycrdt

from uniffy.core.realtime.merge import text_edits

MARKDOWN_TEXT_FIELD = "markdown"
MARKDOWN_MIRROR_FIELD = "markdown_mirror"
MIRROR_ACTIVE_KEY = "active"
DOC_META_FIELD = "doc_meta"
DOC_GENERATION_KEY = "generation"
PROSEMIRROR_FRAGMENT_FIELD = "prosemirror"


def markdown_text(ydoc: pycrdt.Doc) -> pycrdt.Text:
    # ``get(..., type=...)`` declares and retrieves, so roots seeded purely via
    # ``apply_update`` read correctly.
    return ydoc.get(MARKDOWN_TEXT_FIELD, type=pycrdt.Text)


def seed_markdown(ydoc: pycrdt.Doc, content: str) -> None:
    ydoc[MARKDOWN_TEXT_FIELD] = pycrdt.Text(content)


def replace_external_markdown(ydoc: pycrdt.Doc, content: str) -> bool:
    """Graft ``content`` into Y.Text with the smallest edits, so untouched items keep identity.

    Concurrent client updates then integrate next to their original neighbours instead of
    after a wholesale delete, and text bindings receive a local delta rather than a reset.
    """
    ytext = markdown_text(ydoc)
    current = str(ytext)
    if current == content:
        return False
    metadata = ydoc.get(MARKDOWN_MIRROR_FIELD, type=pycrdt.Map)
    ascii_only = current.isascii()

    def offset(index: int) -> int:
        # pycrdt.Text indexes by UTF-8 byte offset, not by code point.
        return index if ascii_only else len(current[:index].encode())

    with ydoc.transaction():
        # Later edits first keep earlier offsets valid against ``current``.
        for a1, a2, b1, b2 in reversed(text_edits(current, content)):
            if a2 > a1:
                del ytext[offset(a1) : offset(a2)]
            if b2 > b1:
                ytext.insert(offset(a1), content[b1:b2])
        metadata[MIRROR_ACTIVE_KEY] = False
    return True
