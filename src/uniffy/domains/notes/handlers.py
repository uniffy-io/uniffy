"""Notes RPC handlers."""

import json
from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.notes.v1.notes_pb2 import (
    AutosaveNoteRequest,
    AutosaveNoteResponse,
    BacklinksResponse,
    CreateNoteRequest,
    DeleteNoteRequest,
    DeleteNoteResponse,
    EmptyTrashRequest,
    EmptyTrashResponse,
    GetBacklinksRequest,
    GetNoteRequest,
    ListNotesRequest,
    ListNotesResponse,
    NoteResponse,
    RestoreNoteRequest,
    SearchNotesRequest,
    UpdateNoteRequest,
)

from uniffy.core.converters import datetime_to_timestamp
from uniffy.core.converters.common_proto import (
    access_mode_from_proto,
    content_role_from_proto,
)
from uniffy.core.errors import (
    ConflictError,
    NotFoundError,
    PermissionDeniedError,
    ValidationError,
)
from uniffy.core.types import NodeType
from uniffy.db import open_session
from uniffy.domains.auth.context import get_user_id_from_context
from uniffy.domains.notes.converters import (
    node_type_from_proto,
    note_to_proto,
    note_to_reference,
)
from uniffy.domains.notes.operations import NoteOperations


def _parse_uuid(value: str, field: str) -> UUID:
    """Parse a UUID string or raise ``INVALID_ARGUMENT``."""
    try:
        return UUID(value)
    except ValueError as exc:
        raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid {field}: {exc}") from exc


def _parse_canvas_content(content: str | None) -> dict | None:
    """Try to interpret ``content`` as JSON canvas data.

    Returns the parsed dict on success, ``None`` if ``content`` is empty
    or does not parse. Used by the create / update / autosave handlers
    to support the canvas note type, where the editor sends the canvas
    state as a JSON-encoded string in the ``content`` field.
    """
    if not content:
        return None
    try:
        parsed = json.loads(content)
    except (ValueError, TypeError):
        return None
    return parsed if isinstance(parsed, dict) else None


def _map_domain_error(operation: str, exc: Exception) -> ConnectError:
    """Translate a domain exception into the matching ``ConnectError``."""
    if isinstance(exc, NotFoundError):
        return ConnectError(Code.NOT_FOUND, "Note not found")
    if isinstance(exc, ValidationError):
        return ConnectError(Code.INVALID_ARGUMENT, str(exc))
    if isinstance(exc, PermissionDeniedError):
        return ConnectError(Code.PERMISSION_DENIED, str(exc) or "Access denied")
    if isinstance(exc, ConflictError):
        return ConnectError(Code.ABORTED, str(exc))
    logger.error(f"Error in {operation}: {exc}", exc_info=True)
    return ConnectError(Code.INTERNAL, "Internal server error")


