"""Slug normalization for tags.

Mirrors the legacy frontend ``TagInput`` rules so a tag typed in the UI,
extracted from inline markdown, or sent over RPC always collapses to
the same slug. The slug is the natural unique key inside an
organization (see ``UNIQUE (organization_id, slug)``).

Rules
-----
- lowercase
- strip leading ``#`` characters
- strip whitespace
- replace internal whitespace with ``-``
- drop everything outside ``[a-z0-9-]``
- collapse repeating hyphens
- trim leading / trailing hyphens
- truncate to ``max_length``
"""

import re

_DEFAULT_MAX_LENGTH = 64

_NON_SLUG_CHARS = re.compile(r"[^a-z0-9-]")
_WHITESPACE = re.compile(r"\s+")
_REPEAT_HYPHENS = re.compile(r"-+")


def slugify_tag(name: str, max_length: int = _DEFAULT_MAX_LENGTH) -> str:
    """Convert a tag name into its canonical slug.

    Returns ``""`` when the input contains no slug-friendly characters.
    """
    if not name:
        return ""

    slug = name.strip().lower().lstrip("#").strip()
    slug = _WHITESPACE.sub("-", slug)
    slug = _NON_SLUG_CHARS.sub("", slug)
    slug = _REPEAT_HYPHENS.sub("-", slug)
    slug = slug.strip("-")
    return slug[:max_length]
