"""Repair model Markdown without resolving referenced content."""

import re
from bisect import bisect_right
from enum import StrEnum
from heapq import merge

from uniffy.core.content.references import sanitize_mention_label
from uniffy.core.types import ContentType


class OutputSurface(StrEnum):
    CHAT = "chat"
    SESSION = "session"
    NOTE = "note"
    TASK = "task"
    EVENT = "event"


class OutputRepair(StrEnum):
    FENCE_UNWRAP = "fence_unwrap"
    MENTION_BRACKETS = "mention_brackets"
    MENTION_LINK = "mention_link"
    BARE_URN = "bare_urn"
    DIRECTIVE = "directive"
    SELF_PREFIX = "self_prefix"


_UUID = r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}"
_TYPES = "|".join(re.escape(kind.value) for kind in ContentType)
_URN = rf"urn:uniffy:content:(?:{_TYPES}):{_UUID}"
_TOKENS = re.compile(
    r"(?P<canonical>\\?\[\\?\[\\?\[[^\[\]|]+?\\?\|[^\]\r\n]+?\\?\]\\?\]\\?\])"
    r"|(?P<image>!\[[^\]\r\n]*\]\([^\)\r\n]*\))"
    rf"|(?P<brackets>(?<![\[\\])\[{{2,3}}(?P<bracket_label>[^\[\]|\r\n]+)"
    rf"\|(?P<bracket_urn>{_URN})\]{{2,3}}(?!\]))"
    rf"|(?P<link>(?<![!\\\[])\[(?P<link_label>(?:[^\[\]\r\n]|\[[^\[\]\r\n]*\])*)\]"
    rf"\((?P<link_urn>{_URN})\))"
    rf"|(?P<bare>(?<![\w:/\\]){_URN}(?![\w:/-]))"
    r"|(?P<directive>^:::[ \t]*\w*[ \t]*(?:\r?\n|$))",
    re.MULTILINE,
)
_FENCE = re.compile(
    r"^(?P<indent>[ \t>]*(?:(?:[-+*]|\d+[.)])[ \t]+)?)"
    r"(?P<marker>`{3,}|~{3,})(?P<info>[^\r\n]*)"
)
_DIRECTIVE = re.compile(r"^:::[ \t]*\w*[ \t]*(?:\r?\n)?$")
_BACKTICKS = re.compile(r"`+")
_MARKDOWN_INFO = frozenset({"md", "markdown"})


def _repair_mentions(text: str, repairs: set[OutputRepair]) -> str:
    def replace(match: re.Match[str]) -> str:
        if match.group("directive") is not None:
            repairs.add(OutputRepair.DIRECTIVE)
            return ""
        if match.group("canonical") is not None or match.group("image") is not None:
            return match[0]
        if match.group("brackets") is not None:
            kind = OutputRepair.MENTION_BRACKETS
            label, urn = match["bracket_label"], match["bracket_urn"]
        elif match.group("link") is not None:
            kind = OutputRepair.MENTION_LINK
            label, urn = match["link_label"], match["link_urn"]
        else:
            kind = OutputRepair.BARE_URN
            urn = match["bare"]
            label = urn.split(":")[3].replace("_", " ").title()
        repairs.add(kind)
        return f"[[[{sanitize_mention_label(label)}|{urn}]]]"

    ticks = list(_BACKTICKS.finditer(text))
    next_tick: dict[int, int] = {}
    lengths: dict[int, int] = {}
    for index in range(len(ticks) - 1, -1, -1):
        length = len(ticks[index][0])
        if length in lengths:
            next_tick[index] = lengths[length]
        lengths[length] = index
    code_spans: list[tuple[int, int]] = []
    index = 0
    while index < len(ticks):
        closing = next_tick.get(index)
        if closing is None:
            index += 1
            continue
        code_spans.append((ticks[index].start(), ticks[closing].end()))
        index = closing + 1
    tokens = list(_TOKENS.finditer(text))
    protected = [
        match.span() for match in tokens if match.group("canonical") or match.group("image")
    ]
    spans: list[tuple[int, int]] = []
    for start, end in merge(protected, code_spans):
        if spans and start <= spans[-1][1]:
            spans[-1] = (spans[-1][0], max(end, spans[-1][1]))
        else:
            spans.append((start, end))
    parts: list[str] = []
    offset = span_index = 0
    for match in tokens:
        while span_index < len(spans) and spans[span_index][1] <= match.start():
            span_index += 1
        if span_index < len(spans) and spans[span_index][0] < match.end():
            continue
        parts.append(text[offset : match.start()])
        parts.append(replace(match))
        offset = match.end()
    parts.append(text[offset:])
    return "".join(parts)


