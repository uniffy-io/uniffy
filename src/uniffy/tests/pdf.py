import io
from collections.abc import Sequence

from reportlab.pdfgen.canvas import Canvas


def make_pdf(
    pages: Sequence[str] = ("Hello PDF World",),
    *,
    rotation: int = 0,
    password: str | None = None,
) -> bytes:
    output = io.BytesIO()
    # ReportLab swaps the media box dimensions for quarter-turn page rotations.
    page_size = (400, 200) if rotation in (90, 270) else (200, 400)
    document = Canvas(output, pagesize=page_size, invariant=True, encrypt=password)
    for text in pages:
        document.setPageRotation(rotation)
        document.setFont("Helvetica", 12)
        document.drawString(20, 100, text)
        document.showPage()
    document.save()
    return output.getvalue()
