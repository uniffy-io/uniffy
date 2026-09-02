"""Shared notes RPC parsing and policy hydration."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions import resolve_effective_policy
from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.errors import (
    ConflictError,
    NotFoundError,
    PermissionDeniedError,
    ValidationError,
)
from uniffy.core.json_codec import loads
from uniffy.core.models.notes.note import Note
from uniffy.core.types import ContentRole, ContentType

logger = logger.bind(component="notes.rpc.support")


async def resolve_user_role(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
    note: Note,
    checker: PermissionChecker | None = None,
) -> ContentRole | None:
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


async def resolve_note_policy(
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


def parse_uuid(value: str, field: str) -> UUID:
    try:
        return UUID(value)
    except ValueError as exc:
        raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid {field}: {exc}") from exc


def parse_tag_ids(values: list[str]) -> list[UUID]:
    return [parse_uuid(value, "tag_id") for value in values]


def parse_canvas_content(content: str | None) -> dict | None:
    if not content:
        return None
    try:
        parsed = loads(content)
    except ValueError, TypeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def map_domain_error(operation: str, exc: Exception) -> ConnectError:
    if isinstance(exc, NotFoundError):
        return ConnectError(Code.NOT_FOUND, "Note not found")
    if isinstance(exc, ValidationError):
        return ConnectError(Code.INVALID_ARGUMENT, str(exc))
    if isinstance(exc, PermissionDeniedError):
        return ConnectError(Code.PERMISSION_DENIED, str(exc) or "Access denied")
    if isinstance(exc, ConflictError):
        return ConnectError(Code.ABORTED, str(exc))
    logger.exception("Notes RPC failed", operation=operation)
    return ConnectError(Code.INTERNAL, "Internal server error")
