"""Range-header parsing for the media stream route.

Players probe with ``bytes=0-`` then seek with ``bytes=N-``; the parser must also handle explicit
end positions, suffix ranges, and clamp anything past the object size so S3 never sees a bad Range.
"""

from __future__ import annotations

from typing import cast

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.storage import ObjectStorage
from uniffy.domains.files.operations import FileOperations
from uniffy.domains.files.routes import _parse_range

_TOTAL = 1000


def test_asset_read_operations_do_not_require_search_indexer() -> None:
    session = cast(AsyncSession, object())
    storage = cast(ObjectStorage, object())

    operations = FileOperations(session, storage)

    assert operations.storage is storage


@pytest.mark.parametrize(
    ("header", "expected"),
    [
        ("bytes=0-", (0, 999)),
        ("bytes=0-499", (0, 499)),
        ("bytes=500-", (500, 999)),
        ("bytes=500-700", (500, 700)),
        ("bytes=-200", (800, 999)),  # suffix: last 200 bytes
        ("bytes=-", (0, 999)),  # degenerate: whole object
        ("garbage", (0, 999)),  # unparseable falls back to the whole object
    ],
)
def test_parse_range(header: str, expected: tuple[int, int]) -> None:
    assert _parse_range(header, _TOTAL) == expected


def test_parse_range_clamps_start_and_end_to_object_size() -> None:
    assert _parse_range("bytes=5000-9000", _TOTAL) == (999, 999)
    assert _parse_range("bytes=200-9000", _TOTAL) == (200, 999)


def test_parse_range_suffix_larger_than_object_starts_at_zero() -> None:
    assert _parse_range("bytes=-5000", _TOTAL) == (0, 999)
