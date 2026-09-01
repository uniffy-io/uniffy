"""Built-in note tools for agents."""

from __future__ import annotations

import contextlib
from uuid import UUID

from sqlalchemy import select

from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.auth.permissions.queries import ContentAccessQuery
from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.json_codec import OPTION_INDENT_2, dumps_str
from uniffy.core.models.notes.note import Note
from uniffy.core.models.shared import NodeType
from uniffy.core.types import ContentType
from uniffy.domains.agents.tools.builtin.args import MAX_PAGE, clamp_int, clamp_page, parse_uuid
from uniffy.domains.agents.tools.builtin.content import (
    creation_space_schema,
    parse_creation_space,
    resolve_parent_access_mode,
    space_for_access_mode,
)
from uniffy.domains.agents.tools.definitions import ToolContext, ToolDefinition, ToolResult
from uniffy.domains.notes.operations import NoteOperations
from uniffy.domains.notes.reader import NoteReader
from uniffy.domains.tags.operations import TagOperations

_MAX_NOTE_CONTENT_CHARS = 50_000

# The notes tree is one table: a folder is a Note row with node_type FOLDER and
# no body of its own. Every listing therefore states which kind it returned, or
# the model reads a folder as an empty note.
_KIND_LABELS: dict[NodeType, str] = {
    NodeType.NOTE: "note",
    NodeType.FOLDER: "folder",
    NodeType.CANVAS: "canvas",
    NodeType.TEMPLATE: "template",
}

_ROOT_VALUES = {"root", "", "none", "null"}


def _paging_hint(total: int, shown: int, page: int, kind: str, narrower: str) -> str | None:
    """Tell the model to narrow instead of walking a large workspace page by page."""
    seen = (page - 1) * shown + shown
    if total <= seen:
        return None
    if page >= MAX_PAGE:
        return f"Page {MAX_PAGE} is the last page available; narrow the request with {narrower}."
    return (
        f"{total - seen} more {kind} not shown. Ask for the next page, or narrow the "
        f"request with {narrower}."
    )


_FOLDER_ARG_DESC = (
    "UUID of a notes folder, or 'root' for the top level. Folder ids come from "
    "notes.list_folders - a note id is not a folder id."
)


def _note_urn(note_id: UUID | str) -> str:
    return f"urn:uniffy:content:NOTE:{note_id}"


def _kind(note: Note) -> str:
    return _KIND_LABELS.get(note.node_type, "note")


async def _fetch_titles(ctx: ToolContext, ids: set[UUID]) -> dict[UUID, str]:
    """Titles for parent folders, one query for the whole listing.

    Restricted to folders the caller can view: a note shared into a private
    folder must not carry that folder's name back out. Callers render a missing
    id as "unknown folder".
    """
    if not ids:
        return {}
    access = ContentAccessQuery(ctx.session)
    result = await ctx.session.execute(
        select(Note.id, Note.title).where(
            Note.id.in_(ids),
            Note.organization_id == ctx.organization_id,
            await access.build_accessible_filter(
                user_id=ctx.user_id,
                organization_id=ctx.organization_id,
                content_type=ContentType.NOTE,
                content_id_column=Note.id,
                owner_id_column=Note.owner_id,
                access_mode_column=Note.access_mode,
                baseline_role_column=Note.baseline_role,
            ),
        )
    )
    return {row[0]: row[1] for row in result.all()}


async def _resolve_folder_arg(
    ctx: ToolContext,
    raw: str,
) -> tuple[UUID | None, str | None]:
    """Resolve a folder argument to (folder_id, error); ``None`` means root.

    A write must land where the user can already reach, and it must land in a
    FOLDER - a note id here would silently nest content under a document.
    """

    if raw.strip().lower() in _ROOT_VALUES:
        return None, None

    folder_id, err = parse_uuid(raw, "folder_id")
    if err:
        return None, err

    ops = NoteReader(ctx.session)
    try:
        folder = await ops.get_by_id(ctx.user_id, ctx.organization_id, folder_id)  # type: ignore[arg-type]
    except NotFoundError, PermissionDeniedError:
        return None, f"No accessible notes folder with id {raw}."

    if folder.node_type != NodeType.FOLDER:
        return None, (
            f"'{folder.title}' is a {_kind(folder)}, not a folder. "
            "Use notes.list_folders to find a folder id."
        )
    return folder_id, None


