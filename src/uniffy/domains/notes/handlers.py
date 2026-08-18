"""Notes RPC handlers."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession
from uniffy_proto.notes.v1.notes_pb2 import (
    CreateNoteRequest,
    CreateNoteResponse,
    DeleteNoteRequest,
    DeleteNoteResponse,
    EmptyTrashRequest,
    EmptyTrashResponse,
    GetBacklinksRequest,
    GetBacklinksResponse,
    GetNoteRequest,
    GetNoteResponse,
    ListNotesRequest,
    ListNotesResponse,
    MoveNoteResponse,
    RestoreNoteRequest,
    RestoreNoteResponse,
    SearchNotesRequest,
    UpdateNoteRequest,
    UpdateNoteResponse,
)

from uniffy.core.auth.permissions import resolve_effective_policy
from uniffy.core.auth.permissions.checker import PermissionChecker
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
from uniffy.core.json_codec import loads
from uniffy.core.models.notes.note import Note
from uniffy.core.types import ContentRole, ContentType, NodeType, ParentSelection, SortOrder
from uniffy.db import open_session
from uniffy.domains.auth.context import get_user_id_from_context
from uniffy.domains.notes.converters import (
    node_type_from_proto,
    note_to_proto,
    note_to_reference,
)
from uniffy.domains.notes.operations import NoteOperations
from uniffy.domains.permissions.resource_access import ResourceAccessResolver, ResourceKey
from uniffy.domains.tags import TagOperations

logger = logger.bind(component="notes.handlers")


async def _resolve_user_role(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
    note: Note,
    checker: PermissionChecker | None = None,
) -> ContentRole | None:
    # Share the ``checker`` across rows in list endpoints to amortise lookups.
    permission_checker = checker or PermissionChecker(session)
    return await permission_checker.effective_role(
        user_id=user_id,
        organization_id=organization_id,
        content_type=ContentType.NOTE,
        content_id=note.id,
        owner_id=note.owner_id,
        access_mode=note.access_mode,
        baseline_role=note.baseline_role,
    )


async def _resolve_effective_policy(
    session: AsyncSession,
    organization_id: UUID,
    note: Note,
    checker: PermissionChecker | None = None,
):
    permission_checker = checker or PermissionChecker(session)
    default_mode, default_baseline = await permission_checker.get_org_defaults(
        organization_id,
        ContentType.NOTE,
    )
    return resolve_effective_policy(
        note.access_mode,
        note.baseline_role,
        default_mode,
        default_baseline,
    )


def _parse_uuid(value: str, field: str) -> UUID:
    try:
        return UUID(value)
    except ValueError as exc:
        raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid {field}: {exc}") from exc


def _parse_tag_id_list(values: list[str]) -> list[UUID]:
    return [_parse_uuid(value, "tag_id") for value in values]


def _parse_canvas_content(content: str | None) -> dict | None:
    # Canvas notes ship JSON canvas state in the ``content`` field.
    if not content:
        return None
    try:
        parsed = loads(content)
    except ValueError, TypeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _map_domain_error(operation: str, exc: Exception) -> ConnectError:
    if isinstance(exc, NotFoundError):
        return ConnectError(Code.NOT_FOUND, "Note not found")
    if isinstance(exc, ValidationError):
        return ConnectError(Code.INVALID_ARGUMENT, str(exc))
    if isinstance(exc, PermissionDeniedError):
        return ConnectError(Code.PERMISSION_DENIED, str(exc) or "Access denied")
    if isinstance(exc, ConflictError):
        return ConnectError(Code.ABORTED, str(exc))
    logger.exception(f"Error in {operation}: {exc}")
    return ConnectError(Code.INTERNAL, "Internal server error")


class NotesHandlers:
    """RPC handlers for ``notes.v1.NotesService``."""

    async def create_note(
        self,
        request: CreateNoteRequest,
        ctx: RequestContext,
    ) -> CreateNoteResponse:
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

        canvas_content = None
        content = request.content
        if node_type == NodeType.CANVAS:
            canvas_content = _parse_canvas_content(content)
            if canvas_content is not None:
                content = ""

        tag_ids = _parse_tag_id_list(list(request.tag_ids)) if request.tag_ids else None

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
                    tag_ids=tag_ids,
                    metadata=metadata if metadata else None,
                    group_ids=group_ids,
                )
                tags_by_urn = await TagOperations(session).get_for_urns(
                    organization_id=organization_id,
                    content_urns=[f"urn:uniffy:content:NOTE:{note.id}"],
                )
                user_role = await _resolve_user_role(session, user_id, organization_id, note)
                eff_mode, eff_baseline = await _resolve_effective_policy(
                    session,
                    organization_id,
                    note,
                )
                return CreateNoteResponse(
                    note=note_to_proto(
                        note,
                        tags=tags_by_urn.get(f"urn:uniffy:content:NOTE:{note.id}", []),
                        user_role=user_role,
                        effective_access_mode=eff_mode,
                        effective_baseline_role=eff_baseline,
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("create_note", exc) from exc

    async def get_note(
        self,
        request: GetNoteRequest,
        ctx: RequestContext,
    ) -> GetNoteResponse:
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        note_id = _parse_uuid(request.note_id, "note_id")

        try:
            async with open_session() as session:
                ops = NoteOperations(session)
                note = await ops.get_by_id(user_id, organization_id, note_id)
                sharing = (await ops.get_notes_sharing_info([note], user_id)).get(note.id)
                tags_by_urn = await TagOperations(session).get_for_urns(
                    organization_id=organization_id,
                    content_urns=[f"urn:uniffy:content:NOTE:{note.id}"],
                )
                user_role = await _resolve_user_role(session, user_id, organization_id, note)
                eff_mode, eff_baseline = await _resolve_effective_policy(
                    session,
                    organization_id,
                    note,
                )
                return GetNoteResponse(
                    note=note_to_proto(
                        note,
                        owner_info=sharing.owner_info if sharing else None,
                        shared_with=sharing.shared_with if sharing else None,
                        tags=tags_by_urn.get(f"urn:uniffy:content:NOTE:{note.id}", []),
                        user_role=user_role,
                        effective_access_mode=eff_mode,
                        effective_baseline_role=eff_baseline,
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
    ) -> UpdateNoteResponse:
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

        tag_ids: list[UUID] | None = None
        if request.HasField("tag_ids"):
            tag_ids = _parse_tag_id_list(list(request.tag_ids.ids))

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
                    tag_ids=tag_ids,
                    metadata=metadata,
                )
                tags_by_urn = await TagOperations(session).get_for_urns(
                    organization_id=organization_id,
                    content_urns=[f"urn:uniffy:content:NOTE:{note.id}"],
                )
                user_role = await _resolve_user_role(session, user_id, organization_id, note)
                eff_mode, eff_baseline = await _resolve_effective_policy(
                    session,
                    organization_id,
                    note,
                )
                return UpdateNoteResponse(
                    note=note_to_proto(
                        note,
                        tags=tags_by_urn.get(f"urn:uniffy:content:NOTE:{note.id}", []),
                        user_role=user_role,
                        effective_access_mode=eff_mode,
                        effective_baseline_role=eff_baseline,
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("update_note", exc) from exc

    async def delete_note(
        self,
        request: DeleteNoteRequest,
        ctx: RequestContext,
    ) -> DeleteNoteResponse:
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
    ) -> RestoreNoteResponse:
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        note_id = _parse_uuid(request.note_id, "note_id")

        try:
            async with open_session() as session:
                ops = NoteOperations(session)
                note = await ops.restore(user_id, organization_id, note_id)
                tags_by_urn = await TagOperations(session).get_for_urns(
                    organization_id=organization_id,
                    content_urns=[f"urn:uniffy:content:NOTE:{note.id}"],
                )
                user_role = await _resolve_user_role(session, user_id, organization_id, note)
                eff_mode, eff_baseline = await _resolve_effective_policy(
                    session,
                    organization_id,
                    note,
                )
                return RestoreNoteResponse(
                    note=note_to_proto(
                        note,
                        tags=tags_by_urn.get(f"urn:uniffy:content:NOTE:{note.id}", []),
                        user_role=user_role,
                        effective_access_mode=eff_mode,
                        effective_baseline_role=eff_baseline,
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("restore_note", exc) from exc

    async def list_notes(
        self,
        request: ListNotesRequest,
        ctx: RequestContext,
    ) -> ListNotesResponse:
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")

        group_id = (
            _parse_uuid(request.group_id, "group_id") if request.HasField("group_id") else None
        )

        parent_id: UUID | ParentSelection | None = None
        if request.HasField("parent_id"):
            parent_id = (
                ParentSelection.ROOT
                if request.parent_id == ""
                else _parse_uuid(request.parent_id, "parent_id")
            )

        access_mode_filter = (
            access_mode_from_proto(request.access_mode) if request.access_mode else None
        )
        page = max(1, request.page or 1)
        page_size = min(500, max(1, request.page_size or 50))

        tag_ids = _parse_tag_id_list(list(request.tag_ids)) if request.tag_ids else None

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
                    tag_ids=tag_ids,
                    page=page,
                    page_size=page_size,
                    sort_by=request.sort_by or "updated_at",
                    sort_order=SortOrder(request.sort_order or SortOrder.DESCENDING),
                )

                sharing = await ops.get_notes_sharing_info(notes, user_id)
                tag_ops = TagOperations(session)
                urn_for = lambda n: f"urn:uniffy:content:NOTE:{n.id}"  # noqa: E731
                tags_by_urn = await tag_ops.get_for_urns(
                    organization_id=organization_id,
                    content_urns=[urn_for(n) for n in notes],
                )
                checker = PermissionChecker(session)
                default_mode, default_baseline = await checker.get_org_defaults(
                    organization_id,
                    ContentType.NOTE,
                )
                decisions = await ResourceAccessResolver(session).resolve_page(
                    actor_id=user_id,
                    organization_id=organization_id,
                    keys=[ResourceKey(ContentType.NOTE, note.id) for note in notes],
                )
                proto_notes = []
                for n in notes:
                    info = sharing.get(n.id)
                    user_role = decisions[ResourceKey(ContentType.NOTE, n.id)].role
                    eff_mode, eff_baseline = resolve_effective_policy(
                        n.access_mode,
                        n.baseline_role,
                        default_mode,
                        default_baseline,
                    )
                    proto_notes.append(
                        note_to_proto(
                            n,
                            exclude_content=request.exclude_content,
                            owner_info=info.owner_info if info else None,
                            shared_with=info.shared_with if info else None,
                            tags=tags_by_urn.get(urn_for(n), []),
                            user_role=user_role,
                            effective_access_mode=eff_mode,
                            effective_baseline_role=eff_baseline,
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

    async def get_backlinks(
        self,
        request: GetBacklinksRequest,
        ctx: RequestContext,
    ) -> GetBacklinksResponse:
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        note_id = _parse_uuid(request.note_id, "note_id")

        try:
            async with open_session() as session:
                ops = NoteOperations(session)
                backlinks = await ops.get_backlinks(user_id, organization_id, note_id)
                return GetBacklinksResponse(
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

    async def move_note(self, request, ctx: RequestContext) -> MoveNoteResponse:
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        note_id = _parse_uuid(request.note_id, "note_id")

        target_access_mode = access_mode_from_proto(request.target_access_mode)

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
                tags_by_urn = await TagOperations(session).get_for_urns(
                    organization_id=organization_id,
                    content_urns=[f"urn:uniffy:content:NOTE:{note.id}"],
                )
                user_role = await _resolve_user_role(session, user_id, organization_id, note)
                eff_mode, eff_baseline = await _resolve_effective_policy(
                    session,
                    organization_id,
                    note,
                )
                return MoveNoteResponse(
                    note=note_to_proto(
                        note,
                        tags=tags_by_urn.get(f"urn:uniffy:content:NOTE:{note.id}", []),
                        user_role=user_role,
                        effective_access_mode=eff_mode,
                        effective_baseline_role=eff_baseline,
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("move_note", exc) from exc

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
