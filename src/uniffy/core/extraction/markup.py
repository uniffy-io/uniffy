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
    """Extract text from HTML by stripping tags.

    Uses stdlib html.parser to strip tags, ignoring script and style content.

    Parameters
    ----------
    data : bytes
        Raw HTML file bytes.
    max_chars : int
        Maximum characters to return.

    Returns
    -------
    ExtractionResult
        Extracted text content.

    """
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


# RTF control word pattern for stripping
_RTF_CONTROL_RE = re.compile(
    r"\\[a-z]{1,32}(-?\d{1,10})?[ ]?"  # control words
    r"|[{}]"  # group delimiters
    r"|\\[\\{}]"  # escaped special chars
    r"|\\\*\\[a-z]{1,32}"  # destination groups
    r"|\\\'[0-9a-f]{2}",  # hex characters
    re.IGNORECASE,
)


def extract_rtf_text(data: bytes, max_chars: int) -> ExtractionResult:
    """Extract text from RTF by stripping control words.

    Uses regex-based control word stripping for simple RTF extraction.

    Parameters
    ----------
    data : bytes
        Raw RTF file bytes.
    max_chars : int
        Maximum characters to return.

    Returns
    -------
    ExtractionResult
        Extracted text content.

    """
    rtf_str = data.decode("utf-8", errors="replace")
    text = _RTF_CONTROL_RE.sub("", rtf_str)

    # Clean up whitespace
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
