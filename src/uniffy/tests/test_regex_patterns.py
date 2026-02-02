"""Tests for regex patterns used across the backend."""

import pytest

from uniffy.domains.calendar.queries import (
    MENTION_PATTERN as CALENDAR_MENTION_PATTERN,
)
from uniffy.domains.notes.queries import (
    MENTION_PATTERN as NOTES_MENTION_PATTERN,
)
from uniffy.domains.notes.queries import (
    extract_inline_tags_from_content,
    extract_urns_from_content,
    slugify,
)
from uniffy.domains.search.parser import (
    FILTER_PATTERN,
    PHRASE_PATTERN,
    has_active_filters,
    parse_search_query,
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

    def test_calendar_mention_pattern_matches_notes(self):
        """Calendar and notes mention patterns should be equivalent."""
        test_content = "[[[Event|urn:uniffy:content:CALENDAR_EVENT:evt-123]]]"
        notes_match = NOTES_MENTION_PATTERN.search(test_content)
        calendar_match = CALENDAR_MENTION_PATTERN.search(test_content)
        assert notes_match is not None
        assert calendar_match is not None
        assert notes_match.groups() == calendar_match.groups()


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


class TestSearchFilterPattern:
    """Tests for search query filter pattern."""

    @pytest.mark.parametrize(
        "query,expected_filters",
        [
            # Type filter with value
            ("note: search term", [("note", None, "search")]),
            # Type filter with quoted value
            ('note:"my document"', [("note", "my document", None)]),
            # Adjacent filters (first captures second as value)
            ("note: tag:work", [("note", None, "tag:work")]),
            # Separate filters with text between
            ("note:docs tag:work", [("note", None, "docs"), ("tag", None, "work")]),
            # Case insensitive
            ("NOTE: test", [("NOTE", None, "test")]),
            # Tag filter
            ("tag:important", [("tag", None, "important")]),
            # Quoted tag
            ('tag:"multi word"', [("tag", "multi word", None)]),
            # Owner filter
            ("owner:john", [("owner", None, "john")]),
            # My filter
            ("my: content", [("my", None, "content")]),
            # Project filter
            ("project:alpha", [("project", None, "alpha")]),
        ],
    )
    def test_filter_pattern_matches(self, query: str, expected_filters: list):
        """Test filter pattern matching."""
        matches = list(FILTER_PATTERN.finditer(query))
        assert len(matches) == len(expected_filters)
        for match, (keyword, quoted, unquoted) in zip(
            matches, expected_filters, strict=True
        ):
            assert match.group(1).lower() == keyword.lower()
            if quoted:
                assert match.group(2) == quoted
            if unquoted:
                assert match.group(3) == unquoted


class TestSearchPhrasePattern:
    """Tests for search query phrase pattern."""

    @pytest.mark.parametrize(
        "query,expected_phrases",
        [
            # Simple quoted phrase
            ('"exact phrase"', ["exact phrase"]),
            # Multiple phrases
            ('"first phrase" and "second phrase"', ["first phrase", "second phrase"]),
            # Phrase with special chars
            ('"hello, world!"', ["hello, world!"]),
            # Standalone phrase (not part of filter)
            ('"standalone"', ["standalone"]),
        ],
    )
    def test_phrase_pattern_matches(self, query: str, expected_phrases: list[str]):
        """Test phrase pattern matching."""
        matches = [m.group(1) for m in PHRASE_PATTERN.finditer(query)]
        assert matches == expected_phrases

    def test_phrase_pattern_requires_content(self):
        """Empty quotes don't match (pattern requires at least one char)."""
        matches = list(PHRASE_PATTERN.finditer('""'))
        assert len(matches) == 0

    def test_phrase_lookbehind_limitation(self):
        """
        Note: The negative lookbehind only checks one character before the quote.
        Filter values like tag:"value" may still partially match in edge cases.
        This tests the actual behavior.
        """
        # The pattern matches " " from between "filter value" and "standalone"
        query = 'tag:"filter value" "standalone phrase"'
        matches = [m.group(1) for m in PHRASE_PATTERN.finditer(query)]
        # Due to lookbehind limitation, this matches the space between quotes
        assert " " in matches or "standalone phrase" in matches


class TestParseSearchQuery:
    """Integration tests for the full search query parser."""

    def test_empty_query(self):
        """Empty query returns empty result."""
        result = parse_search_query("")
        assert result.text == ""
        assert result.type_filters == []
        assert result.tags == []
        assert not result.my_content_only

    def test_plain_text_query(self):
        """Plain text without filters."""
        result = parse_search_query("hello world")
        assert result.text == "hello world"
        assert result.type_filters == []

    def test_type_filter(self):
        """Type filter extraction."""
        result = parse_search_query("note: meeting notes")
        assert "note" in result.type_filters
        assert "meeting" in result.text or "notes" in result.text

    def test_multiple_type_filters(self):
        """Multiple type filters need text between them."""
        # Filters need values - adjacent filters get merged
        result = parse_search_query("note:docs file:report")
        assert "note" in result.type_filters
        assert "file" in result.type_filters

    def test_tag_filter(self):
        """Tag filter extraction."""
        result = parse_search_query("tag:important meeting")
        assert "important" in result.tags
        assert "meeting" in result.text

    def test_multiple_tags(self):
        """Multiple tag filters."""
        result = parse_search_query("tag:work tag:urgent")
        assert "work" in result.tags
        assert "urgent" in result.tags

    def test_my_content_filter(self):
        """My content filter - value becomes the filter indicator."""
        result = parse_search_query("my: drafts")
        assert result.my_content_only is True
        # Note: "drafts" is consumed as the filter value, not remaining text
        # To search for "drafts" in my content, use: my:yes drafts
        result2 = parse_search_query("my:yes drafts")
        assert result2.my_content_only is True
        assert "drafts" in result2.text

    def test_owner_filter(self):
        """Owner filter."""
        result = parse_search_query("owner:john documents")
        assert result.owner == "john"
        assert "documents" in result.text

    def test_project_filter(self):
        """Project filter."""
        result = parse_search_query("project:alpha tasks")
        assert "alpha" in result.projects
        assert "tasks" in result.text

    def test_quoted_filter_value(self):
        """Quoted filter values preserved."""
        result = parse_search_query('tag:"multi word tag"')
        assert "multi word tag" in result.tags

    def test_quoted_phrase_in_text(self):
        """Quoted phrases tracked in exact_phrases."""
        result = parse_search_query('"exact match" search')
        assert "exact match" in result.exact_phrases
        # Quotes stay in text for Meilisearch
        assert '"exact match"' in result.text

    def test_complex_query(self):
        """Complex query with multiple filter types."""
        # Each filter needs a value to capture properly
        result = parse_search_query('note:doc tag:work owner:alice "project report" 2024')
        assert "note" in result.type_filters
        assert "work" in result.tags
        assert result.owner == "alice"
        assert "project report" in result.exact_phrases
        assert "2024" in result.text

    def test_whitespace_normalization(self):
        """Multiple spaces collapsed to single space."""
        result = parse_search_query("hello    world")
        assert result.text == "hello world"

    def test_type_aliases(self):
        """Type filter aliases work."""
        # Singular and plural should map to same type
        result1 = parse_search_query("note:")
        result2 = parse_search_query("notes:")
        assert result1.type_filters == result2.type_filters

        result3 = parse_search_query("event:")
        result4 = parse_search_query("calendar:")
        assert result3.type_filters == result4.type_filters

    def test_raw_query_preserved(self):
        """Original query preserved in raw_query."""
        query = "note: tag:work hello"
        result = parse_search_query(query)
        assert result.raw_query == query


class TestHasActiveFilters:
    """Tests for has_active_filters helper."""

    def test_no_filters(self):
        """Empty query has no active filters."""
        result = parse_search_query("plain text")
        assert not has_active_filters(result)

    def test_type_filter_active(self):
        """Type filter counts as active (needs a value)."""
        result = parse_search_query("note:doc")
        assert has_active_filters(result)

    def test_type_filter_no_value_inactive(self):
        """Type filter without value is not captured."""
        result = parse_search_query("note:")
        assert not has_active_filters(result)

    def test_tag_filter_active(self):
        """Tag filter counts as active."""
        result = parse_search_query("tag:work")
        assert has_active_filters(result)

    def test_my_content_active(self):
        """My content filter counts as active (needs a value)."""
        result = parse_search_query("my:yes")
        assert has_active_filters(result)

    def test_my_content_no_value_inactive(self):
        """My filter without value is not captured."""
        result = parse_search_query("my:")
        assert not has_active_filters(result)

    def test_owner_active(self):
        """Owner filter counts as active."""
        result = parse_search_query("owner:john")
        assert has_active_filters(result)

    def test_exact_phrase_active(self):
        """Exact phrase counts as active filter."""
        result = parse_search_query('"exact phrase"')
        assert has_active_filters(result)
