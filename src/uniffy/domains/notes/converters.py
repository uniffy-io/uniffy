"""Proto <-> domain converters for notes domain."""

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
from uniffy_proto.notes.v1.notes_pb2 import (
    VisibilityScope as ProtoVisibilityScope,
)

from uniffy.core.converters import datetime_to_timestamp
from uniffy.core.models.notes.note import Note
from uniffy.core.models.shared import NodeType, VisibilityScope

# Visibility mapping: model -> proto
VISIBILITY_TO_PROTO = {
    VisibilityScope.PRIVATE: ProtoVisibilityScope.VISIBILITY_SCOPE_PRIVATE,
    VisibilityScope.GROUP: ProtoVisibilityScope.VISIBILITY_SCOPE_GROUP,
    VisibilityScope.ORGANIZATION: ProtoVisibilityScope.VISIBILITY_SCOPE_ORGANIZATION,
    VisibilityScope.PUBLIC: ProtoVisibilityScope.VISIBILITY_SCOPE_PUBLIC,
}

# Visibility mapping: proto -> model
VISIBILITY_FROM_PROTO = {
    ProtoVisibilityScope.VISIBILITY_SCOPE_PRIVATE: VisibilityScope.PRIVATE,
    ProtoVisibilityScope.VISIBILITY_SCOPE_GROUP: VisibilityScope.GROUP,
    ProtoVisibilityScope.VISIBILITY_SCOPE_ORGANIZATION: VisibilityScope.ORGANIZATION,
    ProtoVisibilityScope.VISIBILITY_SCOPE_PUBLIC: VisibilityScope.PUBLIC,
}

# Node type mapping: model -> proto
NODE_TYPE_TO_PROTO = {
    NodeType.NOTE: ProtoNodeType.NODE_TYPE_NOTE,
    NodeType.FOLDER: ProtoNodeType.NODE_TYPE_FOLDER,
    NodeType.TEMPLATE: ProtoNodeType.NODE_TYPE_TEMPLATE,
    NodeType.CANVAS: ProtoNodeType.NODE_TYPE_CANVAS,
}

# Node type mapping: proto -> model
NODE_TYPE_FROM_PROTO = {
    ProtoNodeType.NODE_TYPE_UNSPECIFIED: NodeType.NOTE,
    ProtoNodeType.NODE_TYPE_NOTE: NodeType.NOTE,
    ProtoNodeType.NODE_TYPE_FOLDER: NodeType.FOLDER,
    ProtoNodeType.NODE_TYPE_TEMPLATE: NodeType.TEMPLATE,
    ProtoNodeType.NODE_TYPE_CANVAS: NodeType.CANVAS,
}


def _get_proto_content(note: Note) -> str:
    """Get proto content field value, serializing canvas_content if needed."""
    if note.node_type == NodeType.CANVAS and note.canvas_content:
        return json.dumps(note.canvas_content)
    return note.content


