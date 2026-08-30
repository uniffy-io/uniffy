"""Read-only notes RPC handlers."""

from uuid import UUID

from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from uniffy_proto.notes.v1.notes_pb2 import (
    GetBacklinksRequest,
    GetBacklinksResponse,
    GetNoteRequest,
    GetNoteResponse,
    ListNotesRequest,
    ListNotesResponse,
)

from uniffy.core.auth.permissions import resolve_effective_policy
from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.auth.principal import current_user_id
from uniffy.core.converters.common_proto import access_mode_from_proto
from uniffy.core.types import ContentType, ParentSelection, SortOrder
from uniffy.domains.notes.converters import note_to_proto, note_to_reference
from uniffy.domains.notes.operations import NoteOperations
from uniffy.domains.notes.rpc.support import (
    map_domain_error,
    parse_tag_ids,
    parse_uuid,
    resolve_note_policy,
    resolve_user_role,
)
from uniffy.domains.permissions.access import ResourceAccessResolver, ResourceKey
from uniffy.domains.tags.context import ContentTagContext
from uniffy.infrastructure.database import open_session


def _note_urn(note_id: UUID) -> str:
    return f"urn:uniffy:content:NOTE:{note_id}"


class NoteQueryHandlers:
    async def get_note(
        self,
        request: GetNoteRequest,
        ctx: RequestContext,
    ) -> GetNoteResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        note_id = parse_uuid(request.note_id, "note_id")
        try:
            async with open_session() as session:
                operations = NoteOperations(session, self.storage, self.search_indexer)
                note = await operations.get_by_id(user_id, organization_id, note_id)
                sharing = (await operations.get_notes_sharing_info([note], user_id)).get(note.id)
                tags_by_urn = await ContentTagContext(session).get_for_urns(
                    organization_id=organization_id,
                    content_urns=[_note_urn(note.id)],
                )
                user_role = await resolve_user_role(session, user_id, organization_id, note)
                effective_mode, effective_baseline = await resolve_note_policy(
                    session,
                    organization_id,
                    note,
                )
                return GetNoteResponse(
                    note=note_to_proto(
                        note,
                        owner_info=sharing.owner_info if sharing else None,
                        shared_with=sharing.shared_with if sharing else None,
                        tags=tags_by_urn.get(_note_urn(note.id), []),
                        user_role=user_role,
                        effective_access_mode=effective_mode,
                        effective_baseline_role=effective_baseline,
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("get_note", exc) from exc

    async def list_notes(
        self,
        request: ListNotesRequest,
        ctx: RequestContext,
    ) -> ListNotesResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        group_id = parse_uuid(request.group_id, "group_id") if request.HasField("group_id") else None
        parent_id: UUID | ParentSelection | None = None
        if request.HasField("parent_id"):
            parent_id = (
                ParentSelection.ROOT
                if request.parent_id == ""
                else parse_uuid(request.parent_id, "parent_id")
            )
        access_mode = request.access_mode if request.access_mode else None
        page = max(1, request.page or 1)
        page_size = min(500, max(1, request.page_size or 50))
        tag_ids = parse_tag_ids(list(request.tag_ids)) if request.tag_ids else None

        try:
            async with open_session() as session:
                operations = NoteOperations(session, self.storage, self.search_indexer)
                notes, total = await operations.list_notes(
                    user_id=user_id,
                    organization_id=organization_id,
                    parent_id=parent_id,
                    access_mode=(access_mode_from_proto(access_mode) if access_mode else None),
                    group_id=group_id,
                    personal_only=request.personal_only,
                    include_deleted=request.include_deleted,
                    tag_ids=tag_ids,
                    page=page,
                    page_size=page_size,
                    sort_by=request.sort_by or "updated_at",
                    sort_order=SortOrder(request.sort_order or SortOrder.DESCENDING),
                )
                sharing = await operations.get_notes_sharing_info(notes, user_id)
                tags_by_urn = await ContentTagContext(session).get_for_urns(
                    organization_id=organization_id,
                    content_urns=[_note_urn(note.id) for note in notes],
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
                for note in notes:
                    info = sharing.get(note.id)
                    user_role = decisions[ResourceKey(ContentType.NOTE, note.id)].role
                    effective_mode, effective_baseline = resolve_effective_policy(
                        note.access_mode,
                        note.baseline_role,
                        default_mode,
                        default_baseline,
                    )
                    proto_notes.append(
                        note_to_proto(
                            note,
                            exclude_content=request.exclude_content,
                            owner_info=info.owner_info if info else None,
                            shared_with=info.shared_with if info else None,
                            tags=tags_by_urn.get(_note_urn(note.id), []),
                            user_role=user_role,
                            effective_access_mode=effective_mode,
                            effective_baseline_role=effective_baseline,
                        )
                    )

                return ListNotesResponse(
                    notes=proto_notes,
                    total_count=total,
                    page=page,
                    page_size=page_size,
                    total_pages=(total + page_size - 1) // page_size,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("list_notes", exc) from exc

    async def get_backlinks(
        self,
        request: GetBacklinksRequest,
        ctx: RequestContext,
    ) -> GetBacklinksResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        note_id = parse_uuid(request.note_id, "note_id")
        try:
            async with open_session() as session:
                backlinks = await NoteOperations(
                    session,
                    self.storage,
                    self.search_indexer,
                ).get_backlinks(
                    user_id,
                    organization_id,
                    note_id,
                )
                return GetBacklinksResponse(
                    backlinks=[note_to_reference(note) for note in backlinks],
                    total_count=len(backlinks),
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("get_backlinks", exc) from exc