async def _node_types_by_id(
    ctx: ToolContext,
    ids: list[UUID],
) -> dict[UUID, NodeType]:
    if not ids:
        return {}
    result = await ctx.session.execute(
        select(Note.id, Note.node_type).where(
            Note.id.in_(ids),
            Note.organization_id == ctx.organization_id,
        )
    )
    return {row[0]: row[1] for row in result.all()}


async def _execute_search_notes(ctx: ToolContext, args: dict) -> ToolResult:
    """Search notes by keyword, excluding folders."""
    from uniffy.domains.search.operations import SearchOperations

    query = args.get("query", "")
    if not query:
        return ToolResult(success=False, data="", error="query is required")

    limit = clamp_int(args.get("limit", 10), 10, 1, 20)

    ops = SearchOperations(ctx.session, ctx.search)
    results, _has_more, _next_offset = await ops.search(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        query_text=query,
        type_filters=["note"],
        limit=limit,
    )

    if not results:
        return ToolResult(success=True, data="No notes found.")

    # Folders share the NOTE index type, so the kind comes from the rows.
    ids: list[UUID] = []
    for r in results:
        with contextlib.suppress(ValueError, IndexError):
            ids.append(UUID(r.urn.split(":")[-1]))
    kinds = await _node_types_by_id(ctx, ids)

    lines: list[str] = []
    folders_hidden = 0
    for r in results:
        try:
            rid = UUID(r.urn.split(":")[-1])
        except ValueError, IndexError:
            rid = None
        node_type = kinds.get(rid) if rid else None
        if node_type == NodeType.FOLDER:
            folders_hidden += 1
            continue
        label = _KIND_LABELS.get(node_type, "note") if node_type else "note"
        desc = f" - {r.description[:100]}..." if r.description else ""
        lines.append(f"- [{label}] [[[{r.title}|{r.urn}]]]{desc}")

    if not lines:
        return ToolResult(
            success=True,
            data="No notes found (matching folders are listed by notes.list_folders).",
        )

    header = f"Found {len(lines)} notes:"
    if folders_hidden:
        header += f" ({folders_hidden} matching folders omitted - use notes.list_folders for those)"
    return ToolResult(success=True, data="\n".join([header, *lines]))


async def _execute_list_notes(ctx: ToolContext, args: dict) -> ToolResult:
    """List notes, optionally scoped to one folder. Never returns folders."""

    limit = clamp_int(args.get("limit", 20), 20, 1, 50)
    page = clamp_page(args.get("page", 1))

    raw_folder = args.get("folder_id")
    parent_id: UUID | str | None = None
    scope = "every folder"
    if raw_folder is not None:
        if str(raw_folder).strip().lower() in _ROOT_VALUES:
            parent_id = "root"
            scope = "the top level"
        else:
            folder_id, err = await _resolve_folder_arg(ctx, str(raw_folder))
            if err:
                return ToolResult(success=False, data="", error=err)
            parent_id = folder_id
            scope = "this folder"

    ops = NoteReader(ctx.session)
    notes, total = await ops.list_notes(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        parent_id=parent_id,
        node_types=[NodeType.NOTE],
        page=page,
        page_size=limit,
    )

    if not notes:
        return ToolResult(
            success=True,
            data=f"No notes in {scope}. Folders are listed by notes.list_folders.",
        )

    folder_titles = await _fetch_titles(ctx, {n.parent_id for n in notes if n.parent_id})

    lines = [f"Found {total} notes in {scope} (showing {len(notes)}, page {page}):"]
    for n in notes:
        desc = f" - {n.content[:100]}..." if n.content else ""
        location = f" [in {folder_titles.get(n.parent_id, 'unknown folder')}]" if n.parent_id else ""
        lines.append(f"- [[[{n.title}|{_note_urn(n.id)}]]]{location}{desc}")

    hint = _paging_hint(total, len(notes), page, "notes", "notes.search_notes or a folder_id")
    if hint:
        lines.append(hint)

    return ToolResult(success=True, data="\n".join(lines))


