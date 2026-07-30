"""Text hygiene for memory entries: what the UI shows must be what the model reads."""

import unicodedata

_CONTENT_WHITESPACE = {"\n", "\t"}


def strip_control_chars(text: str, *, keep_newlines: bool = False) -> str:
    """Drop Unicode control and format characters (zero-width, bidi overrides,
    the tag block) so an entry cannot read one way in the UI and another to
    the model. ``keep_newlines`` preserves ``\\n``/``\\t`` for multi-line content.
    """
    return "".join(
        ch
        for ch in text
        if unicodedata.category(ch) not in ("Cc", "Cf")
        or (keep_newlines and ch in _CONTENT_WHITESPACE)
    )


def escape_like(text: str) -> str:
    """Escape LIKE metacharacters so a query of ``%`` cannot match everything."""
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
