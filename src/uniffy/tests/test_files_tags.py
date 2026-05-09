"""Unit tests for the files <-> tags wiring.

Covers the pure-Python pieces that don't require a live DB:

- ``FileOperations._build_search_keywords`` emits the file metadata stream
  without per-tag tokens (the tag-assignment table is the source of truth).
- ``FileOperations._tag_filter_subquery`` builds the right join shape for
  the ``ListFilesRequest.tag_ids[]`` filter.
- ``criteria_to_proto`` / ``criteria_from_proto`` on saved file filters
  round-trip the ``tag_ids`` shape.

Live-DB integration coverage runs under the files-domain harness.
"""

from unittest.mock import MagicMock
from uuid import uuid4

from uniffy_proto.files.v1.files_pb2 import FilterCriteria as ProtoFilterCriteria

from uniffy.core.models.files.file import ExtractionStatus, File
from uniffy.core.models.files.media_info import FileMediaInfo
from uniffy.core.types import AccessMode, generate_id
from uniffy.domains.files.filters.converters import (
    criteria_from_proto,
    criteria_to_proto,
)
from uniffy.domains.files.operations import FileOperations


def _make_file(*, description: str | None = None, with_extracted_text: str | None = None) -> File:
    file = File(
        organization_id=uuid4(),
        owner_id=uuid4(),
        access_mode=AccessMode.OWNER_ONLY,
        filename="report.pdf",
        original_filename="report.pdf",
        mime_type="application/pdf",
        size_bytes=1234,
        storage_key="org/user/uuid/report.pdf",
        storage_bucket="bucket",
        description=description,
        extraction_status=ExtractionStatus.SKIPPED,
    )
    if with_extracted_text is not None:
        file.media_info = FileMediaInfo(
            file_id=file.id,
            extracted_text=with_extracted_text,
        )
    return file


def _make_ops() -> FileOperations:
    ops = FileOperations.__new__(FileOperations)
    ops.session = MagicMock()
    ops.s3 = MagicMock()
    return ops


class TestBuildSearchKeywords:
    def test_keywords_do_not_emit_per_tag_tokens(self) -> None:
        ops = _make_ops()
        file = _make_file(description="Quarterly review deck")
        out = ops._build_search_keywords(file)
        # The dedicated tag-assignment table is the source of truth; the
        # keyword stream must not smuggle in `tag:{slug}` tokens.
        assert "tag:" not in out
        assert "report.pdf" in out
        assert "Quarterly review deck" in out
        assert "application/pdf" in out

    def test_keywords_include_extracted_text(self) -> None:
        ops = _make_ops()
        file = _make_file(with_extracted_text="alpha beta gamma extracted body")
        out = ops._build_search_keywords(file)
        assert "alpha beta gamma extracted body" in out


class TestTagFilterSubquery:
    def test_subquery_groups_and_requires_full_set(self) -> None:
        ops = _make_ops()
        tag_ids = [generate_id(), generate_id()]
        subquery = ops._tag_filter_subquery(tag_ids)
        compiled = str(
            subquery.compile(compile_kwargs={"literal_binds": False})
        ).lower()
        assert "tag_assignments" in compiled
        assert "files_files" in compiled
        assert "group by" in compiled
        # The HAVING clause must require every tag id in the set, not
        # just any. ``COUNT(DISTINCT tag_id) == len(tag_ids)`` enforces
        # the logical AND that mirrors notes' filter shape.
        assert "having" in compiled
        assert "count(distinct" in compiled


class TestSavedFilterCriteriaRoundTrip:
    def test_dict_to_proto_uses_tag_ids(self) -> None:
        tag_id = str(generate_id())
        proto = criteria_to_proto({"tag_ids": [tag_id]})
        assert list(proto.tag_ids) == [tag_id]

    def test_dict_to_proto_drops_unknown_tags_key(self) -> None:
        # Only the ``tag_ids`` shape is surfaced; any stray ``tags`` key in
        # a stored criteria dict gets the criterion silently dropped.
        proto = criteria_to_proto({"tags": ["work"]})
        assert list(proto.tag_ids) == []

    def test_proto_to_dict_round_trip(self) -> None:
        tag_a = str(generate_id())
        tag_b = str(generate_id())
        proto = ProtoFilterCriteria(tag_ids=[tag_a, tag_b])
        out = criteria_from_proto(proto)
        assert out["tag_ids"] == [tag_a, tag_b]
        assert "tags" not in out

    def test_empty_proto_round_trip_drops_tag_ids(self) -> None:
        out = criteria_from_proto(ProtoFilterCriteria())
        assert "tag_ids" not in out
        assert "tags" not in out
