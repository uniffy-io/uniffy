"""Proto <-> domain converters for notes domain."""

from uwos.core.converters import datetime_to_timestamp
from uwos.core.models.notes.note import Note
from uwos.core.models.shared import NodeType, VisibilityScope
from uwos.gen.notes.v1.notes_pb2 import (
    NodeType as ProtoNodeType,
)
from uwos.gen.notes.v1.notes_pb2 import (
    Note as ProtoNote,
)
from uwos.gen.notes.v1.notes_pb2 import (
    NoteReference,
)
from uwos.gen.notes.v1.notes_pb2 import (
    VisibilityScope as ProtoVisibilityScope,
)

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
}

# Node type mapping: proto -> model
NODE_TYPE_FROM_PROTO = {
    ProtoNodeType.NODE_TYPE_UNSPECIFIED: NodeType.NOTE,
    ProtoNodeType.NODE_TYPE_NOTE: NodeType.NOTE,
    ProtoNodeType.NODE_TYPE_FOLDER: NodeType.FOLDER,
    ProtoNodeType.NODE_TYPE_TEMPLATE: NodeType.TEMPLATE,
}


def note_to_proto(
    note: Note,
    permission_level: str | None = None,
    exclude_content: bool = False,
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

    proto_note = ProtoNote(
        id=str(note.id),
        organization_id=str(note.organization_id),
        owner_id=str(note.owner_id),
        visibility=proto_visibility,
        node_type=proto_node_type,
        title=note.title,
        content="" if exclude_content else note.content,
        slug=note.slug,
        is_deleted=note.is_deleted,
        is_pinned=note.is_pinned,
        version=note.version,
        tags=note.tags or [],
        metadata=note.note_metadata or {},
        created_at=datetime_to_timestamp(note.created_at),
        updated_at=datetime_to_timestamp(note.updated_at),
        outgoing_references=note.outgoing_references or [],
    )

    if note.parent_id:
        proto_note.parent_id = str(note.parent_id)

    if note.deleted_at:
        proto_note.deleted_at.CopyFrom(datetime_to_timestamp(note.deleted_at))

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
        created_by=str(note.owner_id),
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
