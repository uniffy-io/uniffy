"""Mutating notes RPC handlers."""

from typing import Any
from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from sqlalchemy.ext.asyncio import AsyncSession
from uniffy_proto.notes.v1.notes_pb2 import (
    CreateNoteRequest,
    CreateNoteResponse,
    DeleteNoteRequest,
    DeleteNoteResponse,
    EmptyTrashRequest,
    EmptyTrashResponse,
    MoveNoteResponse,
    RestoreNoteRequest,
    RestoreNoteResponse,
    UpdateNoteRequest,
    UpdateNoteResponse,
)

from uniffy.core.auth.principal import current_user_id
from uniffy.core.converters.common_proto import (
    access_mode_from_proto,
    content_role_from_proto,
)
from uniffy.core.models.notes.note import Note
from uniffy.core.types import NodeType
from uniffy.db import open_session
from uniffy.domains.notes.converters import node_type_from_proto, note_to_proto
from uniffy.domains.notes.operations import NoteOperations
from uniffy.domains.notes.rpc.support import (
    map_domain_error,
    parse_canvas_content,
    parse_tag_ids,
    parse_uuid,
    resolve_note_policy,
    resolve_user_role,
)
from uniffy.domains.tags.context import ContentTagContext


async def _note_proto(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
    note: Note,
) -> Any:
    urn = f"urn:uniffy:content:NOTE:{note.id}"
    tags_by_urn = await ContentTagContext(session).get_for_urns(
        organization_id=organization_id,
        content_urns=[urn],
    )
    user_role = await resolve_user_role(session, user_id, organization_id, note)
    effective_mode, effective_baseline = await resolve_note_policy(
        session,
        organization_id,
        note,
    )
    return note_to_proto(
        note,
        tags=tags_by_urn.get(urn, []),
        user_role=user_role,
        effective_access_mode=effective_mode,
        effective_baseline_role=effective_baseline,
    )


class NoteMutationHandlers:
    async def create_note(
        self,
        request: CreateNoteRequest,
        ctx: RequestContext,
    ) -> CreateNoteResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        access_mode = access_mode_from_proto(request.access_mode) if request.access_mode else None
        baseline_role = (
            content_role_from_proto(request.baseline_role) if request.baseline_role else None
        )
        node_type = node_type_from_proto(request.node_type)
        parent_id = (
            parse_uuid(request.parent_id, "parent_id") if request.HasField("parent_id") else None
        )
        group_ids = [parse_uuid(group_id, "group_id") for group_id in request.group_ids] or None
        metadata = dict(request.metadata) if request.metadata else {}
        if request.HasField("icon"):
            metadata["icon"] = {
                "type": request.icon.icon_type,
                "value": request.icon.value,
            }

        canvas_content = None
        content = request.content
        if node_type == NodeType.CANVAS:
            canvas_content = parse_canvas_content(content)
            if canvas_content is not None:
                content = ""
        tag_ids = parse_tag_ids(list(request.tag_ids)) if request.tag_ids else None

        try:
            async with open_session() as session:
                note = await NoteOperations(session).create(
                    user_id=user_id,
                    organization_id=organization_id,
                    title=request.title,
                    content=content,
                    canvas_content=canvas_content,
                    slug=request.slug if request.HasField("slug") else None,
                    access_mode=access_mode,
                    baseline_role=baseline_role,
                    node_type=node_type,
                    parent_id=parent_id,
                    tag_ids=tag_ids,
                    metadata=metadata or None,
                    group_ids=group_ids,
                )
                return CreateNoteResponse(
                    note=await _note_proto(session, user_id, organization_id, note)
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("create_note", exc) from exc

    async def update_note(
        self,
        request: UpdateNoteRequest,
        ctx: RequestContext,
    ) -> UpdateNoteResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        note_id = parse_uuid(request.note_id, "note_id")
        parent_id: UUID | str | None = None
        if request.HasField("parent_id"):
            parent_id = "" if request.parent_id == "" else parse_uuid(request.parent_id, "parent_id")
        metadata = dict(request.metadata) if request.metadata else None
        if request.HasField("icon"):
            metadata = metadata or {}
            metadata["icon"] = {
                "type": request.icon.icon_type,
                "value": request.icon.value,
            }
        content = request.content if request.HasField("content") else None
        canvas_content = parse_canvas_content(content) if content is not None else None
        tag_ids = parse_tag_ids(list(request.tag_ids.ids)) if request.HasField("tag_ids") else None

        try:
            async with open_session() as session:
                note = await NoteOperations(session).update(
                    user_id=user_id,
                    organization_id=organization_id,
                    note_id=note_id,
                    title=request.title if request.HasField("title") else None,
                    content=content,
                    canvas_content=canvas_content,
                    slug=request.slug if request.HasField("slug") else None,
                    parent_id=parent_id,
                    tag_ids=tag_ids,
                    metadata=metadata,
                )
                return UpdateNoteResponse(
                    note=await _note_proto(session, user_id, organization_id, note)
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("update_note", exc) from exc

    async def delete_note(
        self,
        request: DeleteNoteRequest,
        ctx: RequestContext,
    ) -> DeleteNoteResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        note_id = parse_uuid(request.note_id, "note_id")
        try:
            async with open_session() as session:
                await NoteOperations(session).delete(
                    user_id=user_id,
                    organization_id=organization_id,
                    note_id=note_id,
                    permanent=request.permanent,
                )
                message = "Note permanently deleted" if request.permanent else "Note deleted"
                return DeleteNoteResponse(success=True, message=message)
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("delete_note", exc) from exc

    async def restore_note(
        self,
        request: RestoreNoteRequest,
        ctx: RequestContext,
    ) -> RestoreNoteResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        note_id = parse_uuid(request.note_id, "note_id")
        try:
            async with open_session() as session:
                note = await NoteOperations(session).restore(user_id, organization_id, note_id)
                return RestoreNoteResponse(
                    note=await _note_proto(session, user_id, organization_id, note)
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("restore_note", exc) from exc

    async def empty_trash(
        self,
        request: EmptyTrashRequest,
        ctx: RequestContext,
    ) -> EmptyTrashResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        try:
            async with open_session() as session:
                count = await NoteOperations(session).empty_trash(user_id, organization_id)
                return EmptyTrashResponse(
                    deleted_count=count,
                    success=True,
                    message=f"Successfully deleted {count} note(s) from trash",
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("empty_trash", exc) from exc

    async def move_note(self, request: Any, ctx: RequestContext) -> MoveNoteResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        note_id = parse_uuid(request.note_id, "note_id")
        target_access_mode = access_mode_from_proto(request.target_access_mode)
        target_baseline_role = (
            content_role_from_proto(request.target_baseline_role)
            if request.target_baseline_role
            else None
        )
        target_group_ids = (
            [parse_uuid(group_id, "group_id") for group_id in request.target_group_ids]
            if request.target_group_ids
            else None
        )
        try:
            async with open_session() as session:
                note = await NoteOperations(session).move(
                    user_id=user_id,
                    organization_id=organization_id,
                    note_id=note_id,
                    target_access_mode=target_access_mode,
                    target_baseline_role=target_baseline_role,
                    target_group_ids=target_group_ids,
                )
                return MoveNoteResponse(
                    note=await _note_proto(session, user_id, organization_id, note)
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("move_note", exc) from exc

    async def copy_note(self, request: Any, ctx: RequestContext) -> Any:
        raise ConnectError(Code.UNIMPLEMENTED, "CopyNote not yet implemented")
