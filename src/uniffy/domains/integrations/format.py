"""Scrubbers and shaping caps for external text entering the model context.

Keeps third-party text from forging mention chips or hiding instructions
behind bidi/zero-width controls.
"""

import re
import unicodedata

TITLE_CAP = 500
BODY_CAP = 10_000
FILE_CAP = 50_000

_MENTION_RE = re.compile(r"\[\[\[([^\[\]|]{0,200})\|urn:[^\]]*\]\]\]")
_MAX_MENTION_PASSES = 5


def _strip_controls(text: str) -> str:
    """Drop Cc/Cf characters (bidi controls, zero-widths, tags) except newline/tab."""
    out: list[str] = []
    for ch in text:
        if ch in ("\n", "\t"):
            out.append(ch)
            continue
        if unicodedata.category(ch) in ("Cc", "Cf"):
            continue
        out.append(ch)
    return "".join(out)


def _collapse_mentions(text: str) -> str:
    """Reduce ``[[[label|urn:...]]]`` markup to its label.

    External text must never render as an interactive chip. Runs to a fixed
    point because a substitution can expose markup assembled from fragments.
    """
    for _ in range(_MAX_MENTION_PASSES):
        replaced = _MENTION_RE.sub(lambda m: m.group(1), text)
        if replaced == text:
            return replaced
        text = replaced
    return text


def _truncate(text: str, cap: int) -> str:
    if len(text) <= cap:
        return text
    return text[:cap] + f"\n[truncated: showing {cap:,} of {len(text):,} characters]"


def scrub_external_text(text: str | None, cap: int = BODY_CAP) -> str:
    """Scrub prose fields (titles, bodies, comments).

    Control strip runs before NFKC so hidden characters cannot mask markup,
    and mention collapse runs after NFKC because normalization can turn
    fullwidth brackets into ASCII ones.
    """
    if not text:
        return ""
    text = _strip_controls(text)
    text = unicodedata.normalize("NFKC", text)
    text = _collapse_mentions(text)
    return _truncate(text, cap)


def scrub_external_code(text: str | None, cap: int = FILE_CAP) -> str:
    """Scrub fetched file content: no NFKC (it corrupts source text);
    the bidi/zero-width strip IS the trojan-source defence.
    """
    if not text:
        return ""
    text = _strip_controls(text)
    text = _collapse_mentions(text)
    return _truncate(text, cap)
