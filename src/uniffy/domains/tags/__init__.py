"""Tags domain."""

from uniffy.core.models.tags.tag import Tag, TagAssignment
from uniffy.domains.tags.normalize import slugify_tag
from uniffy.domains.tags.operations import (
    MAX_MANUAL_TAGS_PER_CONTENT,
    SOURCE_INLINE,
    SOURCE_MANUAL,
    TagLimitExceededError,
    TagOperations,
    TagSlugCollisionError,
)
from uniffy.domains.tags.sync import sync_inline_tags

__all__ = [
    "MAX_MANUAL_TAGS_PER_CONTENT",
    "SOURCE_INLINE",
    "SOURCE_MANUAL",
    "Tag",
    "TagAssignment",
    "TagLimitExceededError",
    "TagOperations",
    "TagSlugCollisionError",
    "slugify_tag",
    "sync_inline_tags",
]
