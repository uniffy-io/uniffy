"""Keep attachment-file policy aligned with its parent content."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.files.attachment import Attachment
from uniffy.core.models.files.file import File
from uniffy.core.types import AccessMode, ContentRole, ContentType
from uniffy.domains.files.attachments.folders import (
    get_or_create_org_attachments_folder,
    get_or_create_personal_attachments_folder,
)
from uniffy.domains.files.search import FileSearchOperations


async def migrate_attachment_policy(
    session: AsyncSession,
    organization_id: UUID,
    affected: list[tuple[ContentType, UUID]],
    effective_mode: AccessMode,
    effective_baseline: ContentRole | None,
    owner_id: UUID,
) -> None:
    if effective_mode == AccessMode.OPEN_TO_ORG:
        org_folder = await get_or_create_org_attachments_folder(session, organization_id)
        target_folder_id = org_folder.id
        target_mode = AccessMode.OPEN_TO_ORG
        target_baseline = effective_baseline or ContentRole.EDITOR
    else:
        target_folder_id = None
        target_mode = AccessMode.OWNER_ONLY
        target_baseline = None

    for content_type, content_id in affected:
        attachments = (
            (
                await session.execute(
                    select(Attachment).where(
                        Attachment.organization_id == organization_id,
                        Attachment.content_type == content_type,
                        Attachment.content_id == content_id,
                    )
                )
            )
            .scalars()
            .all()
        )
        for attachment in attachments:
            file_row = (
                await session.execute(select(File).where(File.id == attachment.file_id))
            ).scalar_one_or_none()
            if file_row is None:
                continue

            if effective_mode == AccessMode.OPEN_TO_ORG:
                file_row.folder_id = target_folder_id
            else:
                user_folder = await get_or_create_personal_attachments_folder(
                    session,
                    attachment.attached_by_user_id or owner_id,
                    organization_id,
                )
                file_row.folder_id = user_folder.id
            file_row.access_mode = target_mode
            file_row.baseline_role = target_baseline
            await session.flush()
            await FileSearchOperations(session)._index_for_search(
                model=file_row,
                skip_member_lookup=True,
            )
