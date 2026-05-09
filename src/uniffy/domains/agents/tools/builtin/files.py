"""Built-in file tools for agents."""

from __future__ import annotations

import json
from uuid import UUID

from uniffy.core.extraction import UnsupportedFormatError, can_extract, extract_text
from uniffy.domains.agents.tools.definitions import ToolContext, ToolDefinition, ToolResult
from uniffy.domains.tags import TagOperations

# Maximum bytes to download for on-demand extraction (10 MB).
_MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024

# Default character limit returned to the LLM.
_DEFAULT_MAX_CHARS = 50_000


def _format_size(size_bytes: int | None) -> str:
    """Format bytes into a human-readable string."""
    if size_bytes is None:
        return "unknown size"
    if size_bytes < 1024:
        return f"{size_bytes} B"
    if size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    if size_bytes < 1024 * 1024 * 1024:
        return f"{size_bytes / (1024 * 1024):.1f} MB"
    return f"{size_bytes / (1024 * 1024 * 1024):.1f} GB"


# Tool executors


async def _execute_search_files(ctx: ToolContext, args: dict) -> ToolResult:
    """Search files by keyword."""
    from uniffy.domains.search.operations import SearchOperations

    query = args.get("query", "")
    if not query:
        return ToolResult(success=False, data="", error="query is required")

    limit = min(args.get("limit", 10), 20)

    ops = SearchOperations(ctx.session)
    results, _total = await ops.search(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        query_text=query,
        type_filters=["file"],
        limit=limit,
    )

    if not results:
        return ToolResult(success=True, data="No files found.")

    lines = [f"Found {len(results)} files:"]
    for r in results:
        desc = f" - {r.description[:100]}..." if r.description else ""
        lines.append(f"- [[[{r.title}|{r.urn}]]]{desc}")

    return ToolResult(success=True, data="\n".join(lines))


async def _execute_list_files(ctx: ToolContext, args: dict) -> ToolResult:
    """List the user's files with optional folder filtering."""
    from uniffy.domains.files.operations import FileOperations

    limit = min(args.get("limit", 20), 50)
    page = max(args.get("page", 1), 1)
    folder_id = args.get("folder_id")

    ops = FileOperations(ctx.session)
    files, total = await ops.list_files(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        folder_id=folder_id,
        page=page,
        page_size=limit,
    )

    if not files:
        return ToolResult(success=True, data="No files found.")

    lines = [f"Found {total} files (showing {len(files)}, page {page}):"]
    for f in files:
        size = _format_size(f.size_bytes)
        mime = f.mime_type or "unknown"
        urn = f"urn:uniffy:content:FILE:{f.id}"
        lines.append(f"- [[[{f.filename}|{urn}]]] ({mime}, {size})")

    return ToolResult(success=True, data="\n".join(lines))


async def _execute_get_file_info(ctx: ToolContext, args: dict) -> ToolResult:
    """Get detailed metadata for a file."""
    from uniffy.domains.files.operations import FileOperations

    file_id_str = args.get("file_id", "")
    if not file_id_str:
        return ToolResult(success=False, data="", error="file_id is required")

    try:
        file_id = UUID(file_id_str)
    except ValueError:
        return ToolResult(success=False, data="", error=f"Invalid file_id: {file_id_str}")

    ops = FileOperations(ctx.session)
    file = await ops.get_by_id(ctx.user_id, ctx.organization_id, file_id)

    urn = f"urn:uniffy:content:FILE:{file.id}"
    tag_ops = TagOperations(ctx.session)
    tags_by_urn = await tag_ops.get_for_urns(
        organization_id=ctx.organization_id,
        content_urns=[urn],
    )
    file_tag_slugs = [tag.slug for tag in tags_by_urn.get(urn, [])]

    data = json.dumps(
        {
            "id": str(file.id),
            "filename": file.filename,
            "original_filename": file.original_filename,
            "mime_type": file.mime_type,
            "size": _format_size(file.size_bytes),
            "size_bytes": file.size_bytes,
            "tags": file_tag_slugs,
            "description": file.description,
            "access_mode": (
                file.access_mode.value
                if hasattr(file.access_mode, "value")
                else str(file.access_mode)
            ),
            "baseline_role": (
                file.baseline_role.value
                if file.baseline_role and hasattr(file.baseline_role, "value")
                else (str(file.baseline_role) if file.baseline_role else None)
            ),
            "urn": file.urn,
            "created_at": file.created_at.isoformat() if file.created_at else None,
            "updated_at": file.updated_at.isoformat() if file.updated_at else None,
        },
        indent=2,
    )

    return ToolResult(success=True, data=data)


