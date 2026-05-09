"""Tag visibility.

Two layers of the same access rules:

- ``filter`` -- ``TagVisibilityFilter``: Python-side post-query trim used
  when rows are already in hand.
- ``predicate`` -- SQL ``ColumnElement[bool]`` builders for inlining as
  ``WHERE`` predicates so the planner short-circuits per row.
"""

from uniffy.domains.tags.visibility.filter import TagVisibilityFilter
from uniffy.domains.tags.visibility.predicate import (
    build_assignment_visibility_predicate,
    build_tag_visibility_predicate,
)

__all__ = [
    "TagVisibilityFilter",
    "build_assignment_visibility_predicate",
    "build_tag_visibility_predicate",
]
