"""Tests for core.content.references shared module."""

from uuid import UUID

import pytest

from uniffy.core.content.references import (
    INLINE_FILE_URL_PATTERN,
    MENTION_PATTERN,
    extract_all_outgoing_references,
    extract_inline_file_ids,
    extract_urns_from_content,
    parse_urn,
)
from uniffy.core.types import ContentType


class TestExtractUrnsFromContent:
    """Tests for extract_urns_from_content."""

    @pytest.mark.parametrize(
        "content,expected_urns",
        [
            # Basic mention
            (
                "[[[My Note|urn:uniffy:content:NOTE:123e4567-e89b-12d3-a456-426614174000]]]",
                ["urn:uniffy:content:NOTE:123e4567-e89b-12d3-a456-426614174000"],
            ),
            # Multiple mentions
            (
                "Check [[[Note A|urn:uniffy:content:NOTE:aaa]]] "
                "and [[[Note B|urn:uniffy:content:NOTE:bbb]]]",
                ["urn:uniffy:content:NOTE:aaa", "urn:uniffy:content:NOTE:bbb"],
            ),
            # Different content types
            (
                "[[[John|urn:uniffy:content:USER:user-123]]] scheduled "
                "[[[Meeting|urn:uniffy:content:CALENDAR_EVENT:evt-456]]]",
                [
                    "urn:uniffy:content:USER:user-123",
                    "urn:uniffy:content:CALENDAR_EVENT:evt-456",
                ],
            ),
            # Escaped brackets
            (
                "\\[\\[\\[Escaped|urn:uniffy:content:NOTE:escaped-123\\]\\]\\]",
                ["urn:uniffy:content:NOTE:escaped-123"],
            ),
            # Empty content
            ("", []),
            # None-like empty
            ("   ", []),
            # No mentions
            ("Just plain text without any mentions", []),
            # Malformed mentions
            ("[[incomplete|urn:uniffy:content:NOTE:123]]", []),
            ("[[[no-pipe-urn:uniffy:content:NOTE:123]]]", []),
            # Non-uniffy URN
            ("[[[Invalid|urn:other:content:NOTE:123]]]", []),
            # Duplicate URNs deduplicated
            (
                "[[[Note|urn:uniffy:content:NOTE:same]]] "
                "and [[[Same Note|urn:uniffy:content:NOTE:same]]]",
                ["urn:uniffy:content:NOTE:same"],
            ),
            # Label with special characters
            (
                "[[[Note: Important!|urn:uniffy:content:NOTE:special-123]]]",
                ["urn:uniffy:content:NOTE:special-123"],
            ),
            # File type URN
            (
                "[[[Report.pdf|urn:uniffy:content:FILE:file-uuid-123]]]",
                ["urn:uniffy:content:FILE:file-uuid-123"],
            ),
        ],
    )
    def test_extraction(self, content: str, expected_urns: list[str]):
        """Test URN extraction from markdown content."""
        result = extract_urns_from_content(content)
        assert sorted(result) == sorted(expected_urns)

    def test_none_returns_empty(self):
        """Empty string returns empty list."""
        assert extract_urns_from_content("") == []


