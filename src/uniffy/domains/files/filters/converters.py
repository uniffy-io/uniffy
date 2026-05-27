"""Proto <-> domain converters for saved file filters."""

from typing import Any

from uniffy_proto.files.v1.files_pb2 import (
    FilterCriteria as ProtoFilterCriteria,
)
from uniffy_proto.files.v1.files_pb2 import (
    IconValue as ProtoIconValue,
)
from uniffy_proto.files.v1.files_pb2 import (
    SavedFilter as ProtoSavedFilter,
)

from uniffy.core.converters import datetime_to_timestamp, timestamp_to_datetime
from uniffy.core.converters.common_proto import (
    access_mode_from_proto,
    access_mode_to_proto,
)
from uniffy.core.models.files.saved_filter import SavedFileFilter
from uniffy.core.types import AccessMode


def saved_filter_to_proto(filter_model: SavedFileFilter) -> ProtoSavedFilter:
    proto = ProtoSavedFilter(
        id=str(filter_model.id),
        user_id=str(filter_model.user_id),
        organization_id=str(filter_model.organization_id),
        name=filter_model.name,
        is_preset=filter_model.is_preset,
        criteria=criteria_to_proto(filter_model.criteria),
        created_at=datetime_to_timestamp(filter_model.created_at),
        updated_at=datetime_to_timestamp(filter_model.updated_at),
    )

    if filter_model.description:
        proto.description = filter_model.description

    if filter_model.icon:
        proto.icon.CopyFrom(icon_to_proto(filter_model.icon))

    if filter_model.sort_by:
        proto.sort_by = filter_model.sort_by

    if filter_model.sort_order:
        proto.sort_order = filter_model.sort_order

    return proto


def icon_to_proto(icon: dict[str, str]) -> ProtoIconValue:
    return ProtoIconValue(
        type=icon.get("type", "icon"),
        value=icon.get("value", ""),
    )


def icon_from_proto(proto: ProtoIconValue) -> dict[str, str]:
    return {
        "type": proto.type,
        "value": proto.value,
    }


def criteria_to_proto(criteria: dict[str, Any]) -> ProtoFilterCriteria:
    proto = ProtoFilterCriteria(
        extensions=criteria.get("extensions", []),
        mime_categories=criteria.get("mime_categories", []),
        owner_ids=criteria.get("owner_ids", []),
        tag_ids=criteria.get("tag_ids", []),
    )

    if "access_mode" in criteria and criteria["access_mode"]:
        try:
            mode = AccessMode(criteria["access_mode"])
            proto.access_mode = access_mode_to_proto(mode)
        except ValueError:
            pass

    if "size_min_bytes" in criteria and criteria["size_min_bytes"] is not None:
        proto.size_min_bytes = criteria["size_min_bytes"]

    if "size_max_bytes" in criteria and criteria["size_max_bytes"] is not None:
        proto.size_max_bytes = criteria["size_max_bytes"]

    if "created_after" in criteria and criteria["created_after"]:
        ts = timestamp_to_datetime(criteria["created_after"])
        if ts:
            proto.created_after.CopyFrom(datetime_to_timestamp(ts))

    if "created_before" in criteria and criteria["created_before"]:
        ts = timestamp_to_datetime(criteria["created_before"])
        if ts:
            proto.created_before.CopyFrom(datetime_to_timestamp(ts))

    return proto


def criteria_from_proto(proto: ProtoFilterCriteria) -> dict[str, Any]:
    criteria: dict[str, Any] = {}

    if proto.extensions:
        criteria["extensions"] = list(proto.extensions)

    if proto.mime_categories:
        criteria["mime_categories"] = list(proto.mime_categories)

    if proto.owner_ids:
        criteria["owner_ids"] = list(proto.owner_ids)

    if proto.tag_ids:
        criteria["tag_ids"] = list(proto.tag_ids)

    if proto.access_mode:
        mode = access_mode_from_proto(proto.access_mode)
        if mode is not None:
            criteria["access_mode"] = mode.value

    if proto.HasField("size_min_bytes"):
        criteria["size_min_bytes"] = proto.size_min_bytes

    if proto.HasField("size_max_bytes"):
        criteria["size_max_bytes"] = proto.size_max_bytes

    if proto.HasField("created_after"):
        criteria["created_after"] = proto.created_after.ToJsonString()

    if proto.HasField("created_before"):
        criteria["created_before"] = proto.created_before.ToJsonString()

    return criteria