async def _execute_list_folders(ctx: ToolContext, args: dict) -> ToolResult:
    """List notes folders - the containers, not the notes inside them."""

    limit = clamp_int(args.get("limit", 50), 50, 1, 100)
    page = clamp_page(args.get("page", 1))

    raw_parent = args.get("parent_id")
    parent_id: UUID | str | None = None
    scope = "the workspace"
    if raw_parent is not None:
        if str(raw_parent).strip().lower() in _ROOT_VALUES:
            parent_id = "root"
            scope = "the top level"
        else:
            folder_id, err = await _resolve_folder_arg(ctx, str(raw_parent))
            if err:
                return ToolResult(success=False, data="", error=err)
            parent_id = folder_id
            scope = "this folder"

    ops = NoteReader(ctx.session)
    folders, total = await ops.list_notes(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        parent_id=parent_id,
        node_types=[NodeType.FOLDER],
        page=page,
        page_size=limit,
        sort_by="title",
        sort_order="asc",
    )

    if not folders:
        return ToolResult(success=True, data=f"No notes folders in {scope}.")

    parent_titles = await _fetch_titles(ctx, {f.parent_id for f in folders if f.parent_id})
    default_mode, _ = await PermissionChecker(ctx.session).get_org_defaults(
        ctx.organization_id,
        ContentType.NOTE,
    )

    lines = [f"Found {total} folders in {scope} (showing {len(folders)}, page {page}):"]
    for f in folders:
        location = f" [in {parent_titles.get(f.parent_id, 'unknown folder')}]" if f.parent_id else ""
        space = space_for_access_mode(
            f.access_mode,
            default_mode,
            owner_id=f.owner_id,
            current_user_id=ctx.user_id,
        )
        lines.append(f"- {f.title} (folder_id: {f.id}, space: {space}){location}")

    hint = _paging_hint(total, len(folders), page, "folders", "a parent_id")
    if hint:
        lines.append(hint)
    lines.append("Pass a folder_id to notes.list_notes to see what is inside.")
    return ToolResult(success=True, data="\n".join(lines))


async def _execute_read_note(ctx: ToolContext, args: dict) -> ToolResult:
    """Read a note's full content."""

    note_id_str = args.get("note_id", "")
    if not note_id_str:
        return ToolResult(success=False, data="", error="note_id is required")

    note_id, err = parse_uuid(note_id_str, "note_id")
    if err:
        return ToolResult(success=False, data="", error=err)

    ops = NoteReader(ctx.session)
    note = await ops.get_by_id(ctx.user_id, ctx.organization_id, note_id)  # type: ignore[arg-type]

    if note.node_type == NodeType.FOLDER:
        return ToolResult(
            success=False,
            data="",
            error=(
                f"'{note.title}' is a folder, not a note. It holds notes instead of "
                "content - list them with notes.list_notes(folder_id=...)."
            ),
        )

    note_content = note.content or ""
    content_truncated = len(note_content) > _MAX_NOTE_CONTENT_CHARS
    if content_truncated:
        note_content = note_content[:_MAX_NOTE_CONTENT_CHARS]

    urn = _note_urn(note.id)
    tag_ops = TagOperations(ctx.session, ctx.search_indexer)
    tags_by_urn = await tag_ops.get_for_urns(
        organization_id=ctx.organization_id,
        content_urns=[urn],
    )
    note_tags = [tag.slug for tag in tags_by_urn.get(urn, [])]

    folder_titles = await _fetch_titles(ctx, {note.parent_id} if note.parent_id else set())

    result_dict: dict = {
        "id": str(note.id),
        "kind": _kind(note),
        "title": note.title,
        "content": note_content,
        "tags": note_tags,
        "folder_id": str(note.parent_id) if note.parent_id else None,
        "folder_title": folder_titles.get(note.parent_id) if note.parent_id else None,
        "access_mode": (note.access_mode.value if note.access_mode is not None else None),
        "baseline_role": (note.baseline_role.value if note.baseline_role is not None else None),
        "created_at": note.created_at.isoformat() if note.created_at else None,
        "updated_at": note.updated_at.isoformat() if note.updated_at else None,
    }
    if content_truncated:
        original_len = len(note.content or "")
        result_dict["_truncated"] = True
        result_dict["_original_length"] = original_len
        result_dict["_truncation_notice"] = (
            f"Content truncated: showing {_MAX_NOTE_CONTENT_CHARS:,} of {original_len:,} characters"
        )

    return ToolResult(success=True, data=dumps_str(result_dict, option=OPTION_INDENT_2))