class TestExtractInlineFileIds:
    """Tests for extract_inline_file_ids."""

    def test_api_files_url(self):
        """Extracts file ID from /api/files/ URL."""
        org = "11111111-1111-1111-1111-111111111111"
        fid = "22222222-2222-2222-2222-222222222222"
        content = f"![image](/api/files/{org}/{fid})"
        result = extract_inline_file_ids(content)
        assert result == [UUID(fid)]

    def test_media_stream_url(self):
        """Extracts file ID from /media-stream/ URL."""
        org = "11111111-1111-1111-1111-111111111111"
        fid = "33333333-3333-3333-3333-333333333333"
        content = f"Video: /media-stream/{org}/{fid}"
        result = extract_inline_file_ids(content)
        assert result == [UUID(fid)]

    def test_api_thumbnails_url(self):
        """Extracts file ID from /api/thumbnails/ URL."""
        org = "11111111-1111-1111-1111-111111111111"
        fid = "44444444-4444-4444-4444-444444444444"
        content = f"![thumb](/api/thumbnails/{org}/{fid})"
        result = extract_inline_file_ids(content)
        assert result == [UUID(fid)]

    def test_multiple_urls_different_types(self):
        """Extracts file IDs from multiple URL patterns."""
        org = "11111111-1111-1111-1111-111111111111"
        f1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        f2 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
        f3 = "cccccccc-cccc-cccc-cccc-cccccccccccc"
        content = (
            f"![img](/api/files/{org}/{f1}) "
            f"![vid](/media-stream/{org}/{f2}) "
            f"![thumb](/api/thumbnails/{org}/{f3})"
        )
        result = extract_inline_file_ids(content)
        assert sorted(result) == sorted([UUID(f1), UUID(f2), UUID(f3)])

    def test_deduplicates_same_file(self):
        """Same file ID in multiple URLs is deduplicated."""
        org = "11111111-1111-1111-1111-111111111111"
        fid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        content = (
            f"![img](/api/files/{org}/{fid}) "
            f"and ![thumb](/api/thumbnails/{org}/{fid})"
        )
        result = extract_inline_file_ids(content)
        assert result == [UUID(fid)]

    def test_empty_content(self):
        """Empty content returns empty list."""
        assert extract_inline_file_ids("") == []

    def test_no_urls(self):
        """Content without file URLs returns empty list."""
        assert extract_inline_file_ids("Just some text") == []

    def test_invalid_uuid_skipped(self):
        """Invalid UUID in URL is silently skipped."""
        org = "11111111-1111-1111-1111-111111111111"
        content = f"![img](/api/files/{org}/not-a-uuid)"
        result = extract_inline_file_ids(content)
        assert result == []

    def test_org_filter_matches(self):
        """With organization_id, only matching org URLs are returned."""
        org = UUID("11111111-1111-1111-1111-111111111111")
        fid = "22222222-2222-2222-2222-222222222222"
        content = f"![image](/api/files/{org}/{fid})"
        result = extract_inline_file_ids(content, organization_id=org)
        assert result == [UUID(fid)]

    def test_org_filter_rejects_foreign_org(self):
        """With organization_id, URLs from other orgs are excluded."""
        my_org = UUID("11111111-1111-1111-1111-111111111111")
        foreign_org = "99999999-9999-9999-9999-999999999999"
        fid = "22222222-2222-2222-2222-222222222222"
        content = f"![image](/api/files/{foreign_org}/{fid})"
        result = extract_inline_file_ids(content, organization_id=my_org)
        assert result == []

    def test_org_filter_mixed(self):
        """With org filter, only same-org files are returned."""
        my_org = UUID("11111111-1111-1111-1111-111111111111")
        foreign = "99999999-9999-9999-9999-999999999999"
        f1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        f2 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
        content = (
            f"![mine](/api/files/{my_org}/{f1}) "
            f"![foreign](/api/files/{foreign}/{f2})"
        )
        result = extract_inline_file_ids(content, organization_id=my_org)
        assert result == [UUID(f1)]

    def test_no_org_filter_returns_all(self):
        """Without organization_id, all URLs are returned."""
        org1 = "11111111-1111-1111-1111-111111111111"
        org2 = "99999999-9999-9999-9999-999999999999"
        f1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        f2 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
        content = (
            f"![a](/api/files/{org1}/{f1}) "
            f"![b](/api/files/{org2}/{f2})"
        )
        result = extract_inline_file_ids(content)
        assert sorted(result) == sorted([UUID(f1), UUID(f2)])


