"""Built-in note tools for agents."""

from __future__ import annotations

import contextlib
import json
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.notes.note import Note
from uniffy.core.models.shared import NodeType
from uniffy.domains.agents.tools.definitions import ToolContext, ToolDefinition, ToolResult

_MAX_NOTE_CONTENT_CHARS = 50_000


async def _execute_delete_note(ctx: ToolContext, args: dict) -> ToolResult:
    """Delete a note by ID."""
    from uniffy.domains.notes.operations import NoteOperations

    note_id_str = args.get("note_id", "")
    if not note_id_str:
        return ToolResult(success=False, data="", error="note_id is required")

    try:
        note_id = UUID(note_id_str)
    except ValueError:
        return ToolResult(success=False, data="", error=f"Invalid note_id: {note_id_str}")

    ops = NoteOperations(ctx.session)
    await ops.delete(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        note_id=note_id,
    )

    return ToolResult(success=True, data="Note deleted successfully.")


async def _filter_out_folders(
    session: AsyncSession,
    results: list,
) -> list:
    """Remove folder entries from search results.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    results : list
        Search results with URNs.

    Returns
    -------
    list
        Filtered results with folders excluded.

    """
    note_ids: list[UUID] = []
    for r in results:
        with contextlib.suppress(ValueError, IndexError):
            note_ids.append(UUID(r.urn.split(":")[-1]))

    if not note_ids:
        return results

    folder_result = await session.execute(
        select(Note.id).where(
            Note.id.in_(note_ids),
            Note.node_type == NodeType.FOLDER,
        )
    )
    folder_ids = {row[0] for row in folder_result.all()}

    if not folder_ids:
        return results

    return [r for r in results if UUID(r.urn.split(":")[-1]) not in folder_ids]


async def _execute_search_notes(ctx: ToolContext, args: dict) -> ToolResult:
    """Search notes by keyword."""
    from uniffy.domains.search.operations import SearchOperations

    query = args.get("query", "")
    if not query:
        return ToolResult(success=False, data="", error="query is required")

    limit = min(args.get("limit", 10), 20)

    ops = SearchOperations(ctx.session)
    results, total = await ops.search(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        query_text=query,
        type_filters=["note"],
        limit=limit,
    )

    if not results:
        return ToolResult(success=True, data="No notes found.")

    # Exclude folders from results
    results = await _filter_out_folders(ctx.session, results)

    if not results:
        return ToolResult(success=True, data="No notes found.")

    lines = [f"Found {len(results)} notes:"]
    for r in results:
        desc = f" - {r.description[:100]}..." if r.description else ""
        lines.append(f"- [[[{r.title}|{r.urn}]]]{desc}")

    return ToolResult(success=True, data="\n".join(lines))


async def _execute_list_notes(ctx: ToolContext, args: dict) -> ToolResult:
    """List the user's notes, excluding folders."""
    from uniffy.domains.notes.operations import NoteOperations

    limit = min(args.get("limit", 20), 50)
    page = max(args.get("page", 1), 1)

    ops = NoteOperations(ctx.session)
    notes, total = await ops.list_notes(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        page=page,
        page_size=limit,
    )

    # Exclude folders, templates, and canvases -- only return actual notes
    notes = [n for n in notes if n.node_type == NodeType.NOTE]

    if not notes:
        return ToolResult(success=True, data="No notes found.")

    lines = [f"Found {total} items (showing {len(notes)} notes, page {page}):"]
    for n in notes:
        desc = f" - {n.content[:100]}..." if n.content else ""
        urn = f"urn:uniffy:content:NOTE:{n.id}"
        lines.append(f"- [[[{n.title}|{urn}]]]{desc}")

    return ToolResult(success=True, data="\n".join(lines))


async def _execute_read_note(ctx: ToolContext, args: dict) -> ToolResult:
    """Read a note's full content."""
    from uniffy.domains.notes.operations import NoteOperations

    note_id_str = args.get("note_id", "")
    if not note_id_str:
        return ToolResult(success=False, data="", error="note_id is required")

    try:
        note_id = UUID(note_id_str)
    except ValueError:
        return ToolResult(success=False, data="", error=f"Invalid note_id: {note_id_str}")

    ops = NoteOperations(ctx.session)
    note = await ops.get_by_id(ctx.user_id, ctx.organization_id, note_id)

    note_content = note.content or ""
    content_truncated = len(note_content) > _MAX_NOTE_CONTENT_CHARS
    if content_truncated:
        note_content = note_content[:_MAX_NOTE_CONTENT_CHARS]

    result_dict: dict = {
        "id": str(note.id),
        "title": note.title,
        "content": note_content,
        "tags": note.tags or [],
        "access_mode": (
            note.access_mode.value if hasattr(note.access_mode, "value") else str(note.access_mode)
        ),
        "baseline_role": (
            note.baseline_role.value
            if note.baseline_role and hasattr(note.baseline_role, "value")
            else (str(note.baseline_role) if note.baseline_role else None)
        ),
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

    data = json.dumps(result_dict, indent=2)

    return ToolResult(success=True, data=data)


async def _execute_create_note(ctx: ToolContext, args: dict) -> ToolResult:
    """Create a new note."""
    from uniffy.domains.notes.operations import NoteOperations

    title = args.get("title", "")
    if not title:
        return ToolResult(success=False, data="", error="title is required")

    content = args.get("content", "")

    ops = NoteOperations(ctx.session)
    note = await ops.create(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        title=title,
        content=content,
    )

    urn = f"urn:uniffy:content:NOTE:{note.id}"
    return ToolResult(
        success=True,
        data=f"Note created successfully: [[[{note.title}|{urn}]]]",
    )


async def _execute_update_note(ctx: ToolContext, args: dict) -> ToolResult:
    """Update an existing note."""
    from uniffy.domains.notes.operations import NoteOperations

    note_id_str = args.get("note_id", "")
    if not note_id_str:
        return ToolResult(success=False, data="", error="note_id is required")

    try:
        note_id = UUID(note_id_str)
    except ValueError:
        return ToolResult(success=False, data="", error=f"Invalid note_id: {note_id_str}")

    title = args.get("title")
    content = args.get("content")

    if title is None and content is None:
        return ToolResult(
            success=False,
            data="",
            error="At least one of title or content must be provided",
        )

    ops = NoteOperations(ctx.session)
    note = await ops.update(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        note_id=note_id,
        title=title,
        content=content,
    )

    urn = f"urn:uniffy:content:NOTE:{note.id}"
    return ToolResult(
        success=True,
        data=f"Note updated successfully: [[[{note.title}|{urn}]]]",
    )


# -- Tool definitions --------------------------------------------------------

search_notes = ToolDefinition(
    name="notes.search_notes",
    description=(
        "Search the user's notes by keyword. Returns matching note titles and IDs. "
        "Only returns actual notes, not folders."
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
    description=(
        "List the user's notes. Use this when the user wants to browse their notes "
        "without a specific search query. Only returns actual notes, not folders."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
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

read_note = ToolDefinition(
    name="notes.read_note",
    description="Read the full content of a specific note by its ID.",
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
    description="Create a new note with a title and optional markdown content.",
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
        },
        "required": ["title"],
    },
    executor=_execute_create_note,
)

update_note = ToolDefinition(
    name="notes.update_note",
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

delete_note = ToolDefinition(
    name="notes.delete_note",
    description="Delete a note permanently. This is destructive and cannot be undone.",
    parameter_schema={
        "type": "object",
        "properties": {
            "note_id": {
                "type": "string",
                "description": "UUID of the note to delete.",
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
    read_note,
    create_note,
    update_note,
    delete_note,
]