def _fence_ends(lines: list[str], prefix: re.Pattern[str] | None) -> dict[tuple[int, bool], int]:
    # Earlier, longer closers dominate later, shorter ones. This avoids
    # rescanning nested wrappers or unmatched openers for every fence.
    stacks: dict[tuple[str, int, int], tuple[list[int], list[int]]] = {}
    ends: dict[tuple[int, bool], int] = {}
    for index in range(len(lines) - 1, -1, -1):
        raw = _FENCE.match(lines[index])
        stripped = _FENCE.match(prefix.sub("", lines[index])) if prefix else raw
        for is_stripped, match in ((False, raw), (True, stripped)):
            if match is None:
                continue
            marker = match["marker"]
            indent = match["indent"].rsplit(">", 1)[-1].expandtabs(4)
            max_indent = len(indent) + 3 if indent.strip() else 3
            for column in range(max_indent + 1):
                lengths, indices = stacks.get(
                    (marker[0], match["indent"].count(">"), column), ([], [])
                )
                candidate = bisect_right(lengths, -len(marker)) - 1
                if candidate >= 0:
                    key = (index, is_stripped)
                    ends[key] = min(ends.get(key, len(lines)), indices[candidate])
        if raw is not None and not raw["info"].strip() and not raw["indent"].strip(" \t>"):
            marker = raw["marker"]
            column = len(raw["indent"].rsplit(">", 1)[-1].expandtabs(4))
            lengths, indices = stacks.setdefault(
                (marker[0], raw["indent"].count(">"), column), ([], [])
            )
            while lengths and lengths[-1] >= -len(marker):
                lengths.pop()
                indices.pop()
            lengths.append(-len(marker))
            indices.append(index)
    return ends


def normalize_model_markdown(
    text: str, *, surface: OutputSurface, agent_name: str | None = None
) -> tuple[str, list[str]]:
    if not text:
        return text, []
    prefix = (
        re.compile(rf"^(?:[ \t]*\[{re.escape(agent_name)}\]:[ \t]*)+")
        if surface == OutputSurface.CHAT and agent_name
        else None
    )
    lines = text.splitlines(keepends=True)
    ends = _fence_ends(lines, prefix)
    repairs: set[OutputRepair] = set()
    lower, upper = 0, len(lines)
    while True:
        segments: list[tuple[int, int, str, re.Match[str] | None]] = []
        leading = True
        index = lower
        while index < upper:
            line = lines[index]
            if leading and prefix:
                line, count = prefix.subn("", line)
                if count:
                    repairs.add(OutputRepair.SELF_PREFIX)
            if _DIRECTIVE.fullmatch(line):
                segments.append((index, index + 1, line, None))
                index += 1
                continue
            fence = _FENCE.match(line)
            if fence is not None:
                closing = ends.get((index, leading and prefix is not None), upper)
                stop = min(closing + 1, upper)
                segments.append((index, stop, line, fence))
                leading = False
                index = stop
            else:
                segments.append((index, index + 1, line, None))
                if line.strip():
                    leading = False
                index += 1
        visible = [
            part
            for part in segments
            if part[3] is not None or (part[2].strip() and not _DIRECTIVE.fullmatch(part[2]))
        ]
        if len(visible) == 1:
            start, stop, _, fence = visible[0]
            if (
                fence is not None
                and not fence["indent"].strip()
                and len(fence["indent"]) <= 3
                and fence["info"].strip() in _MARKDOWN_INFO
                and ends.get((start, prefix is not None)) == stop - 1
            ):
                repairs.add(OutputRepair.FENCE_UNWRAP)
                if any(_DIRECTIVE.fullmatch(part[2]) for part in segments):
                    repairs.add(OutputRepair.DIRECTIVE)
                lower, upper = start + 1, stop - 1
                continue
        break
    parts: list[str] = []
    prose: list[str] = []
    for start, stop, line, fence in segments:
        if fence is None:
            prose.append(line)
        else:
            parts.append(_repair_mentions("".join(prose), repairs))
            prose.clear()
            parts.append(line)
            parts.extend(lines[start + 1 : stop])
    parts.append(_repair_mentions("".join(prose), repairs))
    return "".join(parts), [kind.value for kind in OutputRepair if kind in repairs]