class TestParseUrn:
    """Tests for parse_urn."""

    @pytest.mark.parametrize(
        "urn,expected",
        [
            (
                "urn:uniffy:content:NOTE:123e4567-e89b-12d3-a456-426614174000",
                (ContentType.NOTE, UUID("123e4567-e89b-12d3-a456-426614174000")),
            ),
            (
                "urn:uniffy:content:FILE:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                (ContentType.FILE, UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")),
            ),
            (
                "urn:uniffy:content:CALENDAR_EVENT:bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                (ContentType.CALENDAR_EVENT, UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")),
            ),
            (
                "urn:uniffy:content:USER:cccccccc-cccc-cccc-cccc-cccccccccccc",
                (ContentType.USER, UUID("cccccccc-cccc-cccc-cccc-cccccccccccc")),
            ),
        ],
    )
    def test_valid_urns(self, urn: str, expected: tuple[ContentType, UUID]):
        """Test parsing valid URNs."""
        result = parse_urn(urn)
        assert result == expected

    @pytest.mark.parametrize(
        "urn",
        [
            "",
            "not-a-urn",
            "urn:other:content:NOTE:123e4567-e89b-12d3-a456-426614174000",
            "urn:uniffy:content:UNKNOWN_TYPE:123e4567-e89b-12d3-a456-426614174000",
            "urn:uniffy:content:NOTE:not-a-uuid",
            "urn:uniffy:content:NOTE:",
            "urn:uniffy:content:",
            "urn:uniffy:content:NOTE",
        ],
    )
    def test_invalid_urns(self, urn: str):
        """Test that invalid URNs return None."""
        assert parse_urn(urn) is None

    def test_none_equivalent(self):
        """Empty string returns None."""
        assert parse_urn("") is None


class TestMentionPattern:
    """Tests for the MENTION_PATTERN regex."""

    def test_captures_label_and_urn(self):
        """Pattern captures label in group 1 and URN in group 2."""
        match = MENTION_PATTERN.search(
            "[[[My Note|urn:uniffy:content:NOTE:abc-123]]]"
        )
        assert match is not None
        assert match.group(1) == "My Note"
        assert match.group(2) == "urn:uniffy:content:NOTE:abc-123"

    def test_escaped_brackets(self):
        """Pattern matches escaped bracket variants."""
        match = MENTION_PATTERN.search(
            "\\[\\[\\[Escaped|urn:uniffy:content:NOTE:abc\\]\\]\\]"
        )
        assert match is not None
        assert match.group(2) == "urn:uniffy:content:NOTE:abc"

    def test_no_match_on_double_brackets(self):
        """Double brackets do not match."""
        match = MENTION_PATTERN.search("[[label|urn]]")
        assert match is None


class TestInlineFileUrlPattern:
    """Tests for the INLINE_FILE_URL_PATTERN regex."""

    @pytest.mark.parametrize(
        "url,expected_org,expected_file",
        [
            (
                "/api/files/11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222",
                "11111111-1111-1111-1111-111111111111",
                "22222222-2222-2222-2222-222222222222",
            ),
            (
                "/media-stream/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
            ),
            (
                "/api/thumbnails/cccccccc-cccc-cccc-cccc-cccccccccccc/dddddddd-dddd-dddd-dddd-dddddddddddd",
                "cccccccc-cccc-cccc-cccc-cccccccccccc",
                "dddddddd-dddd-dddd-dddd-dddddddddddd",
            ),
        ],
    )
    def test_matches_url_patterns(
        self, url: str, expected_org: str, expected_file: str
    ):
        """Pattern matches all supported URL prefixes and captures org + file UUIDs."""
        match = INLINE_FILE_URL_PATTERN.search(url)
        assert match is not None
        assert match.group(1) == expected_org
        assert match.group(2) == expected_file

    def test_no_match_on_unrelated_path(self):
        """Unrelated paths do not match."""
        assert INLINE_FILE_URL_PATTERN.search("/api/users/some-id") is None


