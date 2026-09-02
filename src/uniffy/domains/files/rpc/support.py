"""Shared conversion helpers for files RPC handlers."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions import resolve_effective_policy
from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.models.files.file import File
from uniffy.core.models.files.folder import Folder
from uniffy.core.models.tags.tag import Tag
from uniffy.core.types import AccessMode, ContentRole, ContentType
from uniffy.domains.tags.reader import TagReader


def _file_urn(file_id: str | UUID) -> str:
    return f"urn:uniffy:content:FILE:{file_id}"


def _parse_tag_id_list(values: list[str]) -> list[UUID]:
    parsed: list[UUID] = []
    for value in values:
        try:
            parsed.append(UUID(value))
        except ValueError as exc:
            raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid tag_id: {exc}") from exc
    return parsed


async def _hydrate_file_tags(
    session: AsyncSession,
    organization_id: UUID,
    files: list[File],
) -> dict[str, list[Tag]]:
    if not files:
        return {}
    return await TagReader(session).get_for_urns(
        organization_id=organization_id,
        content_urns=[_file_urn(file.id) for file in files],
    )


async def _resolve_file_effective_policy(
    session: AsyncSession,
    organization_id: UUID,
    file: File,
    checker: PermissionChecker | None = None,
) -> tuple[AccessMode, ContentRole | None]:
    permission_checker = checker or PermissionChecker(session)
    default_mode, default_baseline = await permission_checker.get_org_defaults(
        organization_id,
        ContentType.FILE,
    )
    return resolve_effective_policy(
        file.access_mode,
        file.baseline_role,
        default_mode,
        default_baseline,
    )


async def _resolve_folder_effective_policy(
    session: AsyncSession,
    organization_id: UUID,
    folder: Folder,
    checker: PermissionChecker | None = None,
) -> tuple[AccessMode, ContentRole | None]:
    permission_checker = checker or PermissionChecker(session)
    default_mode, default_baseline = await permission_checker.get_org_defaults(
        organization_id,
        ContentType.FOLDER,
    )
    return resolve_effective_policy(
        folder.access_mode,
        folder.baseline_role,
        default_mode,
        default_baseline,
    )
