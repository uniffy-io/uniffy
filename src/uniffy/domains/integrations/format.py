"""Scrubbers and shaping caps for external text entering the model context.

Keeps third-party text from forging mention chips or hiding instructions
behind bidi/zero-width controls.
"""

from uniffy.core.content.external_text import (
    collapse_mentions,
    neutralize_external_text,
    strip_controls,
)

TITLE_CAP = 500
BODY_CAP = 10_000
FILE_CAP = 50_000


def _truncate(text: str, cap: int) -> str:
    if len(text) <= cap:
        return text
    return text[:cap] + f"\n[truncated: showing {cap:,} of {len(text):,} characters]"


def scrub_external_text(text: str | None, cap: int = BODY_CAP) -> str:
    """Scrub prose fields (titles, bodies, comments)."""
    if not text:
        return ""
    return _truncate(neutralize_external_text(text), cap)


def scrub_external_code(text: str | None, cap: int = FILE_CAP) -> str:
    """Scrub fetched file content: no NFKC (it corrupts source text);
    the bidi/zero-width strip IS the trojan-source defence.
    """
    if not text:
        return ""
    text = strip_controls(text)
    text = collapse_mentions(text)
    return _truncate(text, cap)
