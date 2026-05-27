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
    # COUNT_DESC / COUNT_ASC fall back to recent_desc: counts live in Valkey, so
    # paginating by count over a Postgres window breaks (a tag can land on two
    # pages or none). UIs that need a counts view filter inside the first page.
    return _SORT_FROM_PROTO.get(value, "recent_desc")


def source_from_proto(value: int) -> str | None:
    # None means "any source" - unassign() treats it as remove-regardless-of-source.
    return _SOURCE_FROM_PROTO.get(value)


def tag_to_proto(tag: Tag, *, usage_count: int = 0) -> ProtoTag:
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
    return [tag_to_proto(t, usage_count=counts.get(t.id, 0)) for t in tags]


def assignment_to_proto(assignment: TagAssignment) -> ProtoTagAssignment:
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
    # Title/snippet are not stored on TagAssignment; callers hydrate from the search index.
    try:
        ct = ContentType(assignment.content_type)
        proto_ct = content_type_to_proto(ct)
    except ValueError:
        proto_ct = 0
    return ProtoTaggedContentItem(
        urn=assignment.content_urn,
        content_type=proto_ct,
        title=title,
        snippet=snippet,
        assigned_at=datetime_to_timestamp(assignment.assigned_at),
    )