async def _execute_create_note(ctx: ToolContext, args: dict) -> ToolResult:

    title = args.get("title", "")
    if not title:
        return ToolResult(success=False, data="", error="title is required")

    access_mode, space_err = parse_creation_space(args)
    if space_err:
        return ToolResult(success=False, data="", error=space_err)
    assert access_mode is not None

    parent_id: UUID | None = None
    raw_folder = args.get("folder_id")
    if raw_folder is not None:
        parent_id, err = await _resolve_folder_arg(ctx, str(raw_folder))
        if err:
            return ToolResult(success=False, data="", error=err)

    ops = NoteOperations(ctx.session, ctx.required_storage, ctx.required_search)
    if parent_id is not None:
        parent = await ops.get_by_id(ctx.user_id, ctx.organization_id, parent_id)
        access_mode, err = await resolve_parent_access_mode(
            ctx.session,
            ctx.organization_id,
            ContentType.NOTE,
            parent.access_mode,
            access_mode,
            parent_owner_id=parent.owner_id,
            current_user_id=ctx.user_id,
            space_was_explicit="space" in args,  # noqa: PLR2004
        )
        if err:
            return ToolResult(success=False, data="", error=err)
        assert access_mode is not None

    note = await ops.create(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        title=title,
        content=args.get("content", ""),
        parent_id=parent_id,
        access_mode=access_mode,
    )

    return ToolResult(
        success=True,
        data=(
            f"Note created successfully in {space_for_access_mode(access_mode, None).title()}: "
            f"[[[{note.title}|{_note_urn(note.id)}]]]"
        ),
    )


async def _execute_create_folder(ctx: ToolContext, args: dict) -> ToolResult:

    name = args.get("name", "")
    if not name:
        return ToolResult(success=False, data="", error="name is required")

    access_mode, space_err = parse_creation_space(args)
    if space_err:
        return ToolResult(success=False, data="", error=space_err)
    assert access_mode is not None

    parent_id: UUID | None = None
    raw_parent = args.get("parent_id")
    if raw_parent is not None:
        parent_id, err = await _resolve_folder_arg(ctx, str(raw_parent))
        if err:
            return ToolResult(success=False, data="", error=err)

    ops = NoteOperations(ctx.session, ctx.required_storage, ctx.required_search)
    if parent_id is not None:
        parent = await ops.get_by_id(ctx.user_id, ctx.organization_id, parent_id)
        access_mode, err = await resolve_parent_access_mode(
            ctx.session,
            ctx.organization_id,
            ContentType.NOTE,
            parent.access_mode,
            access_mode,
            parent_owner_id=parent.owner_id,
            current_user_id=ctx.user_id,
            space_was_explicit="space" in args,  # noqa: PLR2004
        )
        if err:
            return ToolResult(success=False, data="", error=err)
        assert access_mode is not None

    folder = await ops.create(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        title=name,
        node_type=NodeType.FOLDER,
        parent_id=parent_id,
        access_mode=access_mode,
    )

    return ToolResult(
        success=True,
        data=(
            f"Folder '{folder.title}' created in "
            f"{space_for_access_mode(access_mode, None).title()} (folder_id: {folder.id})."
        ),
    )


async def _execute_update_note(ctx: ToolContext, args: dict) -> ToolResult:
    """Update an existing note."""

    note_id_str = args.get("note_id", "")
    if not note_id_str:
        return ToolResult(success=False, data="", error="note_id is required")

    note_id, err = parse_uuid(note_id_str, "note_id")
    if err:
        return ToolResult(success=False, data="", error=err)

    title = args.get("title")
    content = args.get("content")

    if title is None and content is None:
        return ToolResult(
            success=False,
            data="",
            error="At least one of title or content must be provided",
        )

    ops = NoteOperations(ctx.session, ctx.required_storage, ctx.required_search)
    note = await ops.update(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        note_id=note_id,  # type: ignore[arg-type]
        title=title,
        content=content,
    )

    return ToolResult(
        success=True,
        data=f"Note updated successfully: [[[{note.title}|{_note_urn(note.id)}]]]",
    )


