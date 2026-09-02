"""Content-loader registration for files and folders."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.content.registry import register_content_loader
from uniffy.core.models.files.file import File
from uniffy.core.models.files.folder import Folder
from uniffy.core.types import ContentType

_registered = False


async def _load_file(
    session: AsyncSession,
    organization_id: UUID,
    content_id: UUID,
) -> File | None:
    result = await session.execute(
        select(File).where(
            File.id == content_id,
            File.organization_id == organization_id,
        )
    )
    return result.scalar_one_or_none()


async def _load_folder(
    session: AsyncSession,
    organization_id: UUID,
    content_id: UUID,
) -> Folder | None:
    result = await session.execute(
        select(Folder).where(
            Folder.id == content_id,
            Folder.organization_id == organization_id,
        )
    )
    return result.scalar_one_or_none()


def register_file_content() -> None:
    global _registered
    if _registered:
        return
    register_content_loader(ContentType.FILE, _load_file)
    register_content_loader(ContentType.FOLDER, _load_folder)
    _registered = True
