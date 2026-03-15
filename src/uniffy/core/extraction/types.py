"""Extraction result types and errors."""

from dataclasses import dataclass


@dataclass
class ExtractionResult:
    """Result of extracting text from a file.

    Attributes
    ----------
    text : str
        The extracted text content.
    page_count : int | None
        Number of pages (for paginated formats like PDF, PPTX).
    word_count : int | None
        Approximate word count of the extracted text.
    truncated : bool
        Whether the text was truncated to fit max_chars.

    """

    text: str
    page_count: int | None = None
    word_count: int | None = None
    truncated: bool = False


class UnsupportedFormatError(Exception):
    """Raised when extraction is attempted on an unsupported MIME type."""