def note_to_proto(
    note: Note,
    permission_level: str | None = None,
    exclude_content: bool = False,
    owner_info: dict | None = None,
    shared_with: list[dict] | None = None,
) -> ProtoNote:
    """
    Convert Note model to proto Note.

    Parameters
    ----------
    note : Note
        Note model instance.
    permission_level : str | None
        User's permission level on this note.
    exclude_content : bool
        If True, return empty string for content field (for tree/list views).
    owner_info : dict | None
        Owner information for notes shared with current user.
        Expected keys: id, name, email.
    shared_with : list[dict] | None
        List of users/groups this note is shared with (only for owner).
        Each dict has: id, type ("user"/"group"), name, email (optional),
        member_count (optional), permission_level.

    Returns
    -------
    ProtoNote
        Proto message.

    """
    proto_visibility = VISIBILITY_TO_PROTO.get(
        note.visibility,
        ProtoVisibilityScope.VISIBILITY_SCOPE_PRIVATE,
    )
    proto_node_type = NODE_TYPE_TO_PROTO.get(
        note.node_type,
        ProtoNodeType.NODE_TYPE_NOTE,
    )

    # Convert metadata to a simple dict with string values for proto compatibility
    # Proto map<string, string> requires string values, so we serialize non-strings
    metadata_dict: dict[str, str] = {}
    if note.note_metadata:
        for key, val in note.note_metadata.items():
            if key == "icon":
                # Icon is handled separately below, skip it in metadata
                continue
            if isinstance(val, str):
                metadata_dict[key] = val
            else:
                # Serialize complex values as JSON strings
                metadata_dict[key] = json.dumps(val)

    proto_note = ProtoNote(
        id=str(note.id),
        organization_id=str(note.organization_id),
        owner_id=str(note.owner_id),
        visibility=proto_visibility,
        node_type=proto_node_type,
        title=note.title,
        content="" if exclude_content else _get_proto_content(note),
        slug=note.slug,
        is_deleted=note.is_deleted,
        version=note.version,
        tags=note.tags or [],
        inline_tags=note.inline_tags or [],
        metadata=metadata_dict,
        created_at=datetime_to_timestamp(note.created_at),
        updated_at=datetime_to_timestamp(note.updated_at),
        outgoing_references=note.outgoing_references or [],
    )

    if note.parent_id:
        proto_note.parent_id = str(note.parent_id)

    if note.deleted_at:
        proto_note.deleted_at.CopyFrom(datetime_to_timestamp(note.deleted_at))

    # Extract icon from metadata if present
    if note.note_metadata and "icon" in note.note_metadata:
        icon_data = note.note_metadata["icon"]
        if isinstance(icon_data, dict):
            proto_note.icon.CopyFrom(
                ProtoNoteIcon(
                    icon_type=icon_data.get("type", ""),
                    value=icon_data.get("value", ""),
                )
            )

    # Add owner info for notes shared with current user
    if owner_info:
        proto_note.owner_info.CopyFrom(
            ProtoNoteOwner(
                id=str(owner_info.get("id", "")),
                name=owner_info.get("name", ""),
                email=owner_info.get("email", ""),
            )
        )

    # Add shared_with for notes owned by current user
    if shared_with:
        for target in shared_with:
            proto_note.shared_with.append(
                ProtoNoteShareTarget(
                    id=str(target.get("id", "")),
                    type=target.get("type", ""),
                    name=target.get("name", ""),
                    email=target.get("email", ""),
                    member_count=target.get("member_count", 0),
                    permission_level=target.get("permission_level", ""),
                )
            )

    return proto_note


def note_to_reference(note: Note) -> NoteReference:
    """
    Convert Note to NoteReference proto (for backlinks).

    Parameters
    ----------
    note : Note
        Note model instance.

    Returns
    -------
    NoteReference
        Proto message.

    """
    return NoteReference(
        id=str(note.id),
        title=note.title,
        slug=note.slug,
        owner_id=str(note.owner_id),
        updated_at=datetime_to_timestamp(note.updated_at),
    )


def visibility_from_proto(proto_visibility: ProtoVisibilityScope) -> VisibilityScope:
    """
    Convert proto VisibilityScope to model.

    Parameters
    ----------
    proto_visibility : ProtoVisibilityScope
        Proto visibility enum.

    Returns
    -------
    VisibilityScope
        Model visibility enum.

    """
    return VISIBILITY_FROM_PROTO.get(proto_visibility, VisibilityScope.PRIVATE)


def node_type_from_proto(proto_node_type: ProtoNodeType) -> NodeType:
    """
    Convert proto NodeType to model.

    Parameters
    ----------
    proto_node_type : ProtoNodeType
        Proto node type enum.

    Returns
    -------
    NodeType
        Model node type enum.

    """
    return NODE_TYPE_FROM_PROTO.get(proto_node_type, NodeType.NOTE)
