"""Shared text extraction module.

Stateless extraction: bytes in, text out. No database, no S3, no async.
Every consumer (workers, agent tools, LLM message building) calls the same functions.

Usage::

    from uniffy.core.extraction import extract_text, can_extract

    result = extract_text(file_bytes, "application/pdf")
    print(result.text, result.page_count)

"""

from collections.abc import Callable

from uniffy.core.extraction.markup import extract_html_text, extract_rtf_text
from uniffy.core.extraction.office import extract_docx_text, extract_pptx_text, extract_xlsx_text
from uniffy.core.extraction.pdf import extract_pdf_text
from uniffy.core.extraction.text import extract_csv_text, extract_plain_text
from uniffy.core.extraction.types import ExtractionResult, UnsupportedFormatError

# Default maximum characters for extraction
DEFAULT_MAX_CHARS = 200_000

# Explicit MIME type to extractor mapping
_MIME_EXTRACTORS: dict[str, Callable[[bytes, int], ExtractionResult]] = {
    # PDF
    "application/pdf": extract_pdf_text,
    # Office documents
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": extract_docx_text,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": extract_xlsx_text,
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": extract_pptx_text,
    # Markup
    "text/html": extract_html_text,
    "application/xhtml+xml": extract_html_text,
    "application/rtf": extract_rtf_text,
    "text/rtf": extract_rtf_text,
    # Structured text
    "text/csv": extract_csv_text,
    "text/tab-separated-values": extract_csv_text,
    # Application types that are actually text
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

# All MIME types explicitly supported for extraction
EXTRACTABLE_MIME_TYPES: frozenset[str] = frozenset(_MIME_EXTRACTORS.keys())


def _normalize_mime(mime_type: str) -> str:
    """Strip codec parameters from a MIME type."""
    return mime_type.lower().split(";")[0].strip()


def can_extract(mime_type: str) -> bool:
    """Check whether text can be extracted from a given MIME type.

    Parameters
    ----------
    mime_type : str
        The MIME type to check.

    Returns
    -------
    bool
        True if extraction is supported (explicit mapping or text/* fallback).

    """
    normalized = _normalize_mime(mime_type)
    if normalized in _MIME_EXTRACTORS:
        return True
    # text/* fallback
    return normalized.startswith("text/")


def extract_text(
    data: bytes,
    mime_type: str,
    *,
    max_chars: int = DEFAULT_MAX_CHARS,
) -> ExtractionResult:
    """Extract text from file bytes based on MIME type.

    Routes to the correct extractor based on MIME type.
    Any ``text/*`` type not explicitly mapped falls through to plain text extraction.

    Parameters
    ----------
    data : bytes
        Raw file bytes.
    mime_type : str
        MIME type of the file.
    max_chars : int
        Maximum characters to extract (default 200,000).

    Returns
    -------
    ExtractionResult
        The extracted text and metadata.

    Raises
    ------
    UnsupportedFormatError
        If the MIME type is not supported for extraction.

    """
    normalized = _normalize_mime(mime_type)

    extractor = _MIME_EXTRACTORS.get(normalized)
    if extractor is not None:
        return extractor(data, max_chars)

    # text/* fallback
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
