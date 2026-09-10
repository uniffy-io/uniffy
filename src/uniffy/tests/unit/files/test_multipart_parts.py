"""Every multipart part except the final one must meet the S3 minimum size."""

from uniffy.domains.files.uploads import MIN_CHUNK_SIZE, undersized_part_numbers


def test_final_part_may_be_any_size() -> None:
    assert undersized_part_numbers([(1, MIN_CHUNK_SIZE), (2, 1)]) == []


def test_single_part_is_always_legal() -> None:
    assert undersized_part_numbers([(1, 1)]) == []


def test_empty_parts() -> None:
    assert undersized_part_numbers([]) == []


def test_reports_every_undersized_non_final_part() -> None:
    parts = [(1, MIN_CHUNK_SIZE - 1), (2, MIN_CHUNK_SIZE), (3, 10), (4, 1)]
    assert undersized_part_numbers(parts) == [1, 3]
