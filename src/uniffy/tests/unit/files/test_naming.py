"""Filename rules: extension detection and RFC 6266 disposition headers."""

import pytest

from uniffy.domains.files.naming import content_disposition, file_extension


@pytest.mark.parametrize(
    ("filename", "expected"),
    [
        ("clip.mp4", ".mp4"),
        ("archive.tar.gz", ".gz"),
        ("Screen Recording 2026-09-10 12.55.56.mp4", ".mp4"),
        ("README", ""),
        (".bashrc", ""),
        ("trailing.", ""),
        ("", ""),
    ],
)
def test_file_extension(filename: str, expected: str) -> None:
    assert file_extension(filename) == expected


def test_ascii_name_uses_plain_filename() -> None:
    assert content_disposition("inline", "clip 1.mp4") == 'inline; filename="clip 1.mp4"'


def test_non_ascii_name_rides_filename_star() -> None:
    value = content_disposition("inline", "1ф.mp4")
    assert value == "inline; filename=\"1?.mp4\"; filename*=UTF-8''1%D1%84.mp4"
    value.encode("latin-1")


def test_quotes_never_break_the_quoted_string() -> None:
    value = content_disposition("attachment", 'say "hi".txt')
    assert value.startswith('attachment; filename="say _hi_.txt"')
    assert "filename*=UTF-8''say%20%22hi%22.txt" in value


@pytest.mark.parametrize("control", ["\r", "\n", "\x00", "\x7f"])
def test_control_characters_never_enter_the_header(control: str) -> None:
    value = content_disposition("attachment", f"report{control}.txt")
    assert value.startswith('attachment; filename="report_.txt"')
    assert all(char.isprintable() for char in value)
