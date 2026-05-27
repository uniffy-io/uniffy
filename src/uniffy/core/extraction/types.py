"""Extraction result types and errors."""

from dataclasses import dataclass


@dataclass
class ExtractionResult:
    """Result of extracting text from a file."""

    text: str
    page_count: int | None = None
    word_count: int | None = None
    truncated: bool = False


class UnsupportedFormatError(Exception):
    """Raised when extraction is attempted on an unsupported MIME type."""
