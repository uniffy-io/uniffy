"""Tests for regex patterns used across the backend."""

import pytest

from uniffy.core.content.references import (
    MENTION_PATTERN,
    extract_urns_from_content,
)
from uniffy.core.types import slugify
from uniffy.domains.notes.queries import (
    extract_inline_tags_from_content,
)


class TestMentionPattern:
    """Tests for URN mention pattern [[[label|urn]]]."""

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
            # Escaped brackets (some editors escape them)
            (
                "\\[\\[\\[Escaped|urn:uniffy:content:NOTE:escaped-123\\]\\]\\]",
                ["urn:uniffy:content:NOTE:escaped-123"],
            ),
            # Empty content
            ("", []),
            # No mentions
            ("Just plain text without any mentions", []),
            # Malformed mentions (should not match)
            ("[[incomplete|urn:uniffy:content:NOTE:123]]", []),
            ("[[[no-pipe-urn:uniffy:content:NOTE:123]]]", []),
            # Mention with special characters in label
            (
                "[[[Note: Important!|urn:uniffy:content:NOTE:special-123]]]",
                ["urn:uniffy:content:NOTE:special-123"],
            ),
            # Duplicate URNs should be deduplicated
            (
                "[[[Note|urn:uniffy:content:NOTE:same]]] "
                "and [[[Same Note|urn:uniffy:content:NOTE:same]]]",
                ["urn:uniffy:content:NOTE:same"],
            ),
            # URN must start with urn:uniffy:
            (
                "[[[Invalid|urn:other:content:NOTE:123]]]",
                [],
            ),
        ],
    )
    def test_extract_urns_from_content(self, content: str, expected_urns: list[str]):
        """Test URN extraction from markdown content."""
        result = extract_urns_from_content(content)
        assert sorted(result) == sorted(expected_urns)

    def test_mention_pattern_matches_calendar_events(self):
        """Shared mention pattern matches calendar event URNs."""
        test_content = "[[[Event|urn:uniffy:content:CALENDAR_EVENT:evt-123]]]"
        match = MENTION_PATTERN.search(test_content)
        assert match is not None
        assert match.group(1) == "Event"
        assert match.group(2) == "urn:uniffy:content:CALENDAR_EVENT:evt-123"


class TestInlineTagPattern:
    """Tests for inline tag pattern [[[tag|tagname]]]."""

    @pytest.mark.parametrize(
        "content,expected_tags",
        [
            # Single tag
            ("[[[tag|work]]]", ["work"]),
            # Multiple tags
            ("[[[tag|work]]] and [[[tag|important]]]", ["important", "work"]),
            # Tag with spaces (should be trimmed)
            ("[[[tag| spacey ]]]", ["spacey"]),
            # Tags are lowercased
            ("[[[tag|UPPERCASE]]]", ["uppercase"]),
            # Mixed case
            ("[[[tag|MixedCase]]]", ["mixedcase"]),
            # Empty content
            ("", []),
            # No tags
            ("Plain text without tags", []),
            # Duplicate tags should be deduplicated
            ("[[[tag|duplicate]]] [[[tag|duplicate]]]", ["duplicate"]),
            # Tag vs mention (should not confuse them)
            ("[[[tag|mytag]]] [[[Note|urn:uniffy:content:NOTE:123]]]", ["mytag"]),
            # Tag with hyphen
            ("[[[tag|my-tag]]]", ["my-tag"]),
            # Tag with numbers
            ("[[[tag|tag123]]]", ["tag123"]),
        ],
    )
    def test_extract_inline_tags(self, content: str, expected_tags: list[str]):
        """Test inline tag extraction from markdown content."""
        result = extract_inline_tags_from_content(content)
        assert result == sorted(expected_tags)


class TestSlugify:
    """Tests for slugify function."""

    @pytest.mark.parametrize(
        "text,expected",
        [
            # Basic text
            ("Hello World", "hello-world"),
            # Already lowercase
            ("hello world", "hello-world"),
            # Special characters removed
            ("Hello! World?", "hello-world"),
            # Multiple spaces collapsed
            ("Hello    World", "hello-world"),
            # Multiple hyphens collapsed
            ("Hello---World", "hello-world"),
            # Mixed whitespace
            ("Hello\tWorld\nTest", "hello-world-test"),
            # Leading/trailing whitespace
            ("  Hello World  ", "hello-world"),
            # Numbers preserved
            ("Chapter 1", "chapter-1"),
            # Unicode word characters preserved
            ("Héllo Wörld", "héllo-wörld"),
            # Empty string
            ("", ""),
            # Only special chars
            ("!@#$%", ""),
            # Underscores preserved (word chars in regex)
            ("hello_world", "hello_world"),
        ],
    )
    def test_slugify(self, text: str, expected: str):
        """Test text slugification."""
        assert slugify(text) == expected

    def test_slugify_truncates_long_text(self):
        """Slugify should truncate to 500 characters."""
        long_text = "a" * 1000
        result = slugify(long_text)
        assert len(result) == 500
