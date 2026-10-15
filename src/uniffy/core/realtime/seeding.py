import pycrdt

_PARAGRAPH_TAG = "paragraph"


def has_fragment_content(root: pycrdt.XmlFragment | pycrdt.XmlElement) -> bool:
    # ySyncPlugin can publish an empty paragraph before the assigned client seeds.
    for child in root.children:
        if isinstance(child, pycrdt.XmlText):
            if str(child):
                return True
        elif child.tag != _PARAGRAPH_TAG or has_fragment_content(child):
            return True
    return False