async def _execute_move_note(ctx: ToolContext, args: dict) -> ToolResult:
    """Move a note or folder into another folder."""

    note_id_str = args.get("note_id", "")
    if not note_id_str:
        return ToolResult(success=False, data="", error="note_id is required")

    note_id, err = parse_uuid(note_id_str, "note_id")
    if err:
        return ToolResult(success=False, data="", error=err)

    raw_folder = args.get("folder_id")
    if raw_folder is None:
        return ToolResult(
            success=False,
            data="",
            error="folder_id is required ('root' moves the item to the top level)",
        )

    parent_id, err = await _resolve_folder_arg(ctx, str(raw_folder))
    if err:
        return ToolResult(success=False, data="", error=err)

    ops = NoteOperations(ctx.session, ctx.required_storage, ctx.required_search)
    note = await ops.update(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        note_id=note_id,  # type: ignore[arg-type]
        # An empty string is how the domain clears a parent; None means "leave it".
        parent_id=parent_id if parent_id is not None else "",
    )

    destination = "the top level"
    if parent_id is not None:
        titles = await _fetch_titles(ctx, {parent_id})
        destination = f"'{titles.get(parent_id, 'folder')}'"

    return ToolResult(
        success=True,
        data=f"Moved [[[{note.title}|{_note_urn(note.id)}]]] to {destination}.",
    )


async def _execute_delete_note(ctx: ToolContext, args: dict) -> ToolResult:
    """Delete a note by ID."""

    note_id_str = args.get("note_id", "")
    if not note_id_str:
        return ToolResult(success=False, data="", error="note_id is required")

    note_id, err = parse_uuid(note_id_str, "note_id")
    if err:
        return ToolResult(success=False, data="", error=err)

    ops = NoteOperations(ctx.session, ctx.required_storage, ctx.required_search)
    note = await ops.get_by_id(ctx.user_id, ctx.organization_id, note_id)  # type: ignore[arg-type]
    is_folder = note.node_type == NodeType.FOLDER

    await ops.delete(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        note_id=note_id,  # type: ignore[arg-type]
    )

    if is_folder:
        return ToolResult(
            success=True,
            data=f"Folder '{note.title}' deleted, along with everything inside it.",
        )
    return ToolResult(success=True, data="Note deleted successfully.")


search_notes = ToolDefinition(
    name="notes.search_notes",
    display_name="Search Notes",
    group="Notes",
    description=(
        "Search the user's notes by keyword. Returns matching notes with their kind "
        "(note or canvas) and URN. Folders are containers and are not returned here - "
        "use notes.list_folders to find a folder."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Search query text.",
            },
            "limit": {
                "type": "integer",
                "description": "Maximum number of results (default 10, max 20).",
            },
        },
        "required": ["query"],
    },
    executor=_execute_search_notes,
    read_only=True,
)

list_notes = ToolDefinition(
    name="notes.list_notes",
    display_name="List Notes",
    group="Notes",
    description=(
        "List notes - the documents, never the folders that hold them. Omit folder_id "
        "to list notes from every folder, pass 'root' for the top level only, or a "
        "folder_id from notes.list_folders to list one folder's notes."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "folder_id": {
                "type": "string",
                "description": _FOLDER_ARG_DESC + " Omit to list notes from everywhere.",
            },
            "limit": {
                "type": "integer",
                "description": "Maximum number of results (default 20, max 50).",
            },
            "page": {
                "type": "integer",
                "description": "Page number for pagination (default 1).",
            },
        },
    },
    executor=_execute_list_notes,
    read_only=True,
)

