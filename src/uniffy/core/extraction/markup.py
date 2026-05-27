"""Markup text extraction (HTML, RTF)."""

import re
from html.parser import HTMLParser

from uniffy.core.extraction.types import ExtractionResult


class _HTMLTextExtractor(HTMLParser):
    """Simple HTML parser that strips tags and extracts text."""

    def __init__(self) -> None:
        super().__init__()
        self._parts: list[str] = []
        self._skip = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in ("script", "style"):
            self._skip = True

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style"):
            self._skip = False

    def handle_data(self, data: str) -> None:
        if not self._skip:
            text = data.strip()
            if text:
                self._parts.append(text)

    def get_text(self) -> str:
        return "\n".join(self._parts)


def extract_html_text(data: bytes, max_chars: int) -> ExtractionResult:
    """Strip HTML tags using stdlib parser, ignoring script and style content."""
    html_str = data.decode("utf-8", errors="replace")
    parser = _HTMLTextExtractor()
    parser.feed(html_str)
    text = parser.get_text()

    truncated = False
    if len(text) > max_chars:
        text = text[:max_chars]
        truncated = True

    word_count = len(text.split()) if text.strip() else 0

    return ExtractionResult(
        text=text,
        word_count=word_count,
        truncated=truncated,
    )


_RTF_CONTROL_RE = re.compile(
    r"\\[a-z]{1,32}(-?\d{1,10})?[ ]?"
    r"|[{}]"
    r"|\\[\\{}]"
    r"|\\\*\\[a-z]{1,32}"
    r"|\\\'[0-9a-f]{2}",
    re.IGNORECASE,
)


def extract_rtf_text(data: bytes, max_chars: int) -> ExtractionResult:
    """Strip RTF control words with a regex pass."""
    rtf_str = data.decode("utf-8", errors="replace")
    text = _RTF_CONTROL_RE.sub("", rtf_str)

    text = re.sub(r"\n{3,}", "\n\n", text)
    text = text.strip()

    truncated = False
    if len(text) > max_chars:
        text = text[:max_chars]
        truncated = True

    word_count = len(text.split()) if text.strip() else 0

    return ExtractionResult(
        text=text,
        word_count=word_count,
        truncated=truncated,
    )
