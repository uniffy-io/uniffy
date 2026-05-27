"""Stateless text extraction: bytes in, text out. Shared by workers, agent
tools, and LLM message building.
"""

from collections.abc import Callable

from uniffy.core.extraction.markup import extract_html_text, extract_rtf_text
from uniffy.core.extraction.office import extract_docx_text, extract_pptx_text, extract_xlsx_text
from uniffy.core.extraction.pdf import extract_pdf_text
from uniffy.core.extraction.text import extract_csv_text, extract_plain_text
from uniffy.core.extraction.types import ExtractionResult, UnsupportedFormatError

DEFAULT_MAX_CHARS = 200_000

_MIME_EXTRACTORS: dict[str, Callable[[bytes, int], ExtractionResult]] = {
    "application/pdf": extract_pdf_text,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": extract_docx_text,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": extract_xlsx_text,
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": extract_pptx_text,
    "text/html": extract_html_text,
    "application/xhtml+xml": extract_html_text,
    "application/rtf": extract_rtf_text,
    "text/rtf": extract_rtf_text,
    "text/csv": extract_csv_text,
    "text/tab-separated-values": extract_csv_text,
    "application/json": extract_plain_text,
    "application/xml": extract_plain_text,
    "application/javascript": extract_plain_text,
    "application/typescript": extract_plain_text,
    "application/x-yaml": extract_plain_text,
    "application/x-sh": extract_plain_text,
    "application/sql": extract_plain_text,
    "application/x-python": extract_plain_text,
    "application/x-httpd-php": extract_plain_text,
    "application/toml": extract_plain_text,
    "application/x-toml": extract_plain_text,
}

EXTRACTABLE_MIME_TYPES: frozenset[str] = frozenset(_MIME_EXTRACTORS.keys())


def _normalize_mime(mime_type: str) -> str:
    """Strip codec parameters from a MIME type."""
    return mime_type.lower().split(";")[0].strip()


def can_extract(mime_type: str) -> bool:
    """True if the MIME type maps to an extractor or falls back to text/*."""
    normalized = _normalize_mime(mime_type)
    if normalized in _MIME_EXTRACTORS:
        return True
    return normalized.startswith("text/")


def extract_text(
    data: bytes,
    mime_type: str,
    *,
    max_chars: int = DEFAULT_MAX_CHARS,
) -> ExtractionResult:
    """Extract text from file bytes; ``text/*`` types not explicitly mapped go through plain-text."""
    normalized = _normalize_mime(mime_type)

    extractor = _MIME_EXTRACTORS.get(normalized)
    if extractor is not None:
        return extractor(data, max_chars)

    if normalized.startswith("text/"):
        return extract_plain_text(data, max_chars)

    raise UnsupportedFormatError(f"Cannot extract text from MIME type: {mime_type}")


__all__ = [
    "DEFAULT_MAX_CHARS",
    "EXTRACTABLE_MIME_TYPES",
    "ExtractionResult",
    "UnsupportedFormatError",
    "can_extract",
    "extract_text",
]
