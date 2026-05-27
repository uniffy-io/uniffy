"""Plain text and structured text extraction."""

import csv
import io

from uniffy.core.extraction.types import ExtractionResult


def extract_plain_text(data: bytes, max_chars: int) -> ExtractionResult:
    """Decode a plain-text file as UTF-8 with BOM stripping and replacement fallback."""
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
    """Parse CSV/TSV with stdlib csv and emit tab-separated rows."""
    if data.startswith(b"\xef\xbb\xbf"):
        data = data[3:]

    text_str = data.decode("utf-8", errors="replace")

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
