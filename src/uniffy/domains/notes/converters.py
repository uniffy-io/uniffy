"""Proto <-> domain converters for the notes domain."""

import json

from uniffy_proto.notes.v1.notes_pb2 import (
    NodeType as ProtoNodeType,
)
from uniffy_proto.notes.v1.notes_pb2 import (
    Note as ProtoNote,
)
from uniffy_proto.notes.v1.notes_pb2 import (
    NoteIcon as ProtoNoteIcon,
)
from uniffy_proto.notes.v1.notes_pb2 import (
    NoteOwner as ProtoNoteOwner,
)
from uniffy_proto.notes.v1.notes_pb2 import (
    NoteReference,
)
from uniffy_proto.notes.v1.notes_pb2 import (
    NoteShareTarget as ProtoNoteShareTarget,
)

from uniffy.core.converters import datetime_to_timestamp
from uniffy.core.converters.common_proto import (
    access_mode_to_proto,
    content_role_to_proto,
)
from uniffy.core.models.notes.note import Note
from uniffy.core.types import ContentRole, NodeType

# Domain-local enum maps. ``access_mode`` and ``content_role`` are shared
# across every domain so they live in ``core.converters.common_proto``.
NODE_TYPE_TO_PROTO: dict[NodeType, ProtoNodeType.ValueType] = {
    NodeType.NOTE: ProtoNodeType.NODE_TYPE_NOTE,
    NodeType.FOLDER: ProtoNodeType.NODE_TYPE_FOLDER,
    NodeType.TEMPLATE: ProtoNodeType.NODE_TYPE_TEMPLATE,
    NodeType.CANVAS: ProtoNodeType.NODE_TYPE_CANVAS,
}

NODE_TYPE_FROM_PROTO: dict[ProtoNodeType.ValueType, NodeType] = {
    ProtoNodeType.NODE_TYPE_UNSPECIFIED: NodeType.NOTE,
    ProtoNodeType.NODE_TYPE_NOTE: NodeType.NOTE,
    ProtoNodeType.NODE_TYPE_FOLDER: NodeType.FOLDER,
    ProtoNodeType.NODE_TYPE_TEMPLATE: NodeType.TEMPLATE,
    ProtoNodeType.NODE_TYPE_CANVAS: NodeType.CANVAS,
}


def node_type_from_proto(value: ProtoNodeType.ValueType) -> NodeType:
    """Convert a proto NodeType value to the domain enum."""
    return NODE_TYPE_FROM_PROTO.get(value, NodeType.NOTE)


def note_to_proto(
    note: Note,
    user_role: ContentRole | None = None,
    exclude_content: bool = False,
    owner_info: dict | None = None,
    shared_with: list[dict] | None = None,
) -> ProtoNote:
    """Convert a :class:`Note` row to its proto representation.

    Parameters
    ----------
    note : Note
        Note row.
    user_role : ContentRole | None
        Effective role of the requesting user, if known. Set this when
        the proto will travel to the frontend so the UI can render the
        correct affordances; omit for internal callers.
    exclude_content : bool
        If ``True`` the body is omitted (e.g. for tree / list views).
    owner_info : dict | None
        Owner display info for notes the requester does not own.
        Expected keys: ``id``, ``name``, ``email``.
    shared_with : list[dict] | None
        Pre-built share-target dicts for notes the requester owns. See
        ``NoteOperations._build_shared_with`` for the canonical shape.
    """
    proto_note = ProtoNote(
        id=str(note.id),
        organization_id=str(note.organization_id),
        owner_id=str(note.owner_id),
        access_mode=access_mode_to_proto(note.access_mode),
        node_type=NODE_TYPE_TO_PROTO.get(note.node_type, ProtoNodeType.NODE_TYPE_NOTE),
        title=note.title,
        content="" if exclude_content else _serialize_body(note),
        slug=note.slug,
        is_deleted=note.is_deleted,
        version=note.version,
        tags=note.tags or [],
        inline_tags=note.inline_tags or [],
        metadata=_build_metadata_dict(note),
        created_at=datetime_to_timestamp(note.created_at),
        updated_at=datetime_to_timestamp(note.updated_at),
        outgoing_references=note.outgoing_references or [],
    )

    if note.baseline_role is not None:
        proto_note.baseline_role = content_role_to_proto(note.baseline_role)
    if user_role is not None:
        proto_note.user_role = content_role_to_proto(user_role)
    if note.parent_id:
        proto_note.parent_id = str(note.parent_id)
    if note.deleted_at:
        proto_note.deleted_at.CopyFrom(datetime_to_timestamp(note.deleted_at))

    icon = _build_icon_proto(note)
    if icon is not None:
        proto_note.icon.CopyFrom(icon)

    if owner_info:
        proto_note.owner_info.CopyFrom(
            ProtoNoteOwner(
                id=str(owner_info.get("id", "")),
                name=owner_info.get("name", ""),
                email=owner_info.get("email", ""),
            )
        )

    if shared_with:
        for target in shared_with:
            proto_note.shared_with.append(_share_target_to_proto(target))

    return proto_note


