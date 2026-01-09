"""Notes service implementation for ConnectRPC."""

import logging
import re
from datetime import UTC, datetime
from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from google.protobuf.timestamp_pb2 import Timestamp

from uwos.db import get_async_session
from uwos.gen.notes.v1.notes_pb2 import (
    AutosaveNoteRequest,
    AutosaveNoteResponse,
    BacklinksResponse,
    CreateNoteRequest,
    DeleteNoteRequest,
    DeleteNoteResponse,
    GetBacklinksRequest,
    GetNoteRequest,
    ListNotesRequest,
    ListNotesResponse,
    Note,
    NoteReference,
    NoteResponse,
    RestoreNoteRequest,
    SearchNotesRequest,
    SearchNotesResponse,
    TogglePinRequest,
    UpdateNoteRequest,
)
from uwos.repositories import note as note_repo

logger = logging.getLogger(__name__)


def slugify(text: str) -> str:
    """
    Convert text to URL-friendly slug.

    Parameters
    ----------
    text : str
        Text to slugify.

    Returns
    -------
    str
        Slugified text.

    """
    # Convert to lowercase and replace spaces with hyphens
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[-\s]+", "-", text)
    return text[:500]  # Limit to max length


def datetime_to_timestamp(dt: datetime) -> Timestamp:
    """
    Convert datetime to protobuf Timestamp.

    Parameters
    ----------
    dt : datetime
        Datetime object.

    Returns
    -------
    Timestamp
        Protobuf timestamp.

    """
    timestamp = Timestamp()
    timestamp.FromDatetime(dt)
    return timestamp


def note_to_proto(note) -> Note:
    """
    Convert SQLModel Note to protobuf Note.

    Parameters
    ----------
    note : uwos.models.Note
        SQLModel note instance.

    Returns
    -------
    Note
        Protobuf note message.

    """
    proto_note = Note(
        id=str(note.id),
        organization_id=str(note.organization_id),
        created_by=str(note.created_by),
        title=note.title,
        content=note.content,
        slug=note.slug,
        is_deleted=note.is_deleted,
        is_pinned=note.is_pinned,
        version=note.version,
        tags=note.tags or [],
        metadata=note.note_metadata or {},
        created_at=datetime_to_timestamp(note.created_at),
        updated_at=datetime_to_timestamp(note.updated_at),
    )

    if note.parent_id:
        proto_note.parent_id = str(note.parent_id)

    if note.deleted_at:
        proto_note.deleted_at.CopyFrom(datetime_to_timestamp(note.deleted_at))

    return proto_note


