"""Neutralize text that came from outside Uniffy before it is stored or shown."""

import unicodedata

from uniffy.core.content.references import MENTION_PATTERN

_MAX_MENTION_PASSES = 5


_LINE_WHITESPACE = frozenset({"\n", "\t"})


def strip_controls(text: str, *, keep_newlines: bool = True) -> str:
    """Drop Cc/Cf characters (bidi overrides, zero-widths, the tag block) so text reads one way."""
    return "".join(
        ch
        for ch in text
        if unicodedata.category(ch) not in ("Cc", "Cf") or (keep_newlines and ch in _LINE_WHITESPACE)
    )


def collapse_mentions(text: str) -> str:
    """Reduce mention markup to its label, matching exactly what the renderers would parse."""
    # A fixed point: one substitution can expose markup assembled from fragments.
    for _ in range(_MAX_MENTION_PASSES):
        replaced = MENTION_PATTERN.sub(lambda m: m.group(1), text)
        if replaced == text:
            return replaced
        text = replaced
    return text


def neutralize_external_text(text: str | None) -> str:
    """Strip hidden controls and mention markup from third-party prose."""
    if not text:
        return ""
    # Controls go before NFKC so they cannot mask markup; collapse goes after it,
    # because normalization turns fullwidth brackets into ASCII ones.
    text = strip_controls(text)
    text = unicodedata.normalize("NFKC", text)
    return collapse_mentions(text)
