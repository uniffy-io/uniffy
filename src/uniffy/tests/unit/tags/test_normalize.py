"""Slug normalization edge cases.

The slugify rules underpin tag deduplication: two names that hit the same
slug must collapse to the same row, anywhere in the org. Backend slug
output must match what the frontend ``TagInput`` produces.
"""

import pytest

from uniffy.domains.tags.normalize import slugify_tag


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("Sprint Planning", "sprint-planning"),
        ("  Sprint   Planning  ", "sprint-planning"),
        ("#docs", "docs"),
        ("##docs", "docs"),
        ("UPPERCASE", "uppercase"),
        ("dash--space", "dash-space"),
        ("---trim---", "trim"),
        ("with.punct!", "withpunct"),
        ("non-ascii é á í", "non-ascii"),
        ("multi   space", "multi-space"),
        ("tag123", "tag123"),
    ],
)
def test_slugify_tag_basic(name: str, expected: str) -> None:
    assert slugify_tag(name) == expected


@pytest.mark.parametrize("name", ["", "   ", "###", "$$$", "  #  ", "!!!"])
def test_slugify_tag_returns_empty_for_garbage(name: str) -> None:
    assert slugify_tag(name) == ""


def test_slugify_tag_truncates_long_input() -> None:
    long_name = "a" * 200
    slug = slugify_tag(long_name)
    assert len(slug) == 64
    assert slug == "a" * 64


def test_slugify_tag_respects_custom_max_length() -> None:
    slug = slugify_tag("hello-world-this-is-a-tag", max_length=10)
    assert slug == "hello-worl"


def test_slugify_tag_is_idempotent() -> None:
    slug = slugify_tag("Mixed CASE Name")
    assert slugify_tag(slug) == slug


def test_slugify_tag_emoji_only_is_empty() -> None:
    assert slugify_tag("rocket") == "rocket"
    assert slugify_tag("    ") == ""