async def _execute_read_file_content(ctx: ToolContext, args: dict) -> ToolResult:
    """Read the text content of a file.

    Supports all extractable formats: PDF, DOCX, XLSX, PPTX, HTML, RTF,
    CSV, plain text, code files, JSON, XML, etc.

    Prefers pre-extracted text from the worker pipeline when available.
    Falls back to on-demand extraction via the shared extraction module.
    """
    from uniffy.domains.files.operations import FileOperations

    file_id_str = args.get("file_id", "")
    if not file_id_str:
        return ToolResult(success=False, data="", error="file_id is required")

    try:
        file_id = UUID(file_id_str)
    except ValueError:
        return ToolResult(success=False, data="", error=f"Invalid file_id: {file_id_str}")

    max_chars = min(args.get("max_length", _DEFAULT_MAX_CHARS), _DEFAULT_MAX_CHARS)

    ops = FileOperations(ctx.session)
    file = await ops.get_by_id(ctx.user_id, ctx.organization_id, file_id)

    mime = file.mime_type or ""

    # Try pre-extracted text first (from worker pipeline)
    if file.media_info and file.media_info.extracted_text:
        text = file.media_info.extracted_text
        if len(text) > max_chars:
            text = text[:max_chars] + f"\n\n[Truncated at {max_chars} characters]"

        page_info = ""
        if file.media_info.page_count:
            page_info = f" ({file.media_info.page_count} pages)"

        return ToolResult(
            success=True,
            data=f"Content of [[[{file.filename}|{file.urn}]]]{page_info}:\n\n{text}",
        )

    # Fall back to on-demand extraction
    if can_extract(mime):
        from uniffy.core.storage import get_s3_client

        s3 = get_s3_client()
        data = await s3.download_bytes(file.storage_key)

        if len(data) > _MAX_DOWNLOAD_BYTES:
            data = data[:_MAX_DOWNLOAD_BYTES]

        try:
            result = extract_text(data, mime, max_chars=max_chars)
        except UnsupportedFormatError:
            return ToolResult(
                success=False,
                data="",
                error=f"Cannot read content of '{file.filename}' (type: {mime}).",
            )

        text = result.text
        if len(text) > max_chars:
            text = text[:max_chars] + f"\n\n[Truncated at {max_chars} characters]"

        page_info = ""
        if result.page_count:
            page_info = f" ({result.page_count} pages)"

        return ToolResult(
            success=True,
            data=f"Content of [[[{file.filename}|{file.urn}]]]{page_info}:\n\n{text}",
        )

    return ToolResult(
        success=False,
        data="",
        error=(
            f"Cannot read content of '{file.filename}' (type: {mime}). "
            "Only text-based files, PDFs, and office documents are supported for content reading."
        ),
    )


async def _execute_update_file(ctx: ToolContext, args: dict) -> ToolResult:
    """Update file metadata."""
    from uniffy.domains.files.operations import FileOperations

    file_id_str = args.get("file_id", "")
    if not file_id_str:
        return ToolResult(success=False, data="", error="file_id is required")

    try:
        file_id = UUID(file_id_str)
    except ValueError:
        return ToolResult(success=False, data="", error=f"Invalid file_id: {file_id_str}")

    filename = args.get("filename")
    tags = args.get("tags")
    description = args.get("description")

    if filename is None and tags is None and description is None:
        return ToolResult(
            success=False,
            data="",
            error="At least one of filename, tags, or description must be provided",
        )

    ops = FileOperations(ctx.session)
    file = await ops.update(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        file_id=file_id,
        filename=filename,
        tags=tags,
        description=description,
    )

    urn = f"urn:uniffy:content:FILE:{file.id}"
    return ToolResult(
        success=True,
        data=f"File updated successfully: [[[{file.filename}|{urn}]]]",
    )


