import pycrdt


def replace_external_markdown(ydoc: pycrdt.Doc, content: str) -> bool:
    ytext = ydoc.get("markdown", type=pycrdt.Text)
    if str(ytext) == content:
        return False
    metadata = ydoc.get("markdown_mirror", type=pycrdt.Map)
    with ydoc.transaction():
        del ytext[:]
        ytext += content
        metadata["active"] = False
    return True
