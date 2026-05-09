"""Proto <-> domain converters for tags."""

from collections.abc import Iterable
from uuid import UUID

from uniffy_proto.tags.v1.tags_pb2 import (
    Tag as ProtoTag,
)
from uniffy_proto.tags.v1.tags_pb2 import (
    TagAssignment as ProtoTagAssignment,
)
from uniffy_proto.tags.v1.tags_pb2 import (
    TaggedContentItem as ProtoTaggedContentItem,
)
from uniffy_proto.tags.v1.tags_pb2 import (
    TagSort as ProtoTagSort,
)
from uniffy_proto.tags.v1.tags_pb2 import (
    TagSource as ProtoTagSource,
)

from uniffy.core.converters import datetime_to_timestamp, optional_timestamp
from uniffy.core.converters.common_proto import content_type_to_proto
from uniffy.core.models.tags.tag import Tag, TagAssignment
from uniffy.core.types import ContentType
from uniffy.domains.tags.operations import SOURCE_INLINE, SOURCE_MANUAL

_SORT_FROM_PROTO: dict[int, str] = {
    ProtoTagSort.TAG_SORT_UNSPECIFIED: "recent_desc",
    ProtoTagSort.TAG_SORT_COUNT_DESC: "recent_desc",
    ProtoTagSort.TAG_SORT_COUNT_ASC: "recent_desc",
    ProtoTagSort.TAG_SORT_ALPHA_ASC: "alpha_asc",
    ProtoTagSort.TAG_SORT_ALPHA_DESC: "alpha_desc",
    ProtoTagSort.TAG_SORT_RECENT_DESC: "recent_desc",
}

_SOURCE_FROM_PROTO: dict[int, str | None] = {
    ProtoTagSource.TAG_SOURCE_UNSPECIFIED: None,
    ProtoTagSource.TAG_SOURCE_MANUAL: SOURCE_MANUAL,
    ProtoTagSource.TAG_SOURCE_INLINE: SOURCE_INLINE,
}


def sort_from_proto(value: int) -> str:
    """Map a proto ``TagSort`` value onto the operations sort string.

    ``COUNT_DESC`` / ``COUNT_ASC`` are accepted but coerced to
    ``recent_desc``. Server-side count-based ordering across pages is
    no longer supported because counts live in Valkey, not Postgres,
    and re-sorting a Postgres page in Python silently breaks
    pagination (same tag can appear on two pages or on none). Frontends
    that need a counts view filter inside the explorer's first page.
    """
    return _SORT_FROM_PROTO.get(value, "recent_desc")


def source_from_proto(value: int) -> str | None:
    """Map a proto ``TagSource`` to the operations source string.

    Returns ``None`` when unspecified — used by ``unassign`` to mean
    "remove regardless of source".
    """
    return _SOURCE_FROM_PROTO.get(value)


def tag_to_proto(tag: Tag, *, usage_count: int = 0) -> ProtoTag:
    """Convert a ``Tag`` row to its proto representation."""
    proto = ProtoTag(
        id=str(tag.id),
        organization_id=str(tag.organization_id),
        name=tag.name,
        slug=tag.slug,
        color=tag.color or "",
        description=tag.description or "",
        created_by=str(tag.created_by) if tag.created_by else "",
        created_at=datetime_to_timestamp(tag.created_at),
        updated_at=datetime_to_timestamp(tag.updated_at),
        usage_count=usage_count,
        urn=tag.urn,
    )
    last_used = optional_timestamp(tag.last_used_at)
    if last_used is not None:
        proto.last_used_at.CopyFrom(last_used)
    return proto


def tags_to_proto_list(
    tags: Iterable[Tag], counts: dict[UUID, int]
) -> list[ProtoTag]:
    """Convert a list of tags using a parallel id -> count map."""
    return [tag_to_proto(t, usage_count=counts.get(t.id, 0)) for t in tags]


def assignment_to_proto(assignment: TagAssignment) -> ProtoTagAssignment:
    """Convert a ``TagAssignment`` row to proto."""
    return ProtoTagAssignment(
        tag_id=str(assignment.tag_id),
        content_urn=assignment.content_urn,
        content_type=assignment.content_type,
        sources=list(assignment.sources or []),
        assigned_by=str(assignment.assigned_by) if assignment.assigned_by else "",
        assigned_at=datetime_to_timestamp(assignment.assigned_at),
    )


def tagged_content_item_to_proto(
    assignment: TagAssignment,
    *,
    title: str = "",
    snippet: str = "",
) -> ProtoTaggedContentItem:
    """Build a ``TaggedContentItem`` for the explorer's right panel.

    Title / snippet are not stored on the assignment; the caller hydrates
    them from the search index. Phase 1 leaves them blank — the explorer
    UI lands in Phase 5.
    """
    try:
        ct = ContentType(assignment.content_type)
        proto_ct = content_type_to_proto(ct)
    except ValueError:
        proto_ct = 0  # CONTENT_TYPE_UNSPECIFIED
    return ProtoTaggedContentItem(
        urn=assignment.content_urn,
        content_type=proto_ct,
        title=title,
        snippet=snippet,
        assigned_at=datetime_to_timestamp(assignment.assigned_at),
    )
