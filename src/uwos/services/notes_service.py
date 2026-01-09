"""Notes service implementation for ConnectRPC."""

import logging
import re
from datetime import UTC, datetime
from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from google.protobuf.timestamp_pb2 import Timestamp
from sqlalchemy import func, select

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
from uwos.models import Note as NoteModel
from uwos.models.permissions import ContentGroupLink
from uwos.models.shared import ContentType, VisibilityScope
from uwos.repositories import note as note_repo
from uwos.services.permissions import (
    ContentAccessQuery,
    PermissionChecker,
)

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


def note_to_proto(note, user_permission_level=None) -> Note:
    """
    Convert SQLModel Note to protobuf Note.

    Parameters
    ----------
    note : uwos.models.Note
        SQLModel note instance.
    user_permission_level : PermissionLevel | None
        User's permission level on this note.

    Returns
    -------
    Note
        Protobuf note message.

    """
    proto_note = Note(
        id=str(note.id),
        organization_id=str(note.organization_id),
        owner_id=str(note.owner_id),
        visibility=note.visibility.value.upper(),  # Convert to proto enum format
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
    Implementation of NotesService with permission support.

    Provides note management via ConnectRPC with built-in
    access control using the BaseContentService.
    """

    def __init__(self):
        """Initialize the notes service."""
        pass

    def _get_user_id_from_context(self, ctx: RequestContext) -> UUID:
        """
        Extract user ID from request context.

        TODO: Implement JWT token extraction from Authorization header.

        Parameters
        ----------
        ctx : RequestContext
            RPC context.

        Returns
        -------
        UUID
            User ID.

        """
        # Placeholder until JWT authentication is implemented
        return UUID("00000000-0000-0000-0000-000000000000")

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

        user_id = self._get_user_id_from_context(ctx)

        visibility = VisibilityScope.PRIVATE  # Default
        if request.HasField("visibility"):
            visibility_str = request.visibility.lower()
            try:
                visibility = VisibilityScope(visibility_str.replace("visibility_scope_", ""))
            except ValueError:
                raise ConnectError(
                    Code.INVALID_ARGUMENT, f"Invalid visibility: {request.visibility}"
                )

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
                    owner_id=user_id,
                    title=request.title,
                    content=request.content,
                    slug=slug,
                    visibility=visibility,
                    parent_id=parent_id,
                    tags=list(request.tags) if request.tags else None,
                    metadata=dict(request.metadata) if request.metadata else None,
                )

                # If visibility is GROUP, create group links
                if visibility == VisibilityScope.GROUP and request.group_ids:
                    for group_id_str in request.group_ids:
                        try:
                            group_id = UUID(group_id_str)
                            link = ContentGroupLink(
                                organization_id=organization_id,
                                content_type=ContentType.NOTE,
                                content_id=note.id,
                                group_id=group_id,
                                linked_by_user_id=user_id,
                            )
                            session.add(link)
                        except ValueError:
                            logger.warning(f"Invalid group_id: {group_id_str}")

                    await session.commit()
                    await session.refresh(note)

                return NoteResponse(note=note_to_proto(note))

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error creating note: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_note(self, request: GetNoteRequest, ctx: RequestContext) -> NoteResponse:
        """
        Get a note by ID with permission checking.

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

        user_id = self._get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                note = await note_repo.get_note_by_id(session, note_id, organization_id)

                if not note:
                    raise ConnectError(Code.NOT_FOUND, "Note not found")

                # Check permission
                checker = PermissionChecker(session)
                can_access = await checker.can_access_content(
                    user_id=user_id,
                    organization_id=organization_id,
                    content_type=ContentType.NOTE,
                    content_id=note.id,
                    content_owner_id=note.owner_id,
                    content_visibility=note.visibility,
                )

                if not can_access:
                    raise ConnectError(Code.PERMISSION_DENIED, "You don't have access to this note")

                # Get user's permission level
                permission_level = await checker.get_user_permission_level(
                    user_id=user_id,
                    organization_id=organization_id,
                    content_type=ContentType.NOTE,
                    content_id=note.id,
                    content_owner_id=note.owner_id,
                )

                return NoteResponse(note=note_to_proto(note, permission_level))

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error getting note: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_note(self, request: UpdateNoteRequest, ctx: RequestContext) -> NoteResponse:
        """
        Update an existing note with permission checking.

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

        user_id = self._get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                note = await note_repo.get_note_by_id(session, note_id, organization_id)

                if not note:
                    raise ConnectError(Code.NOT_FOUND, "Note not found")

                # Check edit permission
                checker = PermissionChecker(session)
                can_edit = await checker.can_edit_content(
                    user_id=user_id,
                    organization_id=organization_id,
                    content_type=ContentType.NOTE,
                    content_id=note.id,
                    content_owner_id=note.owner_id,
                    content_visibility=note.visibility,
                )

                if not can_edit:
                    raise ConnectError(
                        Code.PERMISSION_DENIED, "You don't have permission to edit this note"
                    )
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
        Delete a note (soft or permanent) with permission checking.

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

        user_id = self._get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                note = await note_repo.get_note_by_id(session, note_id, organization_id)

                if not note:
                    raise ConnectError(Code.NOT_FOUND, "Note not found")

                # Check delete permission
                checker = PermissionChecker(session)
                can_delete = await checker.can_delete_content(
                    user_id=user_id,
                    organization_id=organization_id,
                    content_type=ContentType.NOTE,
                    content_id=note.id,
                    content_owner_id=note.owner_id,
                )

                if not can_delete:
                    raise ConnectError(
                        Code.PERMISSION_DENIED, "You don't have permission to delete this note"
                    )
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
        List notes with filters, pagination, and permission filtering.

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

        user_id = self._get_user_id_from_context(ctx)

        # Parse optional filters
        group_id = None
        if request.HasField("group_id"):
            try:
                group_id = UUID(request.group_id)
            except ValueError:
                raise ConnectError(Code.INVALID_ARGUMENT, "Invalid group_id")

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
                query_builder = ContentAccessQuery(session)

                # Base query
                query = select(NoteModel).where(NoteModel.organization_id == organization_id)

                # Apply visibility filter based on request
                if request.personal_only:
                    # Personal notes only
                    personal_filter = query_builder.build_personal_filter(
                        user_id=user_id,
                        owner_id_column=NoteModel.owner_id,
                        visibility_column=NoteModel.visibility,
                    )
                    query = query.where(personal_filter)
                elif group_id:
                    # Group notes only
                    group_filter = query_builder.build_group_filter(
                        group_id=group_id,
                        organization_id=organization_id,
                        content_type=ContentType.NOTE,
                        content_id_column=NoteModel.id,
                        visibility_column=NoteModel.visibility,
                    )
                    query = query.where(group_filter)
                elif request.HasField("visibility"):
                    # Specific visibility level
                    visibility_str = request.visibility.lower().replace("visibility_scope_", "")
                    try:
                        visibility = VisibilityScope(visibility_str)
                        query = query.where(NoteModel.visibility == visibility)

                        # Still need to check access rights
                        access_filter = query_builder.build_accessible_filter(
                            user_id=user_id,
                            organization_id=organization_id,
                            content_type=ContentType.NOTE,
                            content_id_column=NoteModel.id,
                            owner_id_column=NoteModel.owner_id,
                            visibility_column=NoteModel.visibility,
                        )
                        query = query.where(access_filter)
                    except ValueError:
                        raise ConnectError(
                            Code.INVALID_ARGUMENT, f"Invalid visibility: {request.visibility}"
                        )
                else:
                    # All accessible notes
                    access_filter = query_builder.build_accessible_filter(
                        user_id=user_id,
                        organization_id=organization_id,
                        content_type=ContentType.NOTE,
                        content_id_column=NoteModel.id,
                        owner_id_column=NoteModel.owner_id,
                        visibility_column=NoteModel.visibility,
                    )
                    query = query.where(access_filter)

                # Apply additional filters
                if parent_id == "root":
                    query = query.where(NoteModel.parent_id.is_(None))
                elif parent_id:
                    query = query.where(NoteModel.parent_id == parent_id)

                if request.tags:
                    # Filter by tags (notes must have all specified tags)
                    for tag in request.tags:
                        query = query.where(NoteModel.tags.contains([tag]))

                if not request.include_deleted:
                    query = query.where(NoteModel.is_deleted == False)  # noqa: E712

                if request.pinned_only:
                    query = query.where(NoteModel.is_pinned == True)  # noqa: E712

                count_query = select(func.count()).select_from(query.subquery())
                total_count = (await session.execute(count_query)).scalar()

                # Apply sorting
                sort_column = getattr(NoteModel, sort_by, NoteModel.updated_at)
                if sort_order == "asc":
                    query = query.order_by(sort_column.asc())
                else:
                    query = query.order_by(sort_column.desc())

                # Apply pagination
                query = query.offset((page - 1) * page_size).limit(page_size)

                # Execute query
                result = await session.execute(query)
                notes = list(result.scalars().all())

                # Get permission levels for each note
                note_protos = []
                for note in notes:
                    perm_level = await PermissionChecker.get_user_permission_level(
                        session=session,
                        user_id=user_id,
                        content_type=ContentType.NOTE,
                        content_id=note.id,
                        owner_id=note.owner_id,
                        visibility=note.visibility,
                        organization_id=organization_id,
                    )
                    note_protos.append(note_to_proto(note, user_permission_level=perm_level))

                total_pages = (total_count + page_size - 1) // page_size

                return ListNotesResponse(
                    notes=note_protos,
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
                # Get user_id for permission filtering
                user_id = await self._get_user_id_from_context(ctx, session)

                # Build base query with permission filtering
                query = ContentAccessQuery.build_accessible_filter(
                    content_type=ContentType.NOTE, user_id=user_id, organization_id=organization_id
                )

                # Add search and filter conditions
                query = query.where(NoteModel.organization_id == organization_id)

                if not request.include_deleted:
                    query = query.where(~NoteModel.is_deleted)

                # Apply tags filter
                if request.tags:
                    # Check if any of the requested tags are in the note's tags array
                    for tag in request.tags:
                        query = query.where(NoteModel.tags.contains([tag]))

                # Apply full-text search
                search_pattern = f"%{request.query}%"
                query = query.where(
                    (NoteModel.title.ilike(search_pattern))
                    | (NoteModel.content.ilike(search_pattern))
                )

                count_query = select(func.count()).select_from(query.subquery())
                result = await session.execute(count_query)
                total_count = result.scalar() or 0

                # Execute main query with pagination
                query = query.offset((page - 1) * page_size).limit(page_size)
                query = query.order_by(NoteModel.updated_at.desc())

                result = await session.execute(query)
                notes = result.scalars().all()

                # Get permission levels for each note
                note_protos = []
                for note in notes:
                    perm_level = await PermissionChecker.get_user_permission_level(
                        session=session,
                        user_id=user_id,
                        content_type=ContentType.NOTE,
                        content_id=note.id,
                        owner_id=note.owner_id,
                        visibility=note.visibility,
                        organization_id=organization_id,
                    )
                    note_protos.append(note_to_proto(note, user_permission_level=perm_level))

                return SearchNotesResponse(
                    notes=note_protos,
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
                # Get user_id for permission checking
                user_id = await self._get_user_id_from_context(ctx, session)

                # Check if user can view the target note
                note = await note_repo.get_note_by_id(session, note_id, organization_id)
                if not note:
                    raise ConnectError(Code.NOT_FOUND, "Note not found")

                can_access = await PermissionChecker.can_access_content(
                    session=session,
                    user_id=user_id,
                    content_type=ContentType.NOTE,
                    content_id=note_id,
                    owner_id=note.owner_id,
                    visibility=note.visibility,
                    organization_id=organization_id,
                )

                if not can_access:
                    raise ConnectError(
                        Code.PERMISSION_DENIED, "You don't have permission to view this note"
                    )

                # Get backlinks
                backlinks = await note_repo.get_backlinks(session, note_id, organization_id)

                # Filter backlinks by permission
                accessible_backlinks = []
                for backlink in backlinks:
                    can_access_backlink = await PermissionChecker.can_access_content(
                        session=session,
                        user_id=user_id,
                        content_type=ContentType.NOTE,
                        content_id=backlink.id,
                        owner_id=backlink.owner_id,
                        visibility=backlink.visibility,
                        organization_id=organization_id,
                    )
                    if can_access_backlink:
                        accessible_backlinks.append(backlink)

                references = [
                    NoteReference(
                        id=str(note.id),
                        title=note.title,
                        slug=note.slug,
                        created_by=str(note.owner_id),
                        updated_at=datetime_to_timestamp(note.updated_at),
                    )
                    for note in accessible_backlinks
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
                # Get user_id for permission checking
                user_id = await self._get_user_id_from_context(ctx, session)

                note = await note_repo.get_note_by_id(session, note_id, organization_id)
                if not note:
                    raise ConnectError(Code.NOT_FOUND, "Note not found")

                # Check if user has edit permission
                can_edit = await PermissionChecker.can_edit_content(
                    session=session,
                    user_id=user_id,
                    content_type=ContentType.NOTE,
                    content_id=note_id,
                    owner_id=note.owner_id,
                    visibility=note.visibility,
                    organization_id=organization_id,
                )

                if not can_edit:
                    raise ConnectError(
                        Code.PERMISSION_DENIED, "You don't have permission to pin/unpin this note"
                    )

                note = await note_repo.toggle_pin(session, note, request.pinned)

                # Get permission level for proto
                perm_level = await PermissionChecker.get_user_permission_level(
                    session=session,
                    user_id=user_id,
                    content_type=ContentType.NOTE,
                    content_id=note.id,
                    owner_id=note.owner_id,
                    visibility=note.visibility,
                    organization_id=organization_id,
                )

                return NoteResponse(note=note_to_proto(note, user_permission_level=perm_level))

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
                # Get user_id for permission checking
                user_id = await self._get_user_id_from_context(ctx, session)

                note = await note_repo.get_note_by_id(session, note_id, organization_id)
                if not note:
                    raise ConnectError(Code.NOT_FOUND, "Note not found")

                if not note.is_deleted:
                    raise ConnectError(Code.FAILED_PRECONDITION, "Note is not deleted")

                # Check if user has edit permission (restore requires edit)
                can_edit = await PermissionChecker.can_edit_content(
                    session=session,
                    user_id=user_id,
                    content_type=ContentType.NOTE,
                    content_id=note_id,
                    owner_id=note.owner_id,
                    visibility=note.visibility,
                    organization_id=organization_id,
                )

                if not can_edit:
                    raise ConnectError(
                        Code.PERMISSION_DENIED, "You don't have permission to restore this note"
                    )

                note = await note_repo.restore_note(session, note)

                # Get permission level for proto
                perm_level = await PermissionChecker.get_user_permission_level(
                    session=session,
                    user_id=user_id,
                    content_type=ContentType.NOTE,
                    content_id=note.id,
                    owner_id=note.owner_id,
                    visibility=note.visibility,
                    organization_id=organization_id,
                )

                return NoteResponse(note=note_to_proto(note, user_permission_level=perm_level))

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
                # Get user_id for permission checking
                user_id = await self._get_user_id_from_context(ctx, session)

                note = await note_repo.get_note_by_id(session, note_id, organization_id)
                if not note:
                    raise ConnectError(Code.NOT_FOUND, "Note not found")

                # Check if user has edit permission
                can_edit = await PermissionChecker.can_edit_content(
                    session=session,
                    user_id=user_id,
                    content_type=ContentType.NOTE,
                    content_id=note_id,
                    owner_id=note.owner_id,
                    visibility=note.visibility,
                    organization_id=organization_id,
                )

                if not can_edit:
                    raise ConnectError(
                        Code.PERMISSION_DENIED, "You don't have permission to edit this note"
                    )

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
