"""Seed workspace files through the real multipart upload path."""

from __future__ import annotations

from uuid import UUID

from loguru import logger
from sqlalchemy import select

from uniffy.core.models.files.file import File
from uniffy.core.models.files.folder import Folder
from uniffy.core.storage import get_s3_client
from uniffy.core.types import AccessMode, ContentRole
from uniffy.domains.files.operations import FileOperations, FolderOperations
from uniffy.scripts.demo_company.context import DemoContext, DomainResult, tag_ids_for
from uniffy.scripts.demo_company.loader import FileSpec
from uniffy.scripts.demo_company.mentions import FILE, MentionRegistry

logger = logger.bind(component="scripts.demo_company.files")


async def seed_files(
    ctx: DemoContext,
    files: tuple[FileSpec, ...],
    root_folder: str,
    tag_ids: dict[str, UUID],
    registry: MentionRegistry,
) -> DomainResult:
    result = DomainResult()
    if not files:
        return result

    folder_ops = FolderOperations(ctx.session)
    file_ops = FileOperations(ctx.session)
    s3 = get_s3_client()
    await s3.ensure_bucket_exists()

    root_id = await _ensure_folder(ctx, folder_ops, root_folder, None, result)
    folder_ids: dict[str, UUID | None] = {}

    for spec in files:
        if spec.folder not in folder_ids:
            folder_ids[spec.folder] = await _ensure_folder(
                ctx, folder_ops, spec.folder, root_id, result
            )
        folder_id = folder_ids[spec.folder]
        mention_key = f"{spec.folder}/{spec.filename}"

        existing_id = await _find_file_id(ctx, spec.filename, folder_id)
        if existing_id is not None:
            registry.register(FILE, mention_key, existing_id)
            result.skipped += 1
            continue

        if ctx.dry_run:
            logger.info(f"[dry-run] file {spec.folder}/{spec.filename} ({len(spec.data)} bytes)")
            result.created += 1
            continue

        upload = await file_ops.initiate_upload(
            user_id=ctx.actor_id,
            organization_id=ctx.organization_id,
            filename=spec.filename,
            mime_type=spec.mime_type,
            total_size=len(spec.data),
            folder_id=folder_id,
            access_mode=AccessMode.OPEN_TO_ORG,
            baseline_role=ContentRole.VIEWER,
        )

        # Demo payloads are far below the 5MB multipart minimum, so one part
        # per file is the whole upload.
        etag = await s3.upload_part(
            key=upload.storage_key,
            upload_id=upload.s3_upload_id,
            part_number=1,
            data=spec.data,
        )
        await file_ops.record_chunk_completed(
            upload_id=upload.id,
            part_number=1,
            etag=etag,
            size=len(spec.data),
        )
        file = await file_ops.complete_upload(
            upload_id=upload.id,
            user_id=ctx.actor_id,
            tag_ids=tag_ids_for(tag_ids, spec.tags) or None,
        )

        if spec.description:
            await file_ops.update(
                user_id=ctx.actor_id,
                organization_id=ctx.organization_id,
                file_id=file.id,
                description=spec.description,
            )

        registry.register(FILE, mention_key, file.id)
        result.created += 1
        logger.info(f"Uploaded {spec.folder}/{spec.filename}")

    return result


async def _ensure_folder(
    ctx: DemoContext,
    ops: FolderOperations,
    name: str,
    parent_id: UUID | None,
    result: DomainResult,
) -> UUID | None:
    query = select(Folder).where(
        Folder.organization_id == ctx.organization_id,
        Folder.name == name,
        Folder.is_deleted == False,  # noqa: E712
    )
    query = query.where(Folder.parent_id == parent_id) if parent_id else query.where(
        Folder.parent_id.is_(None)
    )

    existing = (await ctx.session.execute(query)).scalars().first()
    if existing is not None:
        return existing.id

    if ctx.dry_run:
        logger.info(f"[dry-run] file folder {name!r}")
        result.created += 1
        return None

    folder = await ops.create(
        user_id=ctx.actor_id,
        organization_id=ctx.organization_id,
        name=name,
        parent_id=parent_id,
        access_mode=AccessMode.OPEN_TO_ORG,
        baseline_role=ContentRole.EDITOR,
    )
    result.created += 1
    logger.info(f"Created file folder {name!r}")
    return folder.id


async def _find_file_id(ctx: DemoContext, filename: str, folder_id: UUID | None) -> UUID | None:
    query = select(File.id).where(
        File.organization_id == ctx.organization_id,
        File.filename == filename,
        File.is_deleted == False,  # noqa: E712
    )
    query = query.where(File.folder_id == folder_id) if folder_id else query.where(
        File.folder_id.is_(None)
    )
    return (await ctx.session.execute(query)).scalars().first()