list_folders = ToolDefinition(
    name="notes.list_folders",
    display_name="List Note Folders",
    group="Notes",
    description=(
        "List the notes folders. A folder holds notes and other folders; it has no "
        "content of its own. Returns folder ids to pass to notes.list_notes, "
        "notes.create_note or notes.move_note."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "parent_id": {
                "type": "string",
                "description": (
                    "UUID of a parent folder to list sub-folders of, or 'root' for "
                    "top-level folders. Omit to list every folder."
                ),
            },
            "limit": {
                "type": "integer",
                "description": "Maximum number of results (default 50, max 100).",
            },
            "page": {
                "type": "integer",
                "description": "Page number for pagination (default 1).",
            },
        },
    },
    executor=_execute_list_folders,
    read_only=True,
)

read_note = ToolDefinition(
    name="notes.read_note",
    display_name="Read Note",
    group="Notes",
    description=(
        "Read the full content of a specific note by its ID, including which folder "
        "it sits in. Folders hold no content and are rejected here."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "note_id": {
                "type": "string",
                "description": "UUID of the note to read.",
            },
        },
        "required": ["note_id"],
    },
    executor=_execute_read_note,
    read_only=True,
)

create_note = ToolDefinition(
    name="notes.create_note",
    display_name="Create Note",
    group="Notes",
    description=(
        "Create a new note with a title and optional markdown content. Pass folder_id "
        "to file it inside a folder; omit it to create the note at the top level. "
        "Omit space for a Personal top-level note; a chosen folder establishes the space "
        "for nested notes. Use organization only when the user explicitly requests it."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "description": "Note title.",
            },
            "content": {
                "type": "string",
                "description": "Note content in markdown format.",
            },
            "folder_id": {
                "type": "string",
                "description": _FOLDER_ARG_DESC,
            },
            "space": creation_space_schema(),
        },
        "required": ["title"],
    },
    executor=_execute_create_note,
)

create_folder = ToolDefinition(
    name="notes.create_folder",
    display_name="Create Note Folder",
    group="Notes",
    description=(
        "Create a notes folder to group notes in. A folder holds notes, it does not "
        "hold text - create notes inside it with notes.create_note(folder_id=...). "
        "Omit space for a Personal top-level folder; a chosen parent establishes the "
        "space for nested folders. Use organization only when explicitly requested."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "Folder name.",
            },
            "parent_id": {
                "type": "string",
                "description": (
                    "UUID of the folder to nest this one under. Omit for a top-level folder."
                ),
            },
            "space": creation_space_schema(),
        },
        "required": ["name"],
    },
    executor=_execute_create_folder,
)

update_note = ToolDefinition(
    name="notes.update_note",
    display_name="Edit Note",
    group="Notes",
    description="Update an existing note's title and/or content.",
    parameter_schema={
        "type": "object",
        "properties": {
            "note_id": {
                "type": "string",
                "description": "UUID of the note to update.",
            },
            "title": {
                "type": "string",
                "description": "New title for the note.",
            },
            "content": {
                "type": "string",
                "description": "New markdown content for the note.",
            },
        },
        "required": ["note_id"],
    },
    executor=_execute_update_note,
)

move_note = ToolDefinition(
    name="notes.move_note",
    display_name="Move Note",
    group="Notes",
    description=(
        "Move a note (or a whole folder) into another folder. Pass 'root' as folder_id "
        "to move it to the top level."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "note_id": {
                "type": "string",
                "description": "UUID of the note or folder to move.",
            },
            "folder_id": {
                "type": "string",
                "description": _FOLDER_ARG_DESC,
            },
        },
        "required": ["note_id", "folder_id"],
    },
    executor=_execute_move_note,
)

delete_note = ToolDefinition(
    name="notes.delete_note",
    display_name="Delete Note",
    group="Notes",
    description=(
        "Delete a note permanently. Deleting a folder deletes everything inside it. "
        "This is destructive and cannot be undone."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "note_id": {
                "type": "string",
                "description": "UUID of the note or folder to delete.",
            },
        },
        "required": ["note_id"],
    },
    executor=_execute_delete_note,
    destructive=True,
)

NOTES_TOOLS: list[ToolDefinition] = [
    search_notes,
    list_notes,
    list_folders,
    read_note,
    create_note,
    create_folder,
    update_note,
    move_note,
    delete_note,
]