async def _execute_delete_file(ctx: ToolContext, args: dict) -> ToolResult:
    """Soft-delete a file (moves to trash)."""
    from uniffy.domains.files.operations import FileOperations

    file_id_str = args.get("file_id", "")
    if not file_id_str:
        return ToolResult(success=False, data="", error="file_id is required")

    try:
        file_id = UUID(file_id_str)
    except ValueError:
        return ToolResult(success=False, data="", error=f"Invalid file_id: {file_id_str}")

    ops = FileOperations(ctx.session)
    await ops.delete(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        file_id=file_id,
        permanent=False,
    )

    return ToolResult(success=True, data="File moved to trash successfully.")


# Tool definitions

search_files = ToolDefinition(
    name="files.search_files",
    description=(
        "Search the user's files by keyword. Returns matching file names, types, and sizes."
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
    executor=_execute_search_files,
    read_only=True,
)

list_files = ToolDefinition(
    name="files.list_files",
    description=(
        "List the user's files. Use this to browse files without a specific search "
        "query. Optionally filter by folder."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "folder_id": {
                "type": "string",
                "description": "UUID of a folder to list files from. Omit for root level.",
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
    executor=_execute_list_files,
    read_only=True,
)

get_file_info = ToolDefinition(
    name="files.get_file_info",
    description=(
        "Get detailed metadata about a specific file including name, type, size, "
        "tags, and description."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "file_id": {
                "type": "string",
                "description": "UUID of the file.",
            },
        },
        "required": ["file_id"],
    },
    executor=_execute_get_file_info,
    read_only=True,
)

read_file_content = ToolDefinition(
    name="files.read_file_content",
    description=(
        "Read the text content of a file. Supports PDF, Word (DOCX), Excel (XLSX), "
        "PowerPoint (PPTX), HTML, RTF, CSV, plain text, code files, JSON, XML, "
        "and other text-based formats. Returns the extracted text. "
        "Does not support binary files like images or videos."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "file_id": {
                "type": "string",
                "description": "UUID of the file to read.",
            },
            "max_length": {
                "type": "integer",
                "description": (
                    "Maximum characters to return (default 50000). Use a smaller "
                    "value for large files when you only need a preview."
                ),
            },
        },
        "required": ["file_id"],
    },
    executor=_execute_read_file_content,
    read_only=True,
    timeout_seconds=30,
)

update_file = ToolDefinition(
    name="files.update_file",
    description="Update a file's metadata such as filename, tags, or description.",
    parameter_schema={
        "type": "object",
        "properties": {
            "file_id": {
                "type": "string",
                "description": "UUID of the file to update.",
            },
            "filename": {
                "type": "string",
                "description": "New filename.",
            },
            "tags": {
                "type": "array",
                "items": {"type": "string"},
                "description": "New tags for the file.",
            },
            "description": {
                "type": "string",
                "description": "New description for the file.",
            },
        },
        "required": ["file_id"],
    },
    executor=_execute_update_file,
)

delete_file = ToolDefinition(
    name="files.delete_file",
    description=(
        "Delete a file by moving it to trash. This is a soft delete that can be "
        "undone by the user from the trash."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "file_id": {
                "type": "string",
                "description": "UUID of the file to delete.",
            },
        },
        "required": ["file_id"],
    },
    executor=_execute_delete_file,
    destructive=True,
)

FILES_TOOLS: list[ToolDefinition] = [
    search_files,
    list_files,
    get_file_info,
    read_file_content,
    update_file,
    delete_file,
]