class NotesServiceImpl:
    """
    Implementation of NotesService.

    Provides note management via ConnectRPC.
    """

    async def create_note(self, request: CreateNoteRequest, ctx: RequestContext) -> NoteResponse:
        """
        Create a new note.

        Parameters
        ----------
        request : CreateNoteRequest
            Note creation request.
        ctx : RequestContext
            RPC context.

        Returns
        -------
        NoteResponse
            Created note.

        """
        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        # TODO: Extract user_id from JWT token in Authorization header
        # For now, using a placeholder
        # created_by = extract_user_id_from_context(ctx)
        created_by = UUID("00000000-0000-0000-0000-000000000000")

        # Generate slug if not provided
        slug = request.slug if request.HasField("slug") else slugify(request.title)

        # Parse parent_id if provided
        parent_id = None
        if request.HasField("parent_id"):
            try:
                parent_id = UUID(request.parent_id)
            except ValueError:
                raise ConnectError(Code.INVALID_ARGUMENT, "Invalid parent_id")

        try:
            async for session in get_async_session():
                # Check if slug already exists
                existing = await note_repo.get_note_by_slug(session, slug, organization_id)
                if existing:
                    # Append timestamp to make slug unique
                    slug = f"{slug}-{int(datetime.now(UTC).timestamp())}"

                note = await note_repo.create_note(
                    session=session,
                    organization_id=organization_id,
                    created_by=created_by,
                    title=request.title,
                    content=request.content,
                    slug=slug,
                    parent_id=parent_id,
                    tags=list(request.tags) if request.tags else None,
                    metadata=dict(request.metadata) if request.metadata else None,
                )

                return NoteResponse(note=note_to_proto(note))

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error creating note: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_note(self, request: GetNoteRequest, ctx: RequestContext) -> NoteResponse:
        """
        Get a note by ID.

        Parameters
        ----------
        request : GetNoteRequest
            Get note request.
        ctx : RequestContext
            RPC context.

        Returns
        -------
        NoteResponse
            Note data.

        """
        try:
            note_id = UUID(request.note_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async for session in get_async_session():
                note = await note_repo.get_note_by_id(session, note_id, organization_id)

                if not note:
                    raise ConnectError(Code.NOT_FOUND, "Note not found")

                return NoteResponse(note=note_to_proto(note))

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error getting note: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_note(self, request: UpdateNoteRequest, ctx: RequestContext) -> NoteResponse:
        """
        Update an existing note.

        Parameters
        ----------
        request : UpdateNoteRequest
            Update note request.
        ctx : RequestContext
            RPC context.

        Returns
        -------
        NoteResponse
            Updated note.

        """
        try:
            note_id = UUID(request.note_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async for session in get_async_session():
                note = await note_repo.get_note_by_id(session, note_id, organization_id)

                if not note:
                    raise ConnectError(Code.NOT_FOUND, "Note not found")

                # Parse optional fields
                title = request.title if request.HasField("title") else None
                content = request.content if request.HasField("content") else None
                slug = request.slug if request.HasField("slug") else None

                parent_id = None
                if request.HasField("parent_id"):
                    if request.parent_id == "":
                        parent_id = ""  # Signal to remove parent
                    else:
                        try:
                            parent_id = UUID(request.parent_id)
                        except ValueError:
                            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid parent_id")

                tags = list(request.tags) if request.tags else None
                metadata = dict(request.metadata) if request.metadata else None

                note = await note_repo.update_note(
                    session=session,
                    note=note,
                    title=title,
                    content=content,
                    slug=slug,
                    parent_id=parent_id,
                    tags=tags,
                    metadata=metadata,
                )

                return NoteResponse(note=note_to_proto(note))

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error updating note: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def delete_note(
        self, request: DeleteNoteRequest, ctx: RequestContext
    ) -> DeleteNoteResponse:
        """
        Delete a note (soft or permanent).

        Parameters
        ----------
        request : DeleteNoteRequest
            Delete note request.
        ctx : RequestContext
            RPC context.

        Returns
        -------
        DeleteNoteResponse
            Deletion result.

        """
        try:
            note_id = UUID(request.note_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async for session in get_async_session():
                note = await note_repo.get_note_by_id(session, note_id, organization_id)

                if not note:
                    raise ConnectError(Code.NOT_FOUND, "Note not found")

                if request.permanent:
                    await note_repo.permanent_delete_note(session, note)
                    message = "Note permanently deleted"
                else:
                    await note_repo.soft_delete_note(session, note)
                    message = "Note deleted"

                return DeleteNoteResponse(success=True, message=message)

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error deleting note: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_notes(self, request: ListNotesRequest, ctx: RequestContext) -> ListNotesResponse:
        """
        List notes with filters and pagination.

        Parameters
        ----------
        request : ListNotesRequest
            List notes request.
        ctx : RequestContext
            RPC context.

        Returns
        -------
        ListNotesResponse
            List of notes with pagination info.

        """
        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        # Parse optional parent_id
        parent_id = None
        if request.HasField("parent_id"):
            if request.parent_id == "":
                parent_id = "root"  # Root notes only
            else:
                try:
                    parent_id = UUID(request.parent_id)
                except ValueError:
                    raise ConnectError(Code.INVALID_ARGUMENT, "Invalid parent_id")

        page = max(1, request.page or 1)
        page_size = min(100, max(1, request.page_size or 50))
        sort_by = request.sort_by or "updated_at"
        sort_order = request.sort_order or "desc"

        try:
            async for session in get_async_session():
                notes, total_count = await note_repo.list_notes(
                    session=session,
                    organization_id=organization_id,
                    parent_id=parent_id,
                    tags=list(request.tags) if request.tags else None,
                    include_deleted=request.include_deleted,
                    pinned_only=request.pinned_only,
                    page=page,
                    page_size=page_size,
                    sort_by=sort_by,
                    sort_order=sort_order,
                )

                total_pages = (total_count + page_size - 1) // page_size

                return ListNotesResponse(
                    notes=[note_to_proto(note) for note in notes],
                    total_count=total_count,
                    page=page,
                    page_size=page_size,
                    total_pages=total_pages,
                )

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error listing notes: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def search_notes(
        self, request: SearchNotesRequest, ctx: RequestContext
    ) -> SearchNotesResponse:
        """
        Search notes using full-text search.

        Parameters
        ----------
        request : SearchNotesRequest
            Search request.
        ctx : RequestContext
            RPC context.

        Returns
        -------
        SearchNotesResponse
            Search results with pagination.

        """
        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        if not request.query.strip():
            raise ConnectError(Code.INVALID_ARGUMENT, "Search query cannot be empty")

        page = max(1, request.page or 1)
        page_size = min(100, max(1, request.page_size or 50))

        try:
            async for session in get_async_session():
                notes, total_count = await note_repo.search_notes(
                    session=session,
                    organization_id=organization_id,
                    query_text=request.query,
                    tags=list(request.tags) if request.tags else None,
                    include_deleted=request.include_deleted,
                    page=page,
                    page_size=page_size,
                )

                return SearchNotesResponse(
                    notes=[note_to_proto(note) for note in notes],
                    total_count=total_count,
                    page=page,
                    page_size=page_size,
                )

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error searching notes: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_backlinks(
        self, request: GetBacklinksRequest, ctx: RequestContext
    ) -> BacklinksResponse:
        """
        Get backlinks for a note.

        Parameters
        ----------
        request : GetBacklinksRequest
            Backlinks request.
        ctx : RequestContext
            RPC context.

        Returns
        -------
        BacklinksResponse
            Notes that reference the target note.

        """
        try:
            note_id = UUID(request.note_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async for session in get_async_session():
                backlinks = await note_repo.get_backlinks(session, note_id, organization_id)

                references = [
                    NoteReference(
                        id=str(note.id),
                        title=note.title,
                        slug=note.slug,
                        created_by=str(note.created_by),
                        updated_at=datetime_to_timestamp(note.updated_at),
                    )
                    for note in backlinks
                ]

                return BacklinksResponse(backlinks=references, total_count=len(references))

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error getting backlinks: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def toggle_pin(self, request: TogglePinRequest, ctx: RequestContext) -> NoteResponse:
        """
        Pin or unpin a note.

        Parameters
        ----------
        request : TogglePinRequest
            Toggle pin request.
        ctx : RequestContext
            RPC context.

        Returns
        -------
        NoteResponse
            Updated note.

        """
        try:
            note_id = UUID(request.note_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async for session in get_async_session():
                note = await note_repo.get_note_by_id(session, note_id, organization_id)

                if not note:
                    raise ConnectError(Code.NOT_FOUND, "Note not found")

                note = await note_repo.toggle_pin(session, note, request.pinned)

                return NoteResponse(note=note_to_proto(note))

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error toggling pin: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def restore_note(self, request: RestoreNoteRequest, ctx: RequestContext) -> NoteResponse:
        """
        Restore a deleted note.

        Parameters
        ----------
        request : RestoreNoteRequest
            Restore note request.
        ctx : RequestContext
            RPC context.

        Returns
        -------
        NoteResponse
            Restored note.

        """
        try:
            note_id = UUID(request.note_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async for session in get_async_session():
                note = await note_repo.get_note_by_id(session, note_id, organization_id)

                if not note:
                    raise ConnectError(Code.NOT_FOUND, "Note not found")

                if not note.is_deleted:
                    raise ConnectError(Code.FAILED_PRECONDITION, "Note is not deleted")

                note = await note_repo.restore_note(session, note)

                return NoteResponse(note=note_to_proto(note))

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error restoring note: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def autosave_note(
        self, request: AutosaveNoteRequest, ctx: RequestContext
    ) -> AutosaveNoteResponse:
        """
        Autosave note content (optimized for frequent updates).

        Parameters
        ----------
        request : AutosaveNoteRequest
            Autosave request.
        ctx : RequestContext
            RPC context.

        Returns
        -------
        AutosaveNoteResponse
            Autosave result with timestamp and version.

        """
        try:
            note_id = UUID(request.note_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async for session in get_async_session():
                note = await note_repo.get_note_by_id(session, note_id, organization_id)

                if not note:
                    raise ConnectError(Code.NOT_FOUND, "Note not found")

                title = request.title if request.HasField("title") else None

                note = await note_repo.update_note(
                    session=session,
                    note=note,
                    title=title,
                    content=request.content,
                )

                return AutosaveNoteResponse(
                    success=True,
                    saved_at=datetime_to_timestamp(note.updated_at),
                    version=note.version,
                )

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error autosaving note: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")
