"""Stage derived file policies and repair their search projections after commit."""

from uuid import UUID

from sqlalchemy import Select, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from uniffy.core.content.mentions import publish_mention_state
from uniffy.core.models.files.attachment import Attachment
from uniffy.core.models.files.file import File
from uniffy.core.search import SearchIndexer
from uniffy.core.types import AccessMode, ContentRole, ContentType
from uniffy.domains.files.attachments.folders import (
    get_or_create_org_attachments_folder,
    stage_personal_attachments_folder,
)
from uniffy.domains.files.search import FileSearchOperations

_PROJECTION_BATCH = 250


def _attached_ids(organization_id: UUID, content_type: ContentType, content_ids: Select) -> Select:
    return select(Attachment.file_id).where(
        Attachment.organization_id == organization_id,
        Attachment.content_type == content_type,
        Attachment.content_id.in_(content_ids),
    )


async def stage_attachment_parent_policy(
    session: AsyncSession,
    *,
    organization_id: UUID,
    content_type: ContentType,
    content_ids: Select,
    access_mode: AccessMode,
    baseline_role: ContentRole | None,
) -> None:
    """The parent owner holds its policy lock until this transaction commits."""
    file_ids = _attached_ids(organization_id, content_type, content_ids)
    if (await session.execute(file_ids.limit(1))).first() is None:
        return
    # The same folder answer AttachFile gives: one org folder for an org-wide
    # parent, otherwise each attacher's own protected folder.
    targets: dict[UUID | None, UUID] = {}
    if access_mode == AccessMode.OPEN_TO_ORG:
        folder = await get_or_create_org_attachments_folder(session, organization_id)
        targets[None] = folder.id
    else:
        owners = (
            (
                await session.execute(
                    select(File.owner_id)
                    .where(File.organization_id == organization_id, File.id.in_(file_ids))
                    .distinct()
                )
            )
            .scalars()
            .all()
        )
        for owner_id in owners:
            folder = await stage_personal_attachments_folder(session, owner_id, organization_id)
            targets[owner_id] = folder.id
    for owner_id, folder_id in targets.items():
        statement = (
            update(File)
            .where(File.organization_id == organization_id, File.id.in_(file_ids))
            .values(
                access_mode=AccessMode.OWNER_ONLY,
                baseline_role=None,
                folder_id=folder_id,
            )
        )
        if owner_id is not None:
            statement = statement.where(File.owner_id == owner_id)
        await session.execute(statement.execution_options(synchronize_session=False))


async def refresh_attachment_parent_search(
    session: AsyncSession,
    search_indexer: SearchIndexer,
    *,
    organization_id: UUID,
    content_type: ContentType,
    content_ids: Select,
) -> int:
    files = FileSearchOperations(session, search_indexer)
    after: UUID | None = None
    count = 0
    while True:
        query = (
            select(File)
            .where(
                File.organization_id == organization_id,
                File.id.in_(_attached_ids(organization_id, content_type, content_ids)),
                File.is_deleted.is_(False),
            )
            .options(selectinload(File.media_info))
            .order_by(File.id)
            .limit(_PROJECTION_BATCH)
        )
        if after is not None:
            query = query.where(File.id > after)
        rows = (
            (await session.execute(query.execution_options(populate_existing=True))).scalars().all()
        )
        if not rows:
            return count
        for file in rows:
            metadata = await files._index_for_search(file)
            await publish_mention_state(
                organization_id=organization_id,
                urn=file.urn,
                changes={"title": file.filename, **(metadata or {})},
            )
        # Wait for the ACL write before the parent recovery fact can be removed.
        await search_indexer.update_access_policy_bulk(
            organization_id,
            [
                (file.urn, file.access_mode or AccessMode.OWNER_ONLY, file.baseline_role)
                for file in rows
            ],
        )
        count += len(rows)
        after = rows[-1].id
