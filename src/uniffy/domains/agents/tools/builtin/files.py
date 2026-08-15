"""Built-in file tools for agents."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select

from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.auth.permissions.queries import ContentAccessQuery
from uniffy.core.content.references import sanitize_mention_label
from uniffy.core.errors import PermissionDeniedError
from uniffy.core.extraction import UnsupportedFormatError, can_extract, extract_text
from uniffy.core.json_codec import dumps_str
from uniffy.core.models.files.folder import Folder
from uniffy.core.types import ContentType
from uniffy.domains.agents.tools.builtin.args import (
    MAX_PAGE,
    clamp_int,
    clamp_page,
    parse_uuid,
    parse_uuid_list,
)
from uniffy.domains.agents.tools.builtin.content_space import (
    creation_space_schema,
    parse_creation_space,
    resolve_parent_access_mode,
    space_for_access_mode,
)
from uniffy.domains.agents.tools.definitions import ToolContext, ToolDefinition, ToolResult
from uniffy.domains.tags import TagOperations

# Maximum bytes to download for on-demand extraction (10 MB).
_MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024

# Default character limit returned to the LLM.
_DEFAULT_MAX_CHARS = 50_000

# Folders and files are separate rows with separate URN types, so a listing has
# to say which one it returned or the model treats a folder as a readable file.
_ROOT_VALUES = {"root", "", "none", "null"}

_FOLDER_ARG_DESC = (
    "UUID of a folder, or 'root' for the top level. Folder ids come from "
    "files.list_folders - a file id is not a folder id."
)


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


def _folder_urn(folder_id: UUID | str) -> str:
    return f"urn:uniffy:content:FOLDER:{folder_id}"


async def _fetch_folder_names(ctx: ToolContext, ids: set[UUID]) -> dict[UUID, str]:
    """Folder names for a listing, restricted to folders the caller can view.

    A file shared out of a private folder must not carry that folder's name
    with it; callers render a missing id as "folder".
    """
    if not ids:
        return {}
    access = ContentAccessQuery(ctx.session)
    result = await ctx.session.execute(
        select(Folder.id, Folder.name).where(
            Folder.id.in_(ids),
            Folder.organization_id == ctx.organization_id,
            await access.build_accessible_filter(
                user_id=ctx.user_id,
                organization_id=ctx.organization_id,
                content_type=ContentType.FOLDER,
                content_id_column=Folder.id,
                owner_id_column=Folder.owner_id,
                access_mode_column=Folder.access_mode,
                baseline_role_column=Folder.baseline_role,
            ),
        )
    )
    return {row[0]: row[1] for row in result.all()}


async def _resolve_folder_arg(ctx: ToolContext, raw: str) -> tuple[UUID | None, str | None]:
    """Resolve a folder argument to (folder_id, error); ``None`` means root.

    A write must land in a folder the user can already reach, and it must be a
    folder - a file id here would silently do nothing useful.
    """
    from uniffy.domains.files.operations import FolderOperations

    if raw.strip().lower() in _ROOT_VALUES:
        return None, None

    folder_id, err = parse_uuid(raw, "folder_id")
    if err:
        return None, err

    ops = FolderOperations(ctx.session)
    folder = await ops.get_by_id(folder_id, ctx.organization_id)  # type: ignore[arg-type]
    if not folder or folder.is_deleted:
        return None, f"No folder with id {raw}."
    try:
        await ops.require_view(ctx.user_id, ctx.organization_id, folder)
    except PermissionDeniedError:
        return None, f"No accessible folder with id {raw}."
    return folder_id, None


# Tool executors


async def _execute_search_files(ctx: ToolContext, args: dict) -> ToolResult:
    """Search files by keyword."""
    from uniffy.domains.search.operations import SearchOperations

    query = args.get("query", "")
    if not query:
        return ToolResult(success=False, data="", error="query is required")

    limit = clamp_int(args.get("limit", 10), 10, 1, 20)

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
    """List files, optionally scoped to one folder. Never returns folders."""
    from uniffy.domains.files.operations import FileOperations

    limit = clamp_int(args.get("limit", 20), 20, 1, 50)
    page = clamp_page(args.get("page", 1))

    raw_folder = args.get("folder_id")
    # "all" is the domain's cross-folder sentinel; None means root only, which
    # is why an omitted argument must not fall through as None.
    folder_id: UUID | str | None = "all"
    scope = "every folder"
    if raw_folder is not None:
        if str(raw_folder).strip().lower() in _ROOT_VALUES:
            folder_id = None
            scope = "the top level"
        else:
            resolved, err = await _resolve_folder_arg(ctx, str(raw_folder))
            if err:
                return ToolResult(success=False, data="", error=err)
            folder_id = resolved
            scope = "this folder"

    ops = FileOperations(ctx.session)
    files, total = await ops.list_files(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        folder_id=folder_id,
        page=page,
        page_size=limit,
    )

    if not files:
        return ToolResult(
            success=True,
            data=f"No files in {scope}. Folders are listed by files.list_folders.",
        )

    folder_names = await _fetch_folder_names(ctx, {f.folder_id for f in files if f.folder_id})

    lines = [f"Found {total} files in {scope} (showing {len(files)}, page {page}):"]
    for f in files:
        size = _format_size(f.size_bytes)
        mime = f.mime_type or "unknown"
        urn = f"urn:uniffy:content:FILE:{f.id}"
        location = f" [in {folder_names.get(f.folder_id, 'unknown folder')}]" if f.folder_id else ""
        lines.append(f"- [[[{f.filename}|{urn}]]] ({mime}, {size}){location}")

    hint = _paging_hint(total, len(files), page, "files", "files.search_files or a folder_id")
    if hint:
        lines.append(hint)

    return ToolResult(success=True, data="\n".join(lines))


async def _execute_list_folders(ctx: ToolContext, args: dict) -> ToolResult:
    """List folders - the containers, not the files inside them."""
    from uniffy.domains.files.operations import FolderOperations

    limit = clamp_int(args.get("limit", 50), 50, 1, 100)
    page = clamp_page(args.get("page", 1))

    raw_parent = args.get("parent_id")
    parent_id: UUID | None = None
    scope = "the top level"
    if raw_parent is not None and str(raw_parent).strip().lower() not in _ROOT_VALUES:
        parent_id, err = await _resolve_folder_arg(ctx, str(raw_parent))
        if err:
            return ToolResult(success=False, data="", error=err)
        scope = "this folder"

    ops = FolderOperations(ctx.session)
    # One extra row is the cheapest way to know whether another page exists;
    # list_folders does not count, and counting a 50k-folder org per call would.
    folders = await ops.list_folders(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        parent_id=parent_id,
        limit=limit + 1,
        offset=(page - 1) * limit,
    )
    has_more = len(folders) > limit
    folders = folders[:limit]

    if not folders:
        return ToolResult(success=True, data=f"No folders in {scope}.")

    default_mode, _ = await PermissionChecker(ctx.session).get_org_defaults(
        ctx.organization_id,
        ContentType.FOLDER,
    )
    lines = [f"Found {len(folders)} folders in {scope} (page {page}):"]
    for f in folders:
        system = " [system]" if f.is_system else ""
        space = space_for_access_mode(
            f.access_mode,
            default_mode,
            owner_id=f.owner_id,
            current_user_id=ctx.user_id,
        )
        lines.append(
            f"- [[[{f.name}|{_folder_urn(f.id)}]]] (folder_id: {f.id}, space: {space}){system}"
        )

    if has_more:
        lines.append(f"More folders exist; ask for page {page + 1}.")
    lines.append("Pass a folder_id to files.list_files to see what is inside.")
    return ToolResult(success=True, data="\n".join(lines))


async def _execute_create_folder(ctx: ToolContext, args: dict) -> ToolResult:
    from uniffy.domains.files.operations import FolderOperations

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

    ops = FolderOperations(ctx.session)
    if parent_id is not None:
        parent = await ops.get_by_id(parent_id, ctx.organization_id)
        if parent is None:
            return ToolResult(success=False, data="", error="Folder is no longer available")
        access_mode, err = await resolve_parent_access_mode(
            ctx.session,
            ctx.organization_id,
            ContentType.FOLDER,
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
        name=name,
        parent_id=parent_id,
        access_mode=access_mode,
    )

    return ToolResult(
        success=True,
        data=(
            f"Folder created in {space_for_access_mode(access_mode, None).title()}: "
            f"[[[{folder.name}|{_folder_urn(folder.id)}]]] (folder_id: {folder.id})."
        ),
    )


async def _execute_move_file(ctx: ToolContext, args: dict) -> ToolResult:
    """Move a file into another folder."""
    from uniffy.domains.files.operations import FileOperations

    file_id_str = args.get("file_id", "")
    if not file_id_str:
        return ToolResult(success=False, data="", error="file_id is required")

    file_id, err = parse_uuid(file_id_str, "file_id")
    if err:
        return ToolResult(success=False, data="", error=err)

    raw_folder = args.get("folder_id")
    if raw_folder is None:
        return ToolResult(
            success=False,
            data="",
            error="folder_id is required ('root' moves the file to the top level)",
        )

    folder_id, err = await _resolve_folder_arg(ctx, str(raw_folder))
    if err:
        return ToolResult(success=False, data="", error=err)

    ops = FileOperations(ctx.session)
    file = await ops.move_file(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        file_id=file_id,  # type: ignore[arg-type]
        folder_id=folder_id,
    )

    destination = "the top level"
    if folder_id is not None:
        names = await _fetch_folder_names(ctx, {folder_id})
        destination = f"'{names.get(folder_id, 'folder')}'"

    urn = f"urn:uniffy:content:FILE:{file.id}"
    return ToolResult(
        success=True,
        data=f"Moved [[[{file.filename}|{urn}]]] to {destination}.",
    )


async def _execute_get_file_info(ctx: ToolContext, args: dict) -> ToolResult:
    """Get detailed metadata for a file."""
    from uniffy.domains.files.operations import FileOperations

    file_id_str = args.get("file_id", "")
    if not file_id_str:
        return ToolResult(success=False, data="", error="file_id is required")

    file_id, err = parse_uuid(file_id_str, "file_id")
    if err:
        return ToolResult(success=False, data="", error=err)

    ops = FileOperations(ctx.session)
    file = await ops.get_by_id(ctx.user_id, ctx.organization_id, file_id)  # type: ignore[arg-type]

    urn = f"urn:uniffy:content:FILE:{file.id}"
    tag_ops = TagOperations(ctx.session)
    tags_by_urn = await tag_ops.get_for_urns(
        organization_id=ctx.organization_id,
        content_urns=[urn],
    )
    file_tag_slugs = [tag.slug for tag in tags_by_urn.get(urn, [])]
    folder_names = await _fetch_folder_names(ctx, {file.folder_id} if file.folder_id else set())

    data = dumps_str(
        {
            "id": str(file.id),
            "filename": file.filename,
            "original_filename": file.original_filename,
            "mime_type": file.mime_type,
            "size": _format_size(file.size_bytes),
            "size_bytes": file.size_bytes,
            "tags": file_tag_slugs,
            "folder_id": str(file.folder_id) if file.folder_id else None,
            "folder_name": folder_names.get(file.folder_id) if file.folder_id else None,
            "description": file.description,
            "access_mode": (file.access_mode.value if file.access_mode is not None else None),
            "baseline_role": (file.baseline_role.value if file.baseline_role is not None else None),
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

    file_id, err = parse_uuid(file_id_str, "file_id")
    if err:
        return ToolResult(success=False, data="", error=err)

    max_chars = min(args.get("max_length", _DEFAULT_MAX_CHARS), _DEFAULT_MAX_CHARS)

    ops = FileOperations(ctx.session)
    file = await ops.get_by_id(ctx.user_id, ctx.organization_id, file_id)  # type: ignore[arg-type]

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
            data=(
                f"Content of [[[{sanitize_mention_label(file.filename)}|{file.urn}]]]"
                f"{page_info}:\n\n{text}"
            ),
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
            data=(
                f"Content of [[[{sanitize_mention_label(file.filename)}|{file.urn}]]]"
                f"{page_info}:\n\n{text}"
            ),
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

    file_id, err = parse_uuid(file_id_str, "file_id")
    if err:
        return ToolResult(success=False, data="", error=err)

    filename = args.get("filename")
    description = args.get("description")

    tag_ids = None
    if isinstance(args.get("tag_ids"), list):
        tag_ids, tag_err = parse_uuid_list(args["tag_ids"], "tag_ids")
        if tag_err:
            return ToolResult(success=False, data="", error=tag_err)

    if filename is None and tag_ids is None and description is None:
        return ToolResult(
            success=False,
            data="",
            error="At least one of filename, tag_ids, or description must be provided",
        )

    ops = FileOperations(ctx.session)
    file = await ops.update(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        file_id=file_id,  # type: ignore[arg-type]
        filename=filename,
        tag_ids=tag_ids,
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

    file_id, err = parse_uuid(file_id_str, "file_id")
    if err:
        return ToolResult(success=False, data="", error=err)

    ops = FileOperations(ctx.session)
    await ops.delete(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        file_id=file_id,  # type: ignore[arg-type]
        permanent=False,
    )

    return ToolResult(success=True, data="File moved to trash successfully.")


# Tool definitions

search_files = ToolDefinition(
    name="files.search_files",
    display_name="Search Files",
    group="Files",
    description=(
        "Search the user's files by keyword. Returns matching file names, types, and "
        "sizes. Folders are containers and are not returned here - use "
        "files.list_folders to find a folder."
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
    display_name="List Files",
    group="Files",
    description=(
        "List files - the documents, never the folders that hold them. Omit folder_id "
        "to list files from every folder, pass 'root' for the top level only, or a "
        "folder_id from files.list_folders to list one folder's files."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "folder_id": {
                "type": "string",
                "description": _FOLDER_ARG_DESC + " Omit to list files from everywhere.",
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

list_folders = ToolDefinition(
    name="files.list_folders",
    display_name="List Folders",
    group="Files",
    description=(
        "List folders. A folder holds files and other folders; it has no content of "
        "its own and cannot be read. Returns folder ids to pass to files.list_files, "
        "files.create_folder or files.move_file."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "parent_id": {
                "type": "string",
                "description": (
                    "UUID of a parent folder to list sub-folders of. Omit or pass "
                    "'root' for top-level folders."
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

create_folder = ToolDefinition(
    name="files.create_folder",
    display_name="Create Folder",
    group="Files",
    description=(
        "Create a folder to group files in. A folder holds files, it holds no content "
        "of its own - move files into it with files.move_file. Omit space for a Personal "
        "top-level folder; a chosen parent establishes the space for nested folders. "
        "Use organization only when explicitly requested."
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

move_file = ToolDefinition(
    name="files.move_file",
    display_name="Move File",
    group="Files",
    description=(
        "Move a file into another folder. Pass 'root' as folder_id to move it to the "
        "top level. Moving a file does not change who can see it."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "file_id": {
                "type": "string",
                "description": "UUID of the file to move.",
            },
            "folder_id": {
                "type": "string",
                "description": _FOLDER_ARG_DESC,
            },
        },
        "required": ["file_id", "folder_id"],
    },
    executor=_execute_move_file,
)

get_file_info = ToolDefinition(
    name="files.get_file_info",
    display_name="File Info",
    group="Files",
    description=(
        "Get detailed metadata about a specific file including name, type, size, "
        "tags, description, and the folder it sits in."
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
    display_name="Read File",
    group="Files",
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
    display_name="Edit File",
    group="Files",
    description=(
        "Update a file's metadata: filename, tags, or description. Use files.move_file "
        "to put it in a different folder."
    ),
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
            "tag_ids": {
                "type": "array",
                "items": {"type": "string"},
                "description": (
                    "Replacement set of unified-tag UUIDs for the file. Tag names are "
                    "not accepted; an empty list clears the file's manual tags."
                ),
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
    display_name="Delete File",
    group="Files",
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
    list_folders,
    get_file_info,
    read_file_content,
    create_folder,
    update_file,
    move_file,
    delete_file,
]