class NotesHandlers:
    """RPC handlers for ``notes.v1.NotesService``."""

    async def create_note(
        self,
        request: CreateNoteRequest,
        ctx: RequestContext,
    ) -> NoteResponse:
        """Create a new note."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")

        access_mode = access_mode_from_proto(request.access_mode) if request.access_mode else None
        baseline_role = (
            content_role_from_proto(request.baseline_role) if request.baseline_role else None
        )
        node_type = node_type_from_proto(request.node_type)

        parent_id = (
            _parse_uuid(request.parent_id, "parent_id") if request.HasField("parent_id") else None
        )
        group_ids = [_parse_uuid(gid, "group_id") for gid in request.group_ids] or None

        metadata = dict(request.metadata) if request.metadata else {}
        if request.HasField("icon"):
            metadata["icon"] = {
                "type": request.icon.icon_type,
                "value": request.icon.value,
            }

        # Canvas notes ship the JSON canvas state in the `content` field.
        canvas_content = None
        content = request.content
        if node_type == NodeType.CANVAS:
            canvas_content = _parse_canvas_content(content)
            if canvas_content is not None:
                content = ""

        try:
            async with open_session() as session:
                ops = NoteOperations(session)
                note = await ops.create(
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
                    tags=list(request.tags) if request.tags else None,
                    metadata=metadata if metadata else None,
                    group_ids=group_ids,
                )
                return NoteResponse(note=note_to_proto(note))
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("create_note", exc) from exc

    async def get_note(
        self,
        request: GetNoteRequest,
        ctx: RequestContext,
    ) -> NoteResponse:
        """Get a single note (with sharing info for the UI)."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        note_id = _parse_uuid(request.note_id, "note_id")

        try:
            async with open_session() as session:
                ops = NoteOperations(session)
                note = await ops.get_by_id(user_id, organization_id, note_id)
                sharing = (await ops.get_notes_sharing_info([note], user_id)).get(note.id)
                return NoteResponse(
                    note=note_to_proto(
                        note,
                        owner_info=sharing.owner_info if sharing else None,
                        shared_with=sharing.shared_with if sharing else None,
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("get_note", exc) from exc

    async def update_note(
        self,
        request: UpdateNoteRequest,
        ctx: RequestContext,
    ) -> NoteResponse:
        """Update note metadata and/or body."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        note_id = _parse_uuid(request.note_id, "note_id")

        parent_id: UUID | str | None = None
        if request.HasField("parent_id"):
            parent_id = (
                "" if request.parent_id == "" else _parse_uuid(request.parent_id, "parent_id")
            )

        metadata = dict(request.metadata) if request.metadata else None
        if request.HasField("icon"):
            metadata = metadata or {}
            metadata["icon"] = {
                "type": request.icon.icon_type,
                "value": request.icon.value,
            }

        content = request.content if request.HasField("content") else None
        canvas_content = _parse_canvas_content(content) if content is not None else None

        try:
            async with open_session() as session:
                ops = NoteOperations(session)
                note = await ops.update(
                    user_id=user_id,
                    organization_id=organization_id,
                    note_id=note_id,
                    title=request.title if request.HasField("title") else None,
                    content=content,
                    canvas_content=canvas_content,
                    slug=request.slug if request.HasField("slug") else None,
                    parent_id=parent_id,
                    tags=list(request.tags) if request.tags else None,
                    metadata=metadata,
                )
                return NoteResponse(note=note_to_proto(note))
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("update_note", exc) from exc

    async def delete_note(
        self,
        request: DeleteNoteRequest,
        ctx: RequestContext,
    ) -> DeleteNoteResponse:
        """Delete a note (soft or permanent)."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        note_id = _parse_uuid(request.note_id, "note_id")

        try:
            async with open_session() as session:
                ops = NoteOperations(session)
                await ops.delete(
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
            raise _map_domain_error("delete_note", exc) from exc

    async def restore_note(
        self,
        request: RestoreNoteRequest,
        ctx: RequestContext,
    ) -> NoteResponse:
        """Restore a soft-deleted note."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        note_id = _parse_uuid(request.note_id, "note_id")

        try:
            async with open_session() as session:
                ops = NoteOperations(session)
                note = await ops.restore(user_id, organization_id, note_id)
                return NoteResponse(note=note_to_proto(note))
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("restore_note", exc) from exc

    async def list_notes(
        self,
        request: ListNotesRequest,
        ctx: RequestContext,
    ) -> ListNotesResponse:
        """List notes with filters and pagination."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")

        group_id = (
            _parse_uuid(request.group_id, "group_id") if request.HasField("group_id") else None
        )

        parent_id: UUID | str | None = None
        if request.HasField("parent_id"):
            parent_id = (
                "root" if request.parent_id == "" else _parse_uuid(request.parent_id, "parent_id")
            )

        access_mode_filter = (
            access_mode_from_proto(request.access_mode) if request.access_mode else None
        )
        page = max(1, request.page or 1)
        page_size = min(500, max(1, request.page_size or 50))

        try:
            async with open_session() as session:
                ops = NoteOperations(session)
                notes, total = await ops.list_notes(
                    user_id=user_id,
                    organization_id=organization_id,
                    parent_id=parent_id,
                    access_mode=access_mode_filter,
                    group_id=group_id,
                    personal_only=request.personal_only,
                    include_deleted=request.include_deleted,
                    tags=list(request.tags) if request.tags else None,
                    page=page,
                    page_size=page_size,
                    sort_by=request.sort_by or "updated_at",
                    sort_order=request.sort_order or "desc",
                )

                sharing = await ops.get_notes_sharing_info(notes, user_id)
                proto_notes = []
                for n in notes:
                    info = sharing.get(n.id)
                    proto_notes.append(
                        note_to_proto(
                            n,
                            exclude_content=request.exclude_content,
                            owner_info=info.owner_info if info else None,
                            shared_with=info.shared_with if info else None,
                        )
                    )

                total_pages = (total + page_size - 1) // page_size
                return ListNotesResponse(
                    notes=proto_notes,
                    total_count=total,
                    page=page,
                    page_size=page_size,
                    total_pages=total_pages,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("list_notes", exc) from exc

    async def autosave_note(
        self,
        request: AutosaveNoteRequest,
        ctx: RequestContext,
    ) -> AutosaveNoteResponse:
        """Fast-path content save used by the editor."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        note_id = _parse_uuid(request.note_id, "note_id")

        canvas_content = _parse_canvas_content(request.content)

        try:
            async with open_session() as session:
                ops = NoteOperations(session)
                note = await ops.autosave(
                    user_id=user_id,
                    organization_id=organization_id,
                    note_id=note_id,
                    content=request.content,
                    canvas_content=canvas_content,
                    title=request.title if request.HasField("title") else None,
                    expected_version=(
                        request.expected_version
                        if request.HasField("expected_version")
                        else None
                    ),
                )
                return AutosaveNoteResponse(
                    success=True,
                    saved_at=datetime_to_timestamp(note.updated_at),
                    version=note.version,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("autosave_note", exc) from exc

    async def get_backlinks(
        self,
        request: GetBacklinksRequest,
        ctx: RequestContext,
    ) -> BacklinksResponse:
        """Return notes that reference the target note (the user can see)."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        note_id = _parse_uuid(request.note_id, "note_id")

        try:
            async with open_session() as session:
                ops = NoteOperations(session)
                backlinks = await ops.get_backlinks(user_id, organization_id, note_id)
                return BacklinksResponse(
                    backlinks=[note_to_reference(n) for n in backlinks],
                    total_count=len(backlinks),
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("get_backlinks", exc) from exc

    async def empty_trash(
        self,
        request: EmptyTrashRequest,
        ctx: RequestContext,
    ) -> EmptyTrashResponse:
        """Permanently delete every soft-deleted note in the org."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")

        try:
            async with open_session() as session:
                ops = NoteOperations(session)
                count = await ops.empty_trash(user_id, organization_id)
                return EmptyTrashResponse(
                    deleted_count=count,
                    success=True,
                    message=f"Successfully deleted {count} note(s) from trash",
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("empty_trash", exc) from exc

    async def move_note(self, request, ctx: RequestContext) -> NoteResponse:
        """Change a note's access mode (and optional baseline role / groups)."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        note_id = _parse_uuid(request.note_id, "note_id")

        target_access_mode = access_mode_from_proto(request.target_access_mode)
        if target_access_mode is None:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid target_access_mode")

        target_baseline_role = (
            content_role_from_proto(request.target_baseline_role)
            if request.target_baseline_role
            else None
        )
        target_group_ids = (
            [_parse_uuid(gid, "group_id") for gid in request.target_group_ids]
            if request.target_group_ids
            else None
        )

        try:
            async with open_session() as session:
                ops = NoteOperations(session)
                note = await ops.move(
                    user_id=user_id,
                    organization_id=organization_id,
                    note_id=note_id,
                    target_access_mode=target_access_mode,
                    target_baseline_role=target_baseline_role,
                    target_group_ids=target_group_ids,
                )
                return NoteResponse(note=note_to_proto(note))
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("move_note", exc) from exc

    # Stubs for RPCs still in the proto. All replaced by MembersService
    # (and SearchService for search_notes); remove from notes.proto in a
    # follow-up pass.

    async def search_notes(self, request: SearchNotesRequest, ctx: RequestContext):
        """Use ``search.v1.SearchService`` instead."""
        raise ConnectError(Code.UNIMPLEMENTED, "Use SearchService for note search")

    async def copy_note(self, request, ctx: RequestContext):
        """Not yet implemented."""
        raise ConnectError(Code.UNIMPLEMENTED, "CopyNote not yet implemented")

    async def share_note_with_group(self, request, ctx: RequestContext):
        """Replaced by ``permissions.v1.MembersService.AddMember``."""
        raise ConnectError(Code.UNIMPLEMENTED, "Use MembersService.AddMember instead")

    async def unshare_note_from_group(self, request, ctx: RequestContext):
        """Replaced by ``permissions.v1.MembersService.RemoveMember``."""
        raise ConnectError(Code.UNIMPLEMENTED, "Use MembersService.RemoveMember instead")

    async def get_note_sharing(self, request, ctx: RequestContext):
        """Replaced by ``permissions.v1.MembersService.ListMembers``."""
        raise ConnectError(Code.UNIMPLEMENTED, "Use MembersService.ListMembers instead")

    async def grant_permission(self, request, ctx: RequestContext):
        """Replaced by ``permissions.v1.MembersService.AddMember``."""
        raise ConnectError(Code.UNIMPLEMENTED, "Use MembersService.AddMember instead")

    async def revoke_permission(self, request, ctx: RequestContext):
        """Replaced by ``permissions.v1.MembersService.RemoveMember``."""
        raise ConnectError(Code.UNIMPLEMENTED, "Use MembersService.RemoveMember instead")
