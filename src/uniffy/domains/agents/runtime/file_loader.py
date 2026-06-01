"""Shared loaders for attachment files passed into the agent runtime.

The runtime accepts user-attached files (images, PDFs, extractable text)
alongside a chat-style message. Two callers reach for these helpers:

- The RPC handler path (``runtime/handlers.py``) translates the proto
  ``file_ids`` list into a permission-checked ``FileContext`` list before
  enqueueing the egress worker.
- The chat-trigger bridge (``chat_integration/operations.py``) resolves
  the trigger chat message's attachment rows to the same ``FileContext``
  shape so the agent sees the bytes, not just the mention chip text.

Both paths run ``FileOperations.get_by_id(user_id, ...)`` so permissions
are evaluated as the human user the agent is acting for.
"""

from dataclasses import dataclass
from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.domains.files.operations import FileOperations

logger = logger.bind(component="agents.runtime.file_loader")


@dataclass
class FileContext:
    """Context for a file loaded from the database for LLM processing.

    Attributes
    ----------
    file_id : str
        UUID of the file.
    media_type : str
        MIME type of the file.
    filename : str
        Display filename.
    storage_key : str
        S3 storage key for downloading.
    extracted_text : str | None
        Pre-extracted text content (from worker pipeline). Readers gate on
        truthiness so ``None`` and ``""`` are interchangeable; the handler
        normalises empty/missing extraction output to ``None`` at load time.
    extraction_status : str
        Current extraction status.

    """

    file_id: str
    media_type: str
    filename: str
    storage_key: str
    extracted_text: str | None
    extraction_status: str


async def _load_files(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
    file_ids: list[str],
) -> list[FileContext]:
    """Load files from the database with full permission checks.

    Each id is resolved through :class:`FileOperations.get_by_id`, which
    runs the canonical view check. The returned :class:`FileContext`
    list is what the worker rebuilds from the JSON payload.
    """
    ops = FileOperations(session)
    files: list[FileContext] = []
    for fid in file_ids:
        file = await ops.get_by_id(user_id, organization_id, UUID(fid))
        files.append(
            FileContext(
                file_id=str(file.id),
                media_type=file.mime_type or "",
                filename=file.filename,
                storage_key=file.storage_key,
                extracted_text=(
                    file.media_info.extracted_text
                    if file.media_info and file.media_info.extracted_text
                    else None
                ),
                extraction_status=(
                    file.extraction_status.value
                    if hasattr(file.extraction_status, "value")
                    else str(file.extraction_status)
                ),
            )
        )
    return files


async def _safe_load_files(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
    file_ids: list[str],
) -> list[FileContext]:
    """Load files one at a time, skipping any the user can't view.

    Use this from chat-trigger paths where one revoked-after-the-fact
    attachment must not abort the agent reply. The strict
    :func:`_load_files` helper raises ``PermissionDeniedError`` on the
    first miss, which is the right shape for the proto handlers (the
    user just sent the file_ids; a failure is a programming error) but
    not for chat-triggered loads where the trigger message may have
    been authored before a permission was tightened.
    """
    if not file_ids:
        return []
    files: list[FileContext] = []
    for fid in file_ids:
        try:
            loaded = await _load_files(session, user_id, organization_id, [fid])
        except (PermissionDeniedError, NotFoundError) as exc:
            logger.warning(
                "Skipping inaccessible attachment for agent invocation",
                file_id=fid,
                user_id=str(user_id),
                error=type(exc).__name__,
            )
            continue
        files.extend(loaded)
    return files


def _file_contexts_to_payload(
    files: list[FileContext] | None,
) -> list[dict[str, Any]] | None:
    """Serialise a :class:`FileContext` list into the worker's JSON shape."""
    if not files:
        return None
    return [
        {
            "file_id": f.file_id,
            "media_type": f.media_type,
            "filename": f.filename,
            "storage_key": f.storage_key,
            "extracted_text": f.extracted_text,
            "extraction_status": f.extraction_status,
        }
        for f in files
    ]
