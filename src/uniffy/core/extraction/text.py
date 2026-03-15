"""Plain text and structured text extraction."""

import csv
import io

from uniffy.core.extraction.types import ExtractionResult


def extract_plain_text(data: bytes, max_chars: int) -> ExtractionResult:
    """Extract text from a plain text file.

    Handles UTF-8 with BOM detection and fallback.

    Parameters
    ----------
    data : bytes
        Raw file bytes.
    max_chars : int
        Maximum characters to return.

    Returns
    -------
    ExtractionResult
        Extracted text content.

    """
    # Handle BOM
    if data.startswith(b"\xef\xbb\xbf"):
        data = data[3:]

    text = data.decode("utf-8", errors="replace")

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


def extract_csv_text(data: bytes, max_chars: int) -> ExtractionResult:
    """Extract text from a CSV or TSV file.

    Parses using stdlib csv module, joins cells with tabs.

    Parameters
    ----------
    data : bytes
        Raw CSV/TSV file bytes.
    max_chars : int
        Maximum characters to return.

    Returns
    -------
    ExtractionResult
        Extracted text with tab-separated values.

    """
    # Handle BOM
    if data.startswith(b"\xef\xbb\xbf"):
        data = data[3:]

    text_str = data.decode("utf-8", errors="replace")

    # Detect delimiter
    sniffer = csv.Sniffer()
    try:
        dialect = sniffer.sniff(text_str[:4096])
    except csv.Error:
        dialect = csv.excel

    reader = csv.reader(io.StringIO(text_str), dialect)
    parts: list[str] = []
    total_chars = 0
    truncated = False

    for row in reader:
        row_text = "\t".join(row)
        parts.append(row_text)
        total_chars += len(row_text)
        if total_chars >= max_chars:
            truncated = True
            break

    text = "\n".join(parts)
    if len(text) > max_chars:
        text = text[:max_chars]
        truncated = True

    word_count = len(text.split()) if text.strip() else 0

    return ExtractionResult(
        text=text,
        word_count=word_count,
        truncated=truncated,
    )
