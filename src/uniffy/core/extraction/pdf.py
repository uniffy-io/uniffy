"""Serialize PDFium access across extraction and page rendering."""

import io
from contextlib import closing
from threading import RLock

import pypdfium2 as pdfium

from uniffy.core.extraction.types import ExtractionResult

_PDFIUM_LOCK = RLock()


def extract_pdf_text(data: bytes, max_chars: int) -> ExtractionResult:
    with _PDFIUM_LOCK, pdfium.PdfDocument(data) as document:
        pages: list[str] = []
        remaining = max_chars
        truncated = False
        has_text = False
        for index in range(len(document)):
            with closing(document[index]) as page, closing(page.get_textpage()) as textpage:
                text = textpage.get_text_bounded()
            has_text = has_text or bool(text.strip())
            chunk = f"Page {index + 1}\n{text}"
            if pages:
                chunk = "\n\n" + chunk
            pages.append(chunk[:remaining])
            remaining -= len(chunk)
            if remaining <= 0:
                truncated = len(chunk) > len(pages[-1]) or index + 1 < len(document)
                break
        text = "".join(pages)
        if not has_text and not truncated:
            text = "PDF contains no extractable text (may be scanned/image-based)."[:max_chars]
        return ExtractionResult(
            text=text,
            page_count=len(document),
            word_count=len(text.split()),
            truncated=truncated,
        )


def render_pdf_page(data: bytes, max_size: tuple[int, int]) -> bytes:
    with _PDFIUM_LOCK, pdfium.PdfDocument(data) as document:
        if not len(document):
            raise ValueError("PDF has no pages")
        with closing(document[0]) as page:
            width, height = page.get_size()
            scale = min(max_size[0] / width, max_size[1] / height, 2.0)
            with closing(page.render(scale=scale)) as bitmap, bitmap.to_pil() as image:
                output = io.BytesIO()
                image.save(output, format="PNG")
                return output.getvalue()
