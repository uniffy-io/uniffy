import pycrdt

MARKDOWN_TEXT_FIELD = "markdown"
MARKDOWN_MIRROR_FIELD = "markdown_mirror"
MIRROR_ACTIVE_KEY = "active"


def markdown_text(ydoc: pycrdt.Doc) -> pycrdt.Text:
    # ``get(..., type=...)`` declares and retrieves, so roots seeded purely via
    # ``apply_update`` read correctly.
    return ydoc.get(MARKDOWN_TEXT_FIELD, type=pycrdt.Text)


def seed_markdown(ydoc: pycrdt.Doc, content: str) -> None:
    ydoc[MARKDOWN_TEXT_FIELD] = pycrdt.Text(content)


def replace_external_markdown(ydoc: pycrdt.Doc, content: str) -> bool:
    ytext = markdown_text(ydoc)
    if str(ytext) == content:
        return False
    metadata = ydoc.get(MARKDOWN_MIRROR_FIELD, type=pycrdt.Map)
    with ydoc.transaction():
        del ytext[:]
        ytext += content
        metadata[MIRROR_ACTIVE_KEY] = False
    return True
