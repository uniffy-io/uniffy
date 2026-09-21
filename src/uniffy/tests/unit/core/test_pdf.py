import io

import pytest
from PIL import Image

from uniffy.core.extraction.pdf import extract_pdf_text, render_pdf_page
from uniffy.tests.pdf import make_pdf


def test_pdf_thumbnail_fits_bounds():
    rendered = render_pdf_page(make_pdf(), (400, 400))
    with Image.open(io.BytesIO(rendered)) as image:
        assert 0 < image.width <= 400 and 0 < image.height <= 400


def test_blank_pdf_reports_no_extractable_text():
    result = extract_pdf_text(make_pdf([""]), 1000)
    assert "no extractable text" in result.text
    assert result.page_count == 1


def test_unicode_pdf_text_survives_extraction():
    result = extract_pdf_text(make_pdf(["Café déjà vu"]), 1000)
    assert "Café déjà vu" in result.text


def test_rotated_pdf_thumbnail_and_text():
    data = make_pdf(["Rotation text"], rotation=90)
    assert "Rotation text" in extract_pdf_text(data, 1000).text
    with Image.open(io.BytesIO(render_pdf_page(data, (400, 400)))) as image:
        assert image.size == (400, 200)


@pytest.mark.parametrize("protected", [False, True])
def test_invalid_and_password_protected_pdf_fail(protected):
    data = make_pdf(password="secret") if protected else b"not a pdf"
    with pytest.raises(Exception):
        extract_pdf_text(data, 1000)
    with pytest.raises(Exception):
        render_pdf_page(data, (400, 400))
