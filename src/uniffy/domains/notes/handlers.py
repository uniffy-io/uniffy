"""Notes RPC handlers - thin layer delegating to operations."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger

from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models.shared import VisibilityScope
from uniffy.db import get_async_session
from uniffy.domains.auth.context import get_user_id_from_context
from uniffy.domains.notes.converters import (
    node_type_from_proto,
    note_to_proto,
    note_to_reference,
    visibility_from_proto,
)
from uniffy.domains.notes.operations import NoteOperations
from uniffy.gen.notes.v1.notes_pb2 import (
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
from uniffy.gen.notes.v1.notes_pb2 import (
    VisibilityScope as ProtoVisibilityScope,
)


class NotesHandlers:
    """Notes RPC handlers."""

    async def create_note(
        self,
        request: CreateNoteRequest,
        ctx: RequestContext,
    ) -> NoteResponse:
        """Create a new note."""
        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = NoteOperations(session)

                # Parse optional fields
                visibility = VisibilityScope.PRIVATE
                if request.HasField("visibility"):
                    visibility = visibility_from_proto(request.visibility)

                node_type = node_type_from_proto(request.node_type)

                parent_id = None
                if request.HasField("parent_id"):
                    try:
                        parent_id = UUID(request.parent_id)
                    except ValueError:
                        raise ConnectError(Code.INVALID_ARGUMENT, "Invalid parent_id")

                group_ids = None
                if request.group_ids:
                    group_ids = [UUID(gid) for gid in request.group_ids]

                # Build metadata dict, including icon if provided
                metadata = dict(request.metadata) if request.metadata else {}
                if request.HasField("icon"):
                    metadata["icon"] = {
                        "type": request.icon.icon_type,
                        "value": request.icon.value,
                    }

                note = await ops.create(
                    user_id=user_id,
                    organization_id=organization_id,
                    title=request.title,
                    content=request.content,
                    slug=request.slug if request.HasField("slug") else None,
                    visibility=visibility,
                    node_type=node_type,
                    parent_id=parent_id,
                    tags=list(request.tags) if request.tags else None,
                    metadata=metadata if metadata else None,
                    group_ids=group_ids,
                )

                return NoteResponse(note=note_to_proto(note))

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error creating note: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {str(e)}")

    async def get_note(
        self,
        request: GetNoteRequest,
        ctx: RequestContext,
    ) -> NoteResponse:
        """Get a note by ID."""
        try:
            note_id = UUID(request.note_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = NoteOperations(session)
                note = await ops.get_by_id(user_id, organization_id, note_id)
                return NoteResponse(note=note_to_proto(note))

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Note not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error getting note: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_note(
        self,
        request: UpdateNoteRequest,
        ctx: RequestContext,
    ) -> NoteResponse:
        """Update an existing note."""
        try:
            note_id = UUID(request.note_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = NoteOperations(session)

                # Parse parent_id
                parent_id = None
                if request.HasField("parent_id"):
                    if request.parent_id == "":
                        parent_id = ""  # Signal to remove parent
                    else:
                        try:
                            parent_id = UUID(request.parent_id)
                        except ValueError:
                            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid parent_id")

                # Build metadata dict, including icon if provided
                metadata = dict(request.metadata) if request.metadata else None
                if request.HasField("icon"):
                    if metadata is None:
                        metadata = {}
                    metadata["icon"] = {
                        "type": request.icon.icon_type,
                        "value": request.icon.value,
                    }

                note = await ops.update(
                    user_id=user_id,
                    organization_id=organization_id,
                    note_id=note_id,
                    title=request.title if request.HasField("title") else None,
                    content=request.content if request.HasField("content") else None,
                    slug=request.slug if request.HasField("slug") else None,
                    parent_id=parent_id,
                    tags=list(request.tags) if request.tags else None,
                    metadata=metadata,
                )

                return NoteResponse(note=note_to_proto(note))

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Note not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error updating note: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def delete_note(
        self,
        request: DeleteNoteRequest,
        ctx: RequestContext,
    ) -> DeleteNoteResponse:
        """Delete a note (soft or permanent)."""
        try:
            note_id = UUID(request.note_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = NoteOperations(session)
                await ops.delete(
                    user_id=user_id,
                    organization_id=organization_id,
                    note_id=note_id,
                    permanent=request.permanent,
                )

                message = "Note permanently deleted" if request.permanent else "Note deleted"
                return DeleteNoteResponse(success=True, message=message)

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Note not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error deleting note: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_notes(
        self,
        request: ListNotesRequest,
        ctx: RequestContext,
    ) -> ListNotesResponse:
        """List notes with filters and pagination."""
        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        user_id = get_user_id_from_context(ctx)

        # Parse filters
        group_id = None
        if request.HasField("group_id"):
            try:
                group_id = UUID(request.group_id)
            except ValueError:
                raise ConnectError(Code.INVALID_ARGUMENT, "Invalid group_id")

        parent_id = None
        if request.HasField("parent_id"):
            if request.parent_id == "":
                parent_id = "root"
            else:
                try:
                    parent_id = UUID(request.parent_id)
                except ValueError:
                    raise ConnectError(Code.INVALID_ARGUMENT, "Invalid parent_id")

        visibility = None
        if request.HasField("visibility"):
            visibility = visibility_from_proto(
                ProtoVisibilityScope.Value(f"VISIBILITY_SCOPE_{request.visibility.upper()}")
            )

        try:
            async for session in get_async_session():
                ops = NoteOperations(session)
                notes, total = await ops.list_notes(
                    user_id=user_id,
                    organization_id=organization_id,
                    parent_id=parent_id,
                    visibility=visibility,
                    group_id=group_id,
                    personal_only=request.personal_only,
                    include_deleted=request.include_deleted,
                    tags=list(request.tags) if request.tags else None,
                    page=max(1, request.page or 1),
                    page_size=min(100, max(1, request.page_size or 50)),
                    sort_by=request.sort_by or "updated_at",
                    sort_order=request.sort_order or "desc",
                )

                total_pages = (total + (request.page_size or 50) - 1) // (request.page_size or 50)

                return ListNotesResponse(
                    notes=[
                        note_to_proto(n, exclude_content=request.exclude_content)
                        for n in notes
                    ],
                    total_count=total,
                    page=request.page or 1,
                    page_size=request.page_size or 50,
                    total_pages=total_pages,
                )

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error listing notes: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {str(e)}")

    async def restore_note(
        self,
        request: RestoreNoteRequest,
        ctx: RequestContext,
    ) -> NoteResponse:
        """Restore a soft-deleted note."""
        try:
            note_id = UUID(request.note_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = NoteOperations(session)
                note = await ops.restore(
                    user_id=user_id,
                    organization_id=organization_id,
                    note_id=note_id,
                )
                return NoteResponse(note=note_to_proto(note))

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Note not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error restoring note: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {str(e)}")

    async def autosave_note(
        self,
        request: AutosaveNoteRequest,
        ctx: RequestContext,
    ) -> AutosaveNoteResponse:
        """Autosave note content."""
        try:
            note_id = UUID(request.note_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = NoteOperations(session)
                note = await ops.autosave(
                    user_id=user_id,
                    organization_id=organization_id,
                    note_id=note_id,
                    content=request.content,
                    title=request.title if request.HasField("title") else None,
                )

                from uniffy.core.converters import datetime_to_timestamp

                return AutosaveNoteResponse(
                    success=True,
                    saved_at=datetime_to_timestamp(note.updated_at),
                    version=note.version,
                )

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Note not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error autosaving note: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {str(e)}")

    async def get_backlinks(
        self,
        request: GetBacklinksRequest,
        ctx: RequestContext,
    ) -> BacklinksResponse:
        """Get backlinks for a note."""
        try:
            note_id = UUID(request.note_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = NoteOperations(session)
                backlinks = await ops.get_backlinks(
                    user_id=user_id,
                    organization_id=organization_id,
                    note_id=note_id,
                )

                return BacklinksResponse(
                    backlinks=[note_to_reference(n) for n in backlinks],
                    total_count=len(backlinks),
                )

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Note not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error getting backlinks: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def empty_trash(
        self,
        request: EmptyTrashRequest,
        ctx: RequestContext,
    ) -> EmptyTrashResponse:
        """Empty trash for an organization."""
        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        get_user_id_from_context(ctx)  # Verify auth

        try:
            async for session in get_async_session():
                ops = NoteOperations(session)
                count = await ops.empty_trash(
                    user_id=get_user_id_from_context(ctx),
                    organization_id=organization_id,
                )

                return EmptyTrashResponse(
                    deleted_count=count,
                    success=True,
                    message=f"Successfully deleted {count} note(s) from trash",
                )

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error emptying trash: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {str(e)}")

    # Unimplemented methods
    async def search_notes(self, request: SearchNotesRequest, ctx: RequestContext):
        """Search notes - delegated to search service."""
        raise ConnectError(Code.UNIMPLEMENTED, "Use SearchService for note search")

    async def move_note(self, request, ctx: RequestContext):
        """Move a note to a different parent."""
        raise ConnectError(Code.UNIMPLEMENTED, "MoveNote not yet implemented")

    async def copy_note(self, request, ctx: RequestContext):
        """Create a copy of a note."""
        raise ConnectError(Code.UNIMPLEMENTED, "CopyNote not yet implemented")

    async def share_note_with_group(self, request, ctx: RequestContext):
        """Share a note with a group."""
        raise ConnectError(Code.UNIMPLEMENTED, "ShareNoteWithGroup not yet implemented")

    async def unshare_note_from_group(self, request, ctx: RequestContext):
        """Unshare a note from a group."""
        raise ConnectError(Code.UNIMPLEMENTED, "UnshareNoteFromGroup not yet implemented")

    async def get_note_sharing(self, request, ctx: RequestContext):
        """Get sharing information for a note."""
        raise ConnectError(Code.UNIMPLEMENTED, "GetNoteSharing not yet implemented")

    async def grant_permission(self, request, ctx: RequestContext):
        """Grant permission to a user or group."""
        raise ConnectError(Code.UNIMPLEMENTED, "GrantPermission not yet implemented")

    async def revoke_permission(self, request, ctx: RequestContext):
        """Revoke permission from a user or group."""
        raise ConnectError(Code.UNIMPLEMENTED, "RevokePermission not yet implemented")
