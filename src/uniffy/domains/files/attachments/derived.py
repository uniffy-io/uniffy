"""Stage derived file policies and repair their search projections after commit."""

from uuid import UUID

from sqlalchemy import Select, cast, func, literal, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from uniffy.core.content.mentions import publish_mention_state
from uniffy.core.models.files.attachment import Attachment
from uniffy.core.models.files.file import File
from uniffy.core.models.files.folder import Folder
from uniffy.core.search import SearchIndexer
from uniffy.core.types import AccessMode, ContentRole, ContentType
from uniffy.domains.files.attachments.folders import (
    ATTACHMENTS_FOLDER_NAME,
    get_or_create_org_attachments_folder,
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
    if access_mode == AccessMode.OPEN_TO_ORG:
        folder = await get_or_create_org_attachments_folder(session, organization_id)
        target_folder = folder.id
    else:
        owners = (
            select(File.owner_id)
            .where(
                File.organization_id == organization_id,
                File.id.in_(file_ids),
            )
            .distinct()
            .subquery()
        )
        await session.execute(
            pg_insert(Folder)
            .from_select(
                [
                    "id",
                    "organization_id",
                    "owner_id",
                    "name",
                    "access_mode",
                    "is_system",
                    "is_org_attachments",
                    "is_deleted",
                    "created_at",
                    "updated_at",
                ],
                select(
                    func.uuidv7(),
                    literal(organization_id),
                    owners.c.owner_id,
                    literal(ATTACHMENTS_FOLDER_NAME),
                    cast(literal(AccessMode.OWNER_ONLY.value), Folder.__table__.c.access_mode.type),
                    literal(True),
                    literal(False),
                    literal(False),
                    func.now(),
                    func.now(),
                ),
                include_defaults=False,
            )
            .on_conflict_do_nothing()
        )
        target_folder = (
            select(Folder.id)
            .where(
                Folder.organization_id == organization_id,
                Folder.owner_id == File.owner_id,
                Folder.name == ATTACHMENTS_FOLDER_NAME,
                Folder.is_system.is_(True),
                Folder.is_deleted.is_(False),
                Folder.parent_id.is_(None),
            )
            .scalar_subquery()
        )
    await session.execute(
        update(File)
        .where(
            File.organization_id == organization_id,
            File.id.in_(file_ids),
        )
        .values(
            access_mode=access_mode,
            baseline_role=baseline_role if access_mode == AccessMode.OPEN_TO_ORG else None,
            folder_id=target_folder,
        )
        .execution_options(synchronize_session=False)
    )


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