def note_to_reference(note: Note) -> NoteReference:
    """Convert a :class:`Note` to a lightweight backlink reference."""
    ref = NoteReference(
        id=str(note.id),
        title=note.title,
        slug=note.slug,
        owner_id=str(note.owner_id),
        updated_at=datetime_to_timestamp(note.updated_at),
        access_mode=access_mode_to_proto(note.access_mode),
        node_type=NODE_TYPE_TO_PROTO.get(note.node_type, ProtoNodeType.NODE_TYPE_NOTE),
    )
    if note.baseline_role is not None:
        ref.baseline_role = content_role_to_proto(note.baseline_role)
    return ref


def _serialize_body(note: Note) -> str:
    """Return the proto ``content`` payload for a note.

    For canvas notes the JSONB ``canvas_content`` is serialized as a
    JSON string; for everything else the markdown ``content`` is used
    as-is.
    """
    if note.node_type == NodeType.CANVAS and note.canvas_content:
        return json.dumps(note.canvas_content)
    return note.content


def _build_metadata_dict(note: Note) -> dict[str, str]:
    """Flatten ``note_metadata`` into a string-only dict for the proto map.

    Skips the ``icon`` key (handled separately) and JSON-encodes any
    non-string values so the proto ``map<string, string>`` field can
    accept them.
    """
    if not note.note_metadata:
        return {}

    out: dict[str, str] = {}
    for key, val in note.note_metadata.items():
        if key == "icon":
            continue
        out[key] = val if isinstance(val, str) else json.dumps(val)
    return out


def _build_icon_proto(note: Note) -> ProtoNoteIcon | None:
    """Extract a ``NoteIcon`` proto from ``note_metadata['icon']`` if any."""
    if not note.note_metadata:
        return None
    icon_data = note.note_metadata.get("icon")
    if not isinstance(icon_data, dict):
        return None
    return ProtoNoteIcon(
        icon_type=icon_data.get("type", ""),
        value=icon_data.get("value", ""),
    )


def _share_target_to_proto(target: dict) -> ProtoNoteShareTarget:
    """Convert a sharing-info dict (built in operations) to its proto."""
    return ProtoNoteShareTarget(
        id=str(target.get("id", "")),
        type=target.get("type", ""),
        name=target.get("name", ""),
        email=target.get("email", ""),
        member_count=target.get("member_count", 0),
        role=_role_value_to_proto(target.get("role")),
    )


def _role_value_to_proto(role_value: str | None) -> ContentRole.value:
    """Translate a stored ``ContentRole.value`` string back to its proto."""
    if role_value is None:
        return content_role_to_proto(ContentRole.VIEWER)
    try:
        return content_role_to_proto(ContentRole(role_value))
    except ValueError:
        return content_role_to_proto(ContentRole.VIEWER)
