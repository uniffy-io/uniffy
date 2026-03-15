"""PDF text extraction using PyMuPDF."""

from uniffy.core.extraction.types import ExtractionResult


def extract_pdf_text(data: bytes, max_chars: int) -> ExtractionResult:
    """Extract text from a PDF document.

    Extracts text page by page with page headers. Stops when
    max_chars is reached.

    Parameters
    ----------
    data : bytes
        Raw PDF file bytes.
    max_chars : int
        Maximum characters to return.

    Returns
    -------
    ExtractionResult
        Extracted text with page_count metadata.

    """
    import fitz

    doc = fitz.open(stream=data, filetype="pdf")
    pages: list[str] = []
    total_chars = 0
    truncated = False

    try:
        for page_num in range(len(doc)):
            page_text = doc[page_num].get_text()
            pages.append(f"--- Page {page_num + 1} ---\n{page_text}")
            total_chars += len(page_text)
            if total_chars >= max_chars:
                truncated = True
                break

        text = "\n\n".join(pages)
        if len(text) > max_chars:
            text = text[:max_chars]
            truncated = True

        if not text.strip():
            text = "PDF contains no extractable text (may be scanned/image-based)."

        word_count = len(text.split()) if text.strip() else 0

        return ExtractionResult(
            text=text,
            page_count=len(doc),
            word_count=word_count,
            truncated=truncated,
        )
    finally:
        doc.close()
