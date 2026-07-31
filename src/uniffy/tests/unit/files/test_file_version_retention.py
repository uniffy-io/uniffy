"""Tests for file version retention selection and policy resolution."""


import pytest

from uniffy.core.models.files.file_version import FileVersion
from uniffy.core.types import generate_id
from uniffy.domains.files.version_policy import (
    DEFAULT_KEEP_VERSIONS,
    MAX_KEEP_VERSIONS,
    MIN_KEEP_VERSIONS,
    clamp_keep_versions,
    env_default_keep_versions,
    select_versions_to_prune,
)


def _version(number: int, size: int = 100) -> FileVersion:
    return FileVersion(
        id=generate_id(),
        file_id=generate_id(),
        version_number=number,
        size_bytes=size,
        storage_key=f"org/user/{number}/file.bin",
        storage_bucket="uniffy-files",
        uploaded_by=generate_id(),
    )


class TestSelectVersionsToPrune:
    def test_keeps_newest_n(self):
        versions = [_version(n) for n in range(1, 8)]
        current = versions[-1]

        pruned = select_versions_to_prune(versions, 3, current.id)

        assert sorted(v.version_number for v in pruned) == [1, 2, 3, 4]

    def test_nothing_pruned_at_or_below_limit(self):
        versions = [_version(n) for n in range(1, 4)]

        assert select_versions_to_prune(versions, 3, versions[-1].id) == []
        assert select_versions_to_prune(versions, 10, versions[-1].id) == []

    def test_empty_history(self):
        assert select_versions_to_prune([], 5, None) == []

    def test_current_version_survives_even_when_old(self):
        versions = [_version(n) for n in range(1, 8)]
        old_current = versions[0]

        pruned = select_versions_to_prune(versions, 3, old_current.id)

        assert old_current.id not in {v.id for v in pruned}
        assert sorted(v.version_number for v in pruned) == [2, 3, 4]

    def test_floor_of_one(self):
        versions = [_version(n) for n in range(1, 5)]
        current = versions[-1]

        pruned = select_versions_to_prune(versions, 0, current.id)

        assert sorted(v.version_number for v in pruned) == [1, 2, 3]
        assert current.id not in {v.id for v in pruned}

    def test_input_order_does_not_matter(self):
        versions = [_version(n) for n in (3, 1, 5, 2, 4)]
        current = next(v for v in versions if v.version_number == 5)

        pruned = select_versions_to_prune(versions, 2, current.id)

        assert sorted(v.version_number for v in pruned) == [1, 2, 3]


class TestClampKeepVersions:
    @pytest.mark.parametrize(
        "value,expected",
        [
            (0, MIN_KEEP_VERSIONS),
            (-5, MIN_KEEP_VERSIONS),
            (1, 1),
            (50, 50),
            (100, MAX_KEEP_VERSIONS),
            (10_000, MAX_KEEP_VERSIONS),
        ],
    )
    def test_clamp(self, value: int, expected: int):
        assert clamp_keep_versions(value) == expected


class TestEnvDefault:
    def test_unset_uses_coded_default(self, monkeypatch):
        monkeypatch.delenv("FILE_VERSION_RETENTION", raising=False)
        assert env_default_keep_versions() == DEFAULT_KEEP_VERSIONS

    def test_env_value_wins(self, monkeypatch):
        monkeypatch.setenv("FILE_VERSION_RETENTION", "25")
        assert env_default_keep_versions() == 25

    def test_env_value_is_clamped(self, monkeypatch):
        monkeypatch.setenv("FILE_VERSION_RETENTION", "0")
        assert env_default_keep_versions() == MIN_KEEP_VERSIONS

    def test_garbage_falls_back_to_default(self, monkeypatch):
        monkeypatch.setenv("FILE_VERSION_RETENTION", "many")
        assert env_default_keep_versions() == DEFAULT_KEEP_VERSIONS

    def test_blank_falls_back_to_default(self, monkeypatch):
        monkeypatch.setenv("FILE_VERSION_RETENTION", "  ")
        assert env_default_keep_versions() == DEFAULT_KEEP_VERSIONS
