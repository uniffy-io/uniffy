from datetime import datetime
from typing import Any
from uuid import UUID

from protobuf.wkt import Timestamp
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select
from uniffy_proto.tags.v1.tags_pb import (
    IconValue as ProtoIconValue,
)
from uniffy_proto.tags.v1.tags_pb import (
    SavedTagFilter as ProtoSavedTagFilter,
)
from uniffy_proto.tags.v1.tags_pb import (
    TagFilterCriteria as ProtoTagFilterCriteria,
)

from uniffy.core.converters import (
    datetime_to_timestamp,
    optional_timestamp,
)
from uniffy.core.converters.common_proto import (
    access_mode_from_proto,
    access_mode_to_proto,
    content_type_from_proto,
    content_type_to_proto,
)
from uniffy.core.json_codec import loads
from uniffy.core.models.tags.saved_filter import SavedTagFilter
from uniffy.core.models.tags.tag import Tag
from uniffy.core.types import AccessMode, ContentType
from uniffy.domains.tags.reader import SOURCE_INLINE, SOURCE_MANUAL

_VALID_SOURCES = frozenset({SOURCE_MANUAL, SOURCE_INLINE})


def _iso_to_timestamp(value: Any) -> Timestamp | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return datetime_to_timestamp(value)
    if isinstance(value, str):
        try:
            return datetime_to_timestamp(datetime.fromisoformat(value))
        except ValueError:
            return None
    return None


def icon_to_proto(icon: dict[str, str]) -> ProtoIconValue:
    return ProtoIconValue(
        type=icon.get("type", "icon"),
        value=icon.get("value", ""),
    )


def icon_from_proto(proto: ProtoIconValue) -> dict[str, str]:
    return {"type": proto.type or "icon", "value": proto.value or ""}


def criteria_to_proto(criteria: dict[str, Any]) -> ProtoTagFilterCriteria:
    proto = ProtoTagFilterCriteria(
        tag_ids=list(criteria.get("tag_ids") or []),
        owner_ids=list(criteria.get("owner_ids") or []),
        sources=[s for s in (criteria.get("sources") or []) if s in _VALID_SOURCES],
        untagged_only=bool(criteria.get("untagged_only", False)),
    )

    raw_types = criteria.get("content_types") or []
    type_protos: list[int] = []
    for value in raw_types:
        try:
            ct = ContentType(value)
        except ValueError:
            continue
        type_protos.append(content_type_to_proto(ct))
    if type_protos:
        proto.content_types.extend(type_protos)

    for key in ("created_after", "created_before", "updated_after", "updated_before"):
        ts = _iso_to_timestamp(criteria.get(key))
        if ts is not None:
            setattr(proto, key, ts)

    if criteria.get("access_mode"):
        try:
            mode = AccessMode(criteria["access_mode"])
            proto.access_mode = access_mode_to_proto(mode)
        except ValueError:
            pass

    return proto


def criteria_from_proto(proto: ProtoTagFilterCriteria) -> dict[str, Any]:
    out: dict[str, Any] = {}
    if proto.tag_ids:
        out["tag_ids"] = list(proto.tag_ids)
    if proto.content_types:
        types: list[str] = []
        for v in proto.content_types:
            ct = content_type_from_proto(v)
            if ct is not None:
                types.append(ct.value)
        if types:
            out["content_types"] = types
    if proto.owner_ids:
        out["owner_ids"] = list(proto.owner_ids)
    if proto.sources:
        out["sources"] = [s for s in proto.sources if s in _VALID_SOURCES]

    if proto.has_field("created_after"):
        out["created_after"] = loads(proto.created_after.to_json())
    if proto.has_field("created_before"):
        out["created_before"] = loads(proto.created_before.to_json())
    if proto.has_field("updated_after"):
        out["updated_after"] = loads(proto.updated_after.to_json())
    if proto.has_field("updated_before"):
        out["updated_before"] = loads(proto.updated_before.to_json())

    if proto.access_mode:
        mode = access_mode_from_proto(proto.access_mode)
        if mode is not None:
            out["access_mode"] = mode.value

    if proto.untagged_only:
        out["untagged_only"] = True

    return out


async def saved_filter_to_proto(
    saved_filter: SavedTagFilter,
    *,
    session: AsyncSession,
) -> ProtoSavedTagFilter:
    # Dead tag_ids are stripped against the tags table; removed_tag_count tells
    # the client how many were dropped so it can show a toast and persist the
    # cleaned criteria.
    criteria = dict(saved_filter.criteria or {})
    raw_tag_ids = criteria.get("tag_ids") or []
    removed_count = 0

    if raw_tag_ids:
        try:
            uuid_ids = [UUID(tid) for tid in raw_tag_ids]
        except ValueError:
            uuid_ids = []
        if uuid_ids:
            existing = (
                (
                    await session.execute(
                        select(Tag.id).where(
                            Tag.organization_id == saved_filter.organization_id,
                            Tag.id.in_(uuid_ids),
                        )
                    )
                )
                .scalars()
                .all()
            )
            existing_set = {str(tid) for tid in existing}
            kept = [tid for tid in raw_tag_ids if tid in existing_set]
            removed_count = len(raw_tag_ids) - len(kept)
            criteria["tag_ids"] = kept

    proto = ProtoSavedTagFilter(
        id=str(saved_filter.id),
        user_id=str(saved_filter.user_id),
        organization_id=str(saved_filter.organization_id),
        name=saved_filter.name,
        criteria=criteria_to_proto(criteria),
        sort_by=saved_filter.sort_by or "count",
        sort_order=saved_filter.sort_order or "desc",
        is_preset=saved_filter.is_preset,
        removed_tag_count=removed_count,
        created_at=datetime_to_timestamp(saved_filter.created_at),
        updated_at=datetime_to_timestamp(saved_filter.updated_at),
    )
    if saved_filter.description:
        proto.description = saved_filter.description
    if saved_filter.icon:
        proto.icon = icon_to_proto(saved_filter.icon)

    last_used = optional_timestamp(saved_filter.updated_at)
    if last_used is not None:
        proto.updated_at = last_used

    return proto
