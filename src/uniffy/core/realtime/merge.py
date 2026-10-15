"""Three-way text merge for plain writes that land on a live realtime document."""

import re
from difflib import SequenceMatcher
from itertools import accumulate

from uniffy.core.errors import ValidationError

# Bound diff work on repetitive documents while preserving unchanged prefix and suffix identities.
TEXT_MERGE_LIMIT = 256 * 1024

_TOKEN = re.compile(r"\w+|[^\w\s]|\s+")

# difflib opcode tags.
_EQUAL = "equal"
_REPLACE = "replace"

# ``a[a1:a2]`` becomes ``b[b1:b2]``; either side may be empty.
TextEdit = tuple[int, int, int, int]


def _starts(parts: list[str]) -> list[int]:
    return [0, *accumulate(len(part) for part in parts)]


def text_edits(a: str, b: str) -> list[TextEdit]:
    """Align lines before tokens to bound diff work and preserve whole words."""
    if max(len(a), len(b)) > TEXT_MERGE_LIMIT:
        start = 0
        while start < min(len(a), len(b)) and a[start] == b[start]:
            start += 1
        end_a, end_b = len(a), len(b)
        while end_a > start and end_b > start and a[end_a - 1] == b[end_b - 1]:
            end_a -= 1
            end_b -= 1
        return [] if start == end_a == end_b else [(start, end_a, start, end_b)]
    a_lines, b_lines = a.splitlines(keepends=True), b.splitlines(keepends=True)
    a_at, b_at = _starts(a_lines), _starts(b_lines)
    edits: list[TextEdit] = []
    for tag, i1, i2, j1, j2 in SequenceMatcher(None, a_lines, b_lines).get_opcodes():
        if tag == _EQUAL:
            continue
        a1, a2, b1, b2 = a_at[i1], a_at[i2], b_at[j1], b_at[j2]
        if tag != _REPLACE:
            edits.append((a1, a2, b1, b2))
            continue
        a_tokens, b_tokens = _TOKEN.findall(a[a1:a2]), _TOKEN.findall(b[b1:b2])
        token_a, token_b = _starts(a_tokens), _starts(b_tokens)
        for inner, p1, p2, q1, q2 in SequenceMatcher(None, a_tokens, b_tokens).get_opcodes():
            if inner != _EQUAL:
                edits.append((
                    a1 + token_a[p1],
                    a1 + token_a[p2],
                    b1 + token_b[q1],
                    b1 + token_b[q2],
                ))
    return edits


def merge_plain_text(*, base: str | None, live: str, incoming: str) -> str:
    """Preserve live-only text and keep both insertions when edits overlap."""
    if base is None:
        raise ValidationError("base_content", "Original content is required when saving text")
    if base == live or live == incoming:
        return incoming
    if base == incoming:
        return live
    live_edits = text_edits(base, live)
    incoming_edits = text_edits(base, incoming)
    inserted: dict[int, list[str]] = {}
    removal_bounds = [0] * (len(base) + 1)
    cuts = {0, len(base)}
    for edits, text in ((live_edits, live), (incoming_edits, incoming)):
        for a1, a2, b1, b2 in edits:
            cuts.update((a1, a2))
            if b2 > b1:
                inserted.setdefault(a1, []).append(text[b1:b2])
            if a2 > a1:
                removal_bounds[a1] += 1
                removal_bounds[a2] -= 1
    removed_depth = list(accumulate(removal_bounds))
    ordered = sorted(cuts)
    out: list[str] = []
    for start, end in zip(ordered, ordered[1:], strict=False):
        out.extend(inserted.get(start, ()))
        if removed_depth[start] == 0:
            out.append(base[start:end])
    out.extend(inserted.get(len(base), ()))
    return "".join(out)