class TestExtractAllOutgoingReferences:
    """Tests for extract_all_outgoing_references."""

    def test_empty_content(self):
        """Empty content returns empty list."""
        assert extract_all_outgoing_references("") == []

    def test_urn_mentions_only(self):
        """Content with only URN mentions returns those URNs."""
        content = (
            "[[[Note|urn:uniffy:content:NOTE:aaa]]] "
            "and [[[Event|urn:uniffy:content:CALENDAR_EVENT:bbb]]]"
        )
        result = sorted(extract_all_outgoing_references(content))
        assert result == sorted([
            "urn:uniffy:content:NOTE:aaa",
            "urn:uniffy:content:CALENDAR_EVENT:bbb",
        ])

    def test_inline_files_only(self):
        """Content with only inline file URLs returns FILE URNs."""
        org = "11111111-1111-1111-1111-111111111111"
        fid = "22222222-2222-2222-2222-222222222222"
        content = f"![image](/api/files/{org}/{fid})"
        result = extract_all_outgoing_references(content)
        assert result == [
            f"urn:uniffy:content:FILE:{fid}",
        ]

    def test_combined_mentions_and_inline_files(self):
        """Content with both URN mentions and inline files returns all."""
        org = "11111111-1111-1111-1111-111111111111"
        fid = "22222222-2222-2222-2222-222222222222"
        content = (
            "[[[My Note|urn:uniffy:content:NOTE:aaa]]] "
            f"![image](/api/files/{org}/{fid})"
        )
        result = sorted(extract_all_outgoing_references(content))
        assert result == sorted([
            "urn:uniffy:content:NOTE:aaa",
            f"urn:uniffy:content:FILE:{fid}",
        ])

    def test_deduplicates_file_mentioned_and_inline(self):
        """File referenced both as URN mention and inline URL is deduplicated."""
        org = "11111111-1111-1111-1111-111111111111"
        fid = "22222222-2222-2222-2222-222222222222"
        content = (
            f"[[[Report|urn:uniffy:content:FILE:{fid}]]] "
            f"![image](/api/files/{org}/{fid})"
        )
        result = extract_all_outgoing_references(content)
        assert result == [f"urn:uniffy:content:FILE:{fid}"]

    def test_org_filter_applied_to_inline_files(self):
        """Organization filter excludes inline files from other orgs."""
        my_org = UUID("11111111-1111-1111-1111-111111111111")
        foreign = "99999999-9999-9999-9999-999999999999"
        my_fid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        foreign_fid = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
        content = (
            f"![mine](/api/files/{my_org}/{my_fid}) "
            f"![foreign](/api/files/{foreign}/{foreign_fid})"
        )
        result = extract_all_outgoing_references(
            content, organization_id=my_org
        )
        assert result == [f"urn:uniffy:content:FILE:{my_fid}"]

    def test_org_filter_does_not_affect_urn_mentions(self):
        """Organization filter only applies to inline files, not URN mentions."""
        my_org = UUID("11111111-1111-1111-1111-111111111111")
        content = "[[[Note|urn:uniffy:content:NOTE:aaa]]]"
        result = extract_all_outgoing_references(
            content, organization_id=my_org
        )
        assert result == ["urn:uniffy:content:NOTE:aaa"]

    def test_multiple_inline_file_types(self):
        """Inline files from api/files, media-stream, and thumbnails."""
        org = "11111111-1111-1111-1111-111111111111"
        f1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        f2 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
        f3 = "cccccccc-cccc-cccc-cccc-cccccccccccc"
        content = (
            f"![img](/api/files/{org}/{f1}) "
            f"![vid](/media-stream/{org}/{f2}) "
            f"![thumb](/api/thumbnails/{org}/{f3})"
        )
        result = sorted(extract_all_outgoing_references(content))
        expected = sorted([
            f"urn:uniffy:content:FILE:{f1}",
            f"urn:uniffy:content:FILE:{f2}",
            f"urn:uniffy:content:FILE:{f3}",
        ])
        assert result == expected
