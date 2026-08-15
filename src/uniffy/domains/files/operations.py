"""File and folder operations extending BaseContentOperations."""

import os
from datetime import UTC, datetime, timedelta
from uuid import UUID

from loguru import logger
from sqlalchemy import String, cast, func, or_, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.auth.permissions import (
    PermissionChecker,
    modes_at_least_as_open,
    resolve_access_policy,
    resolve_effective_policy,
    role_can_view,
)
from uniffy.core.auth.permissions.queries import ContentAccessQuery
from uniffy.core.content.base_operations import BaseContentOperations
from uniffy.core.content.cascade import propagate_rename
from uniffy.core.content.members import register_content_loader
from uniffy.core.converters.common_proto import content_type_to_proto
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.files.file import ExtractionStatus, File, TranscodeStatus
from uniffy.core.models.files.file_version import FileVersion
from uniffy.core.models.files.folder import Folder
from uniffy.core.models.files.multipart_part import MultipartPart
from uniffy.core.models.files.multipart_upload import MultipartUpload, UploadStatus
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.storage import get_s3_client
from uniffy.core.types import (
    AccessMode,
    ContentRole,
    ContentType,
    ParentSelection,
    SortOrder,
    SubjectType,
    generate_id,
)
from uniffy.core.valkey import publish_content_access_changed
from uniffy.core.valkey.mentions import publish_mention_state
from uniffy.domains.files.quota_operations import QuotaOperations
from uniffy.domains.files.version_policy import (
    resolve_version_policy,
    select_versions_to_prune,
)
from uniffy.domains.tags import TagAssignment, TagOperations
from uniffy.workers.utils.mime import get_jobs_for_mime_type, get_processable_mime_types

logger = logger.bind(component="files.operations")

MIN_CHUNK_SIZE = 5 * 1024 * 1024  # S3 minimum.
SMALL_CHUNK_SIZE = 5 * 1024 * 1024
MEDIUM_CHUNK_SIZE = 10 * 1024 * 1024
LARGE_CHUNK_SIZE = 25 * 1024 * 1024
XLARGE_CHUNK_SIZE = 50 * 1024 * 1024

THRESHOLD_MEDIUM = 50 * 1024 * 1024
THRESHOLD_LARGE = 500 * 1024 * 1024
THRESHOLD_XLARGE = 2 * 1024 * 1024 * 1024

DEFAULT_UPLOAD_EXPIRY_HOURS = int(os.getenv("UPLOAD_EXPIRY_HOURS", 24))

_MAX_FOLDER_DEPTH = 64


def _file_uploaded_audit_enabled() -> bool:
    # Default off; one row per upload swamps the audit table on storage-heavy deployments.
    return os.getenv("AUDIT_EVENTS_FILE_UPLOADED", "false").lower() in {
        "1",
        "true",
        "yes",
    }


def calculate_chunk_size(total_size: int) -> int:
    """Pick the chunk size that keeps part count reasonable for total_size."""
    if total_size >= THRESHOLD_XLARGE:
        return XLARGE_CHUNK_SIZE
    elif total_size >= THRESHOLD_LARGE:
        return LARGE_CHUNK_SIZE
    elif total_size >= THRESHOLD_MEDIUM:
        return MEDIUM_CHUNK_SIZE
    else:
        return SMALL_CHUNK_SIZE


class FileOperations(BaseContentOperations[File]):
    """File CRUD with permissions, search indexing, multipart upload, and S3 integration."""

    content_type = ContentType.FILE
    model_class = File

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session)
        self.s3 = get_s3_client()

    async def _resolve_role(
        self,
        user_id: UUID,
        organization_id: UUID,
        content: File,
    ) -> ContentRole | None:
        """File access, with a read-only fallback through an attachment's parent.

        An attachment file copy lives in the owner's private folder (OWNER_ONLY),
        but anyone who can view the content it is attached to must be able to read
        the bytes - the note editor fetches the image by id over the asset route.
        Deriving from the parent keeps that in sync both ways and revokes with the
        share; the grant is clamped to VIEWER since the file's lifecycle stays with
        the attachment (detach), not with direct file edits.
        """
        role = await super()._resolve_role(user_id, organization_id, content)
        if role is not None and role_can_view(role):
            return role

        from uniffy.domains.files.attachments.operations import AttachmentOperations

        attachment_ops = AttachmentOperations(self.session)
        if await attachment_ops.can_view_file_via_attachment(user_id, organization_id, content.id):
            return ContentRole.VIEWER
        return role

    def _build_search_keywords(self, model: File) -> str:
        # Tag slugs go through _get_search_tags_async; don't duplicate them into keywords.
        parts = [model.filename, model.original_filename]
        if model.description:
            parts.append(model.description)
        if model.mime_type:
            parts.append(model.mime_type)
        if model.media_info and model.media_info.extracted_text:
            parts.append(model.media_info.extracted_text)
        return " ".join(filter(None, parts))

    def _get_search_title(self, model: File) -> str:
        return model.filename

    def _get_url_path(self, model: File) -> str:
        return f"/files/{model.id}"

    def _get_search_description(self, model: File) -> str | None:
        """Description or a snippet of extracted text for mention previews."""
        if model.description:
            return model.description
        if model.media_info and model.media_info.extracted_text:
            return model.media_info.extracted_text[:300].strip() or None
        return None

    async def _get_search_tags_async(self, model: File) -> list[str] | None:
        tag_ops = TagOperations(self.session)
        urn = build_content_urn(self.content_type, model.id)
        bulk = await tag_ops.get_for_urns(
            organization_id=model.organization_id,
            content_urns=[urn],
        )
        slugs = sorted({tag.slug for tag in bulk.get(urn, [])})
        return slugs or None

    def _get_search_metadata(self, model: File) -> dict[str, str] | None:
        # folder_id lets folder delete cascade-remove search entries with one filter.
        meta: dict[str, str] = {}
        if model.mime_type:
            meta["mime_type"] = model.mime_type
        if model.folder_id:
            meta["folder_id"] = str(model.folder_id)
        return meta or None

    async def _get_search_metadata_async(self, model: File) -> dict[str, str] | None:
        """Append parent-folder name so mention chips can show a
        breadcrumb without a second round-trip.
        """
        meta = dict(self._get_search_metadata(model) or {})
        if model.folder_id:
            result = await self.session.execute(
                select(Folder.name).where(Folder.id == model.folder_id)
            )
            name = result.scalar_one_or_none()
            if name:
                meta["parent_label"] = name
        return meta or None

    async def _fetch_by_id(
        self,
        content_id: UUID,
        organization_id: UUID,
    ) -> File | None:
        """Override to eager-load media_info via selectinload."""
        result = await self.session.execute(
            select(File)
            .where(File.id == content_id)
            .where(File.organization_id == organization_id)
            .options(selectinload(File.media_info))
        )
        return result.scalar_one_or_none()

    async def initiate_upload(
        self,
        user_id: UUID,
        organization_id: UUID,
        filename: str,
        mime_type: str,
        total_size: int,
        folder_id: UUID | None = None,
        access_mode: AccessMode | None = None,
        baseline_role: ContentRole | None = None,
    ) -> MultipartUpload:
        """Start an S3 multipart upload and record the access policy for the resulting File.

        The destination folder must exist in this org and be viewable by the
        uploader, matching ``move_file``'s contract; ``complete_upload`` copies
        ``folder_id`` onto the File verbatim, so this is the only gate.
        """
        if folder_id is not None:
            folder_ops = FolderOperations(self.session)
            folder = await folder_ops.get_by_id(folder_id, organization_id)
            if not folder or folder.is_deleted:
                raise NotFoundError("Folder", folder_id)
            await folder_ops.require_view(user_id, organization_id, folder)

        access_mode, baseline_role = await self._resolve_access_policy(
            organization_id, access_mode, baseline_role
        )

        is_streaming = total_size <= 0

        if not is_streaming:
            quota_ops = QuotaOperations(self.session)
            quota_result = await quota_ops.check_quota(
                organization_id=organization_id,
                user_id=user_id,
                additional_bytes=total_size,
            )
            if not quota_result.allowed:
                raise ValidationError("quota", quota_result.reason)

        storage_key = f"{organization_id}/{user_id}/{generate_id()}/{filename}"

        s3_upload_id = await self.s3.create_multipart_upload(
            key=storage_key,
            content_type=mime_type,
        )

        if is_streaming:
            chunk_size = MIN_CHUNK_SIZE
            total_chunks = 0
            stored_total_size = 0
        else:
            chunk_size = calculate_chunk_size(total_size)
            total_chunks = (total_size + chunk_size - 1) // chunk_size
            stored_total_size = total_size

        upload = MultipartUpload(
            organization_id=organization_id,
            user_id=user_id,
            s3_upload_id=s3_upload_id,
            storage_key=storage_key,
            storage_bucket=self.s3.config.bucket_name,
            filename=filename,
            mime_type=mime_type,
            total_size=stored_total_size,
            total_chunks=total_chunks,
            chunk_size=chunk_size,
            folder_id=folder_id,
            access_mode=access_mode,
            baseline_role=baseline_role,
            status=UploadStatus.ACTIVE,
            expires_at=datetime.now(UTC) + timedelta(hours=DEFAULT_UPLOAD_EXPIRY_HOURS),
        )

        self.session.add(upload)
        await self.session.commit()
        await self.session.refresh(upload)

        return upload

    async def get_upload_status(self, upload_id: UUID) -> MultipartUpload | None:
        result = await self.session.execute(
            select(MultipartUpload).where(MultipartUpload.id == upload_id)
        )
        return result.scalar_one_or_none()

    async def record_chunk_completed(
        self,
        upload_id: UUID,
        part_number: int,
        etag: str,
        size: int,
    ) -> MultipartUpload:
        """Idempotent UPSERT into files_multipart_parts so concurrent backends don't lose parts."""
        upload = await self.get_upload_status(upload_id)
        if not upload:
            raise NotFoundError("Upload", upload_id)
        if upload.status != UploadStatus.ACTIVE:
            raise ValidationError(
                "upload_status",
                f"Upload is {upload.status.value}, not ACTIVE",
            )

        stmt = (
            pg_insert(MultipartPart)
            .values(
                upload_id=upload_id,
                part_number=part_number,
                etag=etag,
                size=size,
            )
            .on_conflict_do_update(
                index_elements=[MultipartPart.upload_id, MultipartPart.part_number],
                set_={"etag": etag, "size": size},
            )
        )
        await self.session.execute(stmt)
        await self.session.commit()
        return upload

    async def list_completed_part_numbers(self, upload_id: UUID) -> list[int]:
        """Sorted part numbers already uploaded; used by handlers and client resume flows."""
        result = await self.session.execute(
            select(MultipartPart.part_number)
            .where(MultipartPart.upload_id == upload_id)
            .order_by(MultipartPart.part_number)
        )
        return list(result.scalars().all())

    async def complete_upload(
        self,
        upload_id: UUID,
        user_id: UUID,
        group_ids: list[UUID] | None = None,
        tag_ids: list[UUID] | None = None,
        version_of_file_id: UUID | None = None,
    ) -> File:
        """Complete a multipart upload into a new File row + initial version, or,
        with ``version_of_file_id``, into a new version of that existing file.
        """
        upload_row = await self.session.execute(
            select(MultipartUpload).where(MultipartUpload.id == upload_id).with_for_update()
        )
        upload = upload_row.scalar_one_or_none()
        if not upload:
            raise NotFoundError("Upload", upload_id)
        if upload.status != UploadStatus.ACTIVE:
            raise ValidationError(
                "upload_status",
                f"Upload is {upload.status.value}, not ACTIVE",
            )
        if upload.user_id != user_id:
            raise PermissionDeniedError("complete", "upload")

        parts_result = await self.session.execute(
            select(
                MultipartPart.part_number,
                MultipartPart.etag,
                MultipartPart.size,
            )
            .where(MultipartPart.upload_id == upload_id)
            .order_by(MultipartPart.part_number)
        )
        part_rows = parts_result.all()
        if not part_rows:
            raise ValidationError(
                "upload_parts",
                "No chunks have been uploaded for this upload.",
            )

        actual_size = sum(row.size for row in part_rows)

        if upload.total_size and upload.total_size > 0 and actual_size > upload.total_size:
            await self.s3.abort_multipart_upload(
                key=upload.storage_key,
                upload_id=upload.s3_upload_id,
            )
            upload.status = UploadStatus.ABORTED
            upload.updated_at = datetime.now(UTC)
            await self.session.commit()
            raise ValidationError(
                "upload_size",
                "Uploaded bytes exceed declared total_size; multipart aborted.",
            )

        if upload.total_size == 0:
            quota_ops = QuotaOperations(self.session)
            quota_result = await quota_ops.check_quota(
                organization_id=upload.organization_id,
                user_id=upload.user_id,
                additional_bytes=actual_size,
            )
            if not quota_result.allowed:
                await self.s3.abort_multipart_upload(
                    key=upload.storage_key,
                    upload_id=upload.s3_upload_id,
                )
                upload.status = UploadStatus.ABORTED
                upload.updated_at = datetime.now(UTC)
                await self.session.commit()
                raise ValidationError("quota", quota_result.reason)

        await self.s3.complete_multipart_upload(
            key=upload.storage_key,
            upload_id=upload.s3_upload_id,
            parts=[{"PartNumber": row.part_number, "ETag": row.etag} for row in part_rows],
        )

        if version_of_file_id is not None:
            return await self._complete_upload_as_version(
                upload=upload,
                file_id=version_of_file_id,
                user_id=user_id,
                actual_size=actual_size,
            )

        extraction_status = self._get_initial_extraction_status(upload.mime_type)
        transcode_status = self._get_initial_transcode_status(upload.mime_type, upload.filename)

        file = File(
            organization_id=upload.organization_id,
            owner_id=upload.user_id,
            access_mode=upload.access_mode,
            baseline_role=upload.baseline_role,
            filename=upload.filename,
            original_filename=upload.filename,
            mime_type=upload.mime_type,
            size_bytes=actual_size,
            storage_key=upload.storage_key,
            storage_bucket=upload.storage_bucket,
            folder_id=upload.folder_id,
            extraction_status=extraction_status,
            transcode_status=transcode_status,
        )

        self.session.add(file)
        await self.session.flush()

        version = FileVersion(
            file_id=file.id,
            version_number=1,
            size_bytes=actual_size,
            storage_key=upload.storage_key,
            storage_bucket=upload.storage_bucket,
            uploaded_by=user_id,
        )
        self.session.add(version)
        await self.session.flush()

        file.current_version_id = version.id

        # Optional convenience; canonical path is MembersService.AddMember.
        if group_ids:
            for gid in group_ids:
                self.session.add(
                    ContentMember(
                        organization_id=upload.organization_id,
                        content_type=ContentType.FILE,
                        content_id=file.id,
                        subject_type=SubjectType.GROUP,
                        subject_id=gid,
                        role=ContentRole.VIEWER,
                        added_by_user_id=user_id,
                    )
                )

        upload.status = UploadStatus.COMPLETED
        upload.updated_at = datetime.now(UTC)

        if _file_uploaded_audit_enabled():
            await write_audit_event(
                self.session,
                organization_id=upload.organization_id,
                actor_user_id=user_id,
                action=Action.FILE_UPLOADED,
                resource_type=AuditResourceType.FILE,
                resource_id=file.id,
                details={
                    "filename": file.filename,
                    "mime_type": file.mime_type,
                    "size_bytes": actual_size,
                },
            )

        await self.session.commit()
        await self.session.refresh(file)

        if tag_ids:
            tag_ops = TagOperations(self.session)
            await tag_ops.replace_manual_tags(
                actor_id=user_id,
                organization_id=file.organization_id,
                content_urn=build_content_urn(self.content_type, file.id),
                tag_ids=tag_ids,
            )

        try:
            quota_ops = QuotaOperations(self.session)
            await quota_ops.increment_usage(
                organization_id=upload.organization_id,
                user_id=upload.user_id,
                bytes_delta=actual_size,
                file_count_delta=1,
            )
        except Exception:
            logger.opt(exception=True).warning(
                "Failed to increment storage usage", file_id=str(file.id)
            )

        await self._index_for_search(
            model=file,
            skip_member_lookup=not group_ids,
        )
        await self.session.commit()

        effective_mode, _ = await self._effective_policy(file.organization_id, file)
        await self._broadcast_open_to_org_create(file.organization_id, file.id, effective_mode)

        await FolderOperations(self.session).refresh_folder_stats(
            file.folder_id, file.organization_id
        )

        if file.extraction_status == ExtractionStatus.PENDING:
            await self._enqueue_processing_jobs(file)

        return file

    async def _complete_upload_as_version(
        self,
        upload: MultipartUpload,
        file_id: UUID,
        user_id: UUID,
        actual_size: int,
    ) -> File:
        """Swap the completed upload in as the file's current version, mirroring
        the transcode worker's version swap. Access mode, members, and tags stay
        with the file; only the bytes change.
        """
        row = await self.session.execute(
            select(File)
            .where(File.id == file_id, File.is_deleted == False)  # noqa: E712
            .with_for_update()
        )
        file = row.scalar_one_or_none()
        if file is None:
            raise NotFoundError("File", file_id)
        if file.organization_id != upload.organization_id:
            raise ValidationError("version_of_file_id", "File belongs to another organization")
        if file.mime_type != upload.mime_type:
            raise ValidationError(
                "version_of_file_id",
                "A new version must keep the file's MIME type",
            )
        await self._require_edit(user_id, upload.organization_id, file)

        new_version_number = file.version + 1
        version = FileVersion(
            file_id=file.id,
            version_number=new_version_number,
            size_bytes=actual_size,
            storage_key=upload.storage_key,
            storage_bucket=upload.storage_bucket,
            uploaded_by=user_id,
        )
        self.session.add(version)
        await self.session.flush()

        file.storage_key = upload.storage_key
        file.storage_bucket = upload.storage_bucket
        file.size_bytes = actual_size
        file.current_version_id = version.id
        file.version = new_version_number
        file.extraction_status = self._get_initial_extraction_status(file.mime_type)
        file.transcode_status = self._get_initial_transcode_status(file.mime_type, file.filename)
        file.updated_at = datetime.now(UTC)

        upload.status = UploadStatus.COMPLETED
        upload.updated_at = datetime.now(UTC)

        if _file_uploaded_audit_enabled():
            await write_audit_event(
                self.session,
                organization_id=upload.organization_id,
                actor_user_id=user_id,
                action=Action.FILE_UPLOADED,
                resource_type=AuditResourceType.FILE,
                resource_id=file.id,
                details={
                    "filename": file.filename,
                    "mime_type": file.mime_type,
                    "size_bytes": actual_size,
                    "version_number": new_version_number,
                },
            )

        await self.session.commit()
        await self.session.refresh(file)

        try:
            quota_ops = QuotaOperations(self.session)
            await quota_ops.increment_usage(
                organization_id=upload.organization_id,
                user_id=upload.user_id,
                bytes_delta=actual_size,
                file_count_delta=0,
            )
        except Exception:
            logger.opt(exception=True).warning(
                "Failed to increment storage usage", file_id=str(file.id)
            )

        await self._index_for_search(model=file, skip_member_lookup=False)
        await self.session.commit()

        await FolderOperations(self.session).refresh_folder_stats(
            file.folder_id, file.organization_id
        )

        if file.extraction_status == ExtractionStatus.PENDING:
            await self._enqueue_processing_jobs(file)

        await self.prune_file_versions(file)

        return file

    async def restore_file_version(
        self,
        user_id: UUID,
        organization_id: UUID,
        file_id: UUID,
        version_id: UUID,
    ) -> File:
        """Copy-forward restore: the old version's bytes are copied to a fresh
        storage key and become a brand-new version. ``current_version_id`` never
        points back at an old row, so retention pruning stays safe.
        """
        row = await self.session.execute(
            select(File)
            .where(File.id == file_id, File.is_deleted == False)  # noqa: E712
            .with_for_update()
        )
        file = row.scalar_one_or_none()
        if file is None or file.organization_id != organization_id:
            raise NotFoundError("File", file_id)
        await self._require_edit(user_id, organization_id, file)

        version_row = await self.session.execute(
            select(FileVersion).where(FileVersion.id == version_id, FileVersion.file_id == file_id)
        )
        source = version_row.scalar_one_or_none()
        if source is None:
            raise NotFoundError("FileVersion", version_id)
        if source.id == file.current_version_id:
            raise ValidationError("version_id", "This version is already current")
        # Transcode swaps schedule a delayed delete of superseded objects, so a
        # listed version can outlive its bytes; fail cleanly instead of copying air.
        if not await self.s3.object_exists(source.storage_key):
            raise ValidationError(
                "version_id",
                "The stored bytes for this version are no longer available",
            )

        source_size = source.size_bytes
        source_number = source.version_number

        new_storage_key = f"{organization_id}/{file.owner_id}/{generate_id()}/{file.filename}"
        await self.s3.copy_object(
            source_key=source.storage_key,
            destination_key=new_storage_key,
            content_type=file.mime_type,
        )

        new_version_number = file.version + 1
        version = FileVersion(
            file_id=file.id,
            version_number=new_version_number,
            size_bytes=source_size,
            storage_key=new_storage_key,
            storage_bucket=file.storage_bucket,
            checksum_sha256=source.checksum_sha256,
            uploaded_by=user_id,
        )
        self.session.add(version)
        await self.session.flush()

        file.storage_key = new_storage_key
        file.size_bytes = source_size
        file.current_version_id = version.id
        file.version = new_version_number
        file.extraction_status = self._get_initial_extraction_status(file.mime_type)
        file.transcode_status = self._get_initial_transcode_status(file.mime_type, file.filename)
        file.updated_at = datetime.now(UTC)

        await write_audit_event(
            self.session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=Action.FILE_VERSION_RESTORED,
            resource_type=AuditResourceType.FILE,
            resource_id=file.id,
            details={
                "filename": file.filename,
                "version_number": new_version_number,
                "restored_from_version": source_number,
                "size_bytes": source_size,
            },
        )

        await self.session.commit()
        await self.session.refresh(file)

        try:
            quota_ops = QuotaOperations(self.session)
            await quota_ops.increment_usage(
                organization_id=organization_id,
                user_id=user_id,
                bytes_delta=source_size,
                file_count_delta=0,
            )
        except Exception:
            logger.opt(exception=True).warning(
                "Failed to increment storage usage", file_id=str(file.id)
            )

        await self._index_for_search(model=file, skip_member_lookup=False)
        await self.session.commit()

        await FolderOperations(self.session).refresh_folder_stats(
            file.folder_id, file.organization_id
        )

        if file.extraction_status == ExtractionStatus.PENDING:
            await self._enqueue_processing_jobs(file)

        await self.prune_file_versions(file)

        return file

    async def prune_file_versions(self, file: File) -> None:
        """Retention: keep the newest N versions per org policy (the current one
        always survives), delete pruned S3 objects, release quota. Runs after
        every version-creating write; failures never fail that write.
        """
        try:
            policy = await resolve_version_policy(self.session, file.organization_id)
            versions = await self._get_file_versions(file.id)
            pruned = select_versions_to_prune(
                versions, policy.keep_versions, file.current_version_id
            )
            if not pruned:
                return

            pruned_keys = [v.storage_key for v in pruned]
            freed_by_uploader: dict[UUID, int] = {}
            for version in pruned:
                freed_by_uploader[version.uploaded_by] = (
                    freed_by_uploader.get(version.uploaded_by, 0) + version.size_bytes
                )
                await self.session.delete(version)
            await self.session.commit()

            # DB rows go first: a crash here orphans S3 objects (recoverable),
            # never a version row whose bytes are gone.
            try:
                await self.s3.delete_objects(pruned_keys)
            except Exception:
                logger.opt(exception=True).warning(
                    "Failed to delete pruned version objects", file_id=str(file.id)
                )

            quota_ops = QuotaOperations(self.session)
            for uploader_id, freed_bytes in freed_by_uploader.items():
                try:
                    await quota_ops.decrement_usage(
                        organization_id=file.organization_id,
                        user_id=uploader_id,
                        bytes_delta=freed_bytes,
                        file_count_delta=0,
                    )
                except Exception:
                    logger.opt(exception=True).warning(
                        "Failed to decrement storage usage after prune", file_id=str(file.id)
                    )
        except Exception:
            logger.opt(exception=True).warning(
                "Version retention prune failed", file_id=str(file.id)
            )

    async def _enqueue_processing_jobs(self, file: File) -> None:
        """Enqueue MIME-type-driven processing jobs; non-fatal if queue unavailable."""
        from loguru import logger

        try:
            from uniffy.core.valkey import QueueName, get_queue

            queue = get_queue(QueueName.CORE)
            jobs = get_jobs_for_mime_type(file.mime_type)

            for job_name in jobs:
                await queue.enqueue_job(
                    job_name,
                    str(file.id),
                    str(file.organization_id),
                )
                logger.debug(f"Enqueued {job_name} for file {file.id}")

        except RuntimeError:
            from loguru import logger

            logger.warning(f"Queue unavailable, skipping job enqueue for file {file.id}")

    async def abort_upload(self, upload_id: UUID, user_id: UUID) -> bool:
        """Abort an in-progress upload."""
        upload = await self.get_upload_status(upload_id)
        if not upload:
            raise NotFoundError("Upload", upload_id)

        if upload.user_id != user_id:
            raise PermissionDeniedError("abort", "upload")

        await self.s3.abort_multipart_upload(
            key=upload.storage_key,
            upload_id=upload.s3_upload_id,
        )

        upload.status = UploadStatus.ABORTED
        upload.updated_at = datetime.now(UTC)

        await self.session.commit()
        return True

    def _get_initial_transcode_status(self, mime_type: str, filename: str) -> TranscodeStatus:
        # video/webm with .mp4 filename = screen recording; transcode required.
        if mime_type == "video/webm" and filename.lower().endswith(".mp4"):  # noqa: PLR2004
            return TranscodeStatus.PENDING
        return TranscodeStatus.NOT_NEEDED

    def _get_initial_extraction_status(self, mime_type: str) -> ExtractionStatus:
        """PENDING if MIME has background jobs; otherwise SKIPPED."""
        processable = get_processable_mime_types()
        if mime_type in processable:
            return ExtractionStatus.PENDING
        return ExtractionStatus.SKIPPED

    async def update(
        self,
        user_id: UUID,
        organization_id: UUID,
        file_id: UUID,
        filename: str | None = None,
        tag_ids: list[UUID] | None = None,
        description: str | None = None,
    ) -> File:
        """Metadata update; tag_ids=None preserves manual tags, [] clears
        them. Members via MembersService.
        """
        file = await self._fetch_by_id(file_id, organization_id)
        if not file:
            raise NotFoundError("File", file_id)

        await self._require_edit(user_id, organization_id, file)

        filename_changed = filename is not None and filename != file.filename
        if filename is not None:
            if len(filename) > 255:
                raise ValidationError("filename", "Filename must be 255 characters or fewer")
            file.filename = filename
        if description is not None:
            file.description = description

        file.version += 1
        file.updated_at = datetime.now(UTC)

        await self.session.commit()
        await self.session.refresh(file)

        if tag_ids is not None:
            tag_ops = TagOperations(self.session)
            await tag_ops.replace_manual_tags(
                actor_id=user_id,
                organization_id=organization_id,
                content_urn=build_content_urn(self.content_type, file.id),
                tag_ids=tag_ids,
            )

        await self._index_for_search(model=file)
        await self.session.commit()

        if filename_changed:
            try:
                file_urn = build_content_urn(self.content_type, file.id)
                await propagate_rename(
                    session=self.session,
                    organization_id=organization_id,
                    target_urn=file_urn,
                    new_label=file.filename,
                )
                await self.session.commit()
            except Exception:
                logger.opt(exception=True).warning(
                    "Failed to propagate file rename to mentions", file_id=str(file_id)
                )

        return file

    async def move_file(
        self,
        user_id: UUID,
        organization_id: UUID,
        file_id: UUID,
        folder_id: UUID | None,
        refresh_stats: bool = True,
    ) -> File:
        """Move a file into ``folder_id`` (``None`` = root).

        The destination only needs VIEW: a folder is a place to put things, not
        a permission container, so filing into it never widens who can read the
        file. ``folder_id`` rides the file's search document as ``folder_id`` +
        ``parent_label``, hence the re-index and the mention fanout.
        ``refresh_stats=False`` lets bulk movers refresh each affected folder
        once after their loop instead of twice per file.
        """
        file = await self._fetch_by_id(file_id, organization_id)
        if not file:
            raise NotFoundError("File", file_id)

        await self._require_edit(user_id, organization_id, file)

        folder_name = ""
        if folder_id is not None:
            folder_ops = FolderOperations(self.session)
            folder = await folder_ops.get_by_id(folder_id, organization_id)
            if not folder or folder.is_deleted:
                raise NotFoundError("Folder", folder_id)
            await folder_ops.require_view(user_id, organization_id, folder)
            folder_name = folder.name

        if file.folder_id == folder_id:
            return file

        previous_folder_id = file.folder_id
        file.folder_id = folder_id
        file.updated_at = datetime.now(UTC)

        await write_audit_event(
            self.session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=Action.FILE_MOVED,
            resource_type=AuditResourceType.FILE,
            resource_id=file_id,
            details={
                "previous_folder_id": str(previous_folder_id) if previous_folder_id else None,
                "new_folder_id": str(folder_id) if folder_id else None,
            },
        )
        await self.session.commit()
        await self.session.refresh(file)

        await self._index_for_search(model=file)
        await self.session.commit()

        try:
            await publish_mention_state(
                organization_id=organization_id,
                urn=build_content_urn(self.content_type, file.id),
                changes={"parent_label": folder_name},
            )
        except Exception:
            logger.opt(exception=True).warning(f"Failed to publish parent_label for file {file.id}")

        if refresh_stats:
            folder_ops = FolderOperations(self.session)
            await folder_ops.refresh_folder_stats(previous_folder_id, organization_id)
            await folder_ops.refresh_folder_stats(folder_id, organization_id)

        return file

    async def delete(
        self,
        user_id: UUID,
        organization_id: UUID,
        file_id: UUID,
        permanent: bool = False,
    ) -> bool:
        """Soft-delete or permanently delete (including S3 objects)."""
        file = await self._fetch_by_id(file_id, organization_id)
        if not file:
            raise NotFoundError("File", file_id)

        await self._require_delete(user_id, organization_id, file)

        parent_folder_id = file.folder_id

        if permanent:
            file_size = file.size_bytes
            file_owner = file.owner_id
            file_org = file.organization_id

            # Break FK before deleting versions.
            file.current_version_id = None
            await self.session.flush()

            versions = await self._get_file_versions(file_id)
            for v in versions:
                await self.s3.delete_object(v.storage_key)
                await self.session.delete(v)
            await self.session.flush()

            # Delete the file's own S3 object (if not already covered by a version)
            if not versions or all(v.storage_key != file.storage_key for v in versions):
                await self.s3.delete_object(file.storage_key)

            # Delete from database
            await self.session.delete(file)
        else:
            file.is_deleted = True
            file.deleted_at = datetime.now(UTC)

        await self.session.commit()

        # Decrement usage only on permanent delete (trash still uses storage)
        if permanent:
            try:
                quota_ops = QuotaOperations(self.session)
                await quota_ops.decrement_usage(
                    organization_id=file_org,
                    user_id=file_owner,
                    bytes_delta=file_size,
                    file_count_delta=1,
                )
            except Exception:
                logger.opt(exception=True).warning(
                    "Failed to decrement storage usage on permanent delete", file_id=str(file_id)
                )

        if permanent:
            tag_ops = TagOperations(self.session)
            await tag_ops.unassign_all_for_urn(
                actor_id=user_id,
                organization_id=file_org,
                content_urn=build_content_urn(self.content_type, file_id),
            )

        # Remove from search index
        await self.search_indexer.remove(build_content_urn(self.content_type, file_id))

        await write_audit_event(
            self.session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=(Action.FILE_PERMANENTLY_DELETED if permanent else Action.FILE_DELETED),
            resource_type=AuditResourceType.FILE,
            resource_id=file_id,
            details={
                "filename": file.filename if not permanent else None,
                "mime_type": file.mime_type if not permanent else None,
            },
        )
        await self.session.commit()

        await FolderOperations(self.session).refresh_folder_stats(parent_folder_id, organization_id)

        return True

    async def restore(
        self,
        user_id: UUID,
        organization_id: UUID,
        file_id: UUID,
    ) -> File:
        """Restore a soft-deleted file."""
        file = await self._fetch_by_id(file_id, organization_id)
        if not file:
            raise NotFoundError("File", file_id)

        await self._require_edit(user_id, organization_id, file)

        file.is_deleted = False
        file.deleted_at = None
        file.updated_at = datetime.now(UTC)

        await write_audit_event(
            self.session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=Action.FILE_RESTORED,
            resource_type=AuditResourceType.FILE,
            resource_id=file_id,
            details={"filename": file.filename},
        )

        await self.session.commit()
        await self.session.refresh(file)

        await self._index_for_search(model=file)
        await self.session.commit()

        await FolderOperations(self.session).refresh_folder_stats(file.folder_id, organization_id)

        return file

    async def list_trashed_items(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> tuple[list[File], list[Folder]]:
        """Flat (files, folders) of soft-deleted items owned by the user."""
        files_result = await self.session.execute(
            select(File).where(
                File.organization_id == organization_id,
                File.owner_id == user_id,
                File.is_deleted == True,  # noqa: E712
            )
        )
        files = list(files_result.scalars().all())

        folders_result = await self.session.execute(
            select(Folder).where(
                Folder.organization_id == organization_id,
                Folder.owner_id == user_id,
                Folder.is_deleted == True,  # noqa: E712
            )
        )
        folders = list(folders_result.scalars().all())

        return files, folders

    async def list_files(
        self,
        user_id: UUID,
        organization_id: UUID,
        folder_id: UUID | ParentSelection | None = None,
        access_mode: AccessMode | None = None,
        group_id: UUID | None = None,
        personal_only: bool = False,
        shared_only: bool = False,
        include_deleted: bool = False,
        tag_ids: list[UUID] | None = None,
        page: int = 1,
        page_size: int = 50,
        sort_by: str = "updated_at",
        sort_order: SortOrder = SortOrder.DESCENDING,
    ) -> tuple[list[File], int]:
        """List files with filters; folder_id 'all' means cross-folder; tag_ids AND-joined."""
        query = select(File).where(File.organization_id == organization_id)

        if personal_only:
            query = query.where(File.owner_id == user_id)
        elif shared_only:
            from sqlalchemy import and_

            from uniffy.core.models.login.group_member import GroupMember

            now = datetime.now(UTC)
            user_groups_subq = select(GroupMember.group_id).where(
                GroupMember.user_id == user_id,
                GroupMember.is_active == True,  # noqa: E712
            )
            shared_subq = select(ContentMember.content_id).where(
                ContentMember.organization_id == organization_id,
                ContentMember.content_type == self.content_type,
                ContentMember.role != ContentRole.BLOCKED,
                or_(
                    ContentMember.expires_at.is_(None),
                    ContentMember.expires_at > now,
                ),
                or_(
                    and_(
                        ContentMember.subject_type == SubjectType.USER,
                        ContentMember.subject_id == user_id,
                    ),
                    and_(
                        ContentMember.subject_type == SubjectType.GROUP,
                        ContentMember.subject_id.in_(user_groups_subq),
                    ),
                ),
            )
            query = query.where(File.owner_id != user_id, File.id.in_(shared_subq))
        else:
            access_filter = await self.access_query.build_accessible_filter(
                user_id=user_id,
                organization_id=organization_id,
                content_type=self.content_type,
                content_id_column=File.id,
                owner_id_column=File.owner_id,
                access_mode_column=File.access_mode,
                baseline_role_column=File.baseline_role,
            )
            query = query.where(access_filter)

        if group_id is not None:
            now = datetime.now(UTC)
            group_member_subq = select(ContentMember.content_id).where(
                ContentMember.organization_id == organization_id,
                ContentMember.content_type == self.content_type,
                ContentMember.subject_type == SubjectType.GROUP,
                ContentMember.subject_id == group_id,
                ContentMember.role != ContentRole.BLOCKED,
                or_(
                    ContentMember.expires_at.is_(None),
                    ContentMember.expires_at > now,
                ),
            )
            query = query.where(File.id.in_(group_member_subq))

        # Folder filter with parent access check
        if folder_id is None:
            query = query.where(File.folder_id.is_(None))
        elif folder_id != ParentSelection.ALL:
            query = query.where(File.folder_id == folder_id)
        else:
            folder_access_filter = await self.access_query.build_accessible_filter(
                user_id=user_id,
                organization_id=organization_id,
                content_type=ContentType.FOLDER,
                content_id_column=Folder.id,
                owner_id_column=Folder.owner_id,
                access_mode_column=Folder.access_mode,
                baseline_role_column=Folder.baseline_role,
            )
            accessible_folders_query = select(Folder.id).where(
                Folder.organization_id == organization_id,
                folder_access_filter,
            )
            query = query.where(
                or_(
                    File.folder_id.is_(None),
                    File.folder_id.in_(accessible_folders_query),
                )
            )

        if access_mode is not None:
            query = query.where(File.access_mode == access_mode)

        if not include_deleted:
            query = query.where(File.is_deleted == False)  # noqa: E712

        if tag_ids:
            query = query.where(File.id.in_(self._tag_filter_subquery(tag_ids)))

        count_query = select(func.count()).select_from(query.subquery())
        total = (await self.session.execute(count_query)).scalar() or 0

        sort_col = getattr(File, sort_by, File.updated_at)
        if sort_order == SortOrder.ASCENDING:
            query = query.order_by(sort_col.asc())
        else:
            query = query.order_by(sort_col.desc())

        query = query.offset((page - 1) * page_size).limit(page_size)
        query = query.options(selectinload(File.media_info))

        result = await self.session.execute(query)
        files = list(result.scalars().all())

        return files, total

    def _tag_filter_subquery(self, tag_ids: list[UUID]):
        """Subquery: file ids that carry every tag id in ``tag_ids``.

        Implements logical AND by joining ``tag_assignments`` against
        the synthesized ``urn:uniffy:content:FILE:{id}`` value, grouping
        by file id, and requiring the distinct tag count to match the
        requested set size.
        """
        urn_prefix = "urn:uniffy:content:FILE:"
        urn_expr = func.concat(urn_prefix, cast(File.id, String))
        return (
            select(File.id)
            .join(TagAssignment, TagAssignment.content_urn == urn_expr)
            .where(TagAssignment.tag_id.in_(tag_ids))
            .group_by(File.id)
            .having(func.count(func.distinct(TagAssignment.tag_id)) == len(tag_ids))
        )

    async def _get_file_versions(self, file_id: UUID) -> list[FileVersion]:
        """Get all versions of a file."""
        result = await self.session.execute(
            select(FileVersion)
            .where(FileVersion.file_id == file_id)
            .order_by(FileVersion.version_number.desc())
        )
        return list(result.scalars().all())

    async def empty_trash(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> tuple[int, int]:
        """Permanently delete every trashed file and folder; returns
        (files_deleted, folders_deleted).
        """
        files_result = await self.session.execute(
            select(File).where(
                File.organization_id == organization_id,
                File.is_deleted == True,  # noqa: E712
                File.owner_id == user_id,  # Only user's own files
            )
        )
        files = list(files_result.scalars().all())

        # First, clear current_version_id to break foreign key constraint
        for file in files:
            file.current_version_id = None
        await self.session.flush()

        # Now delete file versions
        for file in files:
            # Get all versions for this file
            versions_result = await self.session.execute(
                select(FileVersion).where(FileVersion.file_id == file.id)
            )
            versions = list(versions_result.scalars().all())

            # Delete version objects from S3 and DB
            for version in versions:
                await self.s3.delete_object(version.storage_key)
                await self.session.delete(version)

        # Flush version deletions before deleting files
        await self.session.flush()

        # Delete files from S3 and DB, track sizes for usage decrement
        total_deleted_bytes = 0
        tag_ops = TagOperations(self.session)
        for file in files:
            total_deleted_bytes += file.size_bytes
            await self.s3.delete_object(file.storage_key)
            await tag_ops.unassign_all_for_urn(
                actor_id=user_id,
                organization_id=organization_id,
                content_urn=build_content_urn(self.content_type, file.id),
            )
            await self.search_indexer.remove(build_content_urn(self.content_type, file.id))
            await self.session.delete(file)

        # Get all deleted folders
        folders_result = await self.session.execute(
            select(Folder).where(
                Folder.organization_id == organization_id,
                Folder.is_deleted == True,  # noqa: E712
                Folder.owner_id == user_id,
            )
        )
        folders = list(folders_result.scalars().all())

        # Clean up multipart uploads referencing these folders
        folder_ids = [f.id for f in folders]
        if folder_ids:
            uploads_result = await self.session.execute(
                select(MultipartUpload).where(MultipartUpload.folder_id.in_(folder_ids))
            )
            uploads = list(uploads_result.scalars().all())
            for upload in uploads:
                await self.session.delete(upload)
            await self.session.flush()

        for folder in folders:
            await self.session.delete(folder)

        await self.session.commit()

        # Decrement usage for permanently deleted files
        if total_deleted_bytes > 0 or len(files) > 0:
            try:
                quota_ops = QuotaOperations(self.session)
                await quota_ops.decrement_usage(
                    organization_id=organization_id,
                    user_id=user_id,
                    bytes_delta=total_deleted_bytes,
                    file_count_delta=len(files),
                )
            except Exception:
                logger.opt(exception=True).warning(
                    "Failed to decrement storage usage on empty trash", user_id=str(user_id)
                )

        return len(files), len(folders)


class FolderOperations:
    """Folder CRUD operations.

    Folders participate in the permission system through the same generic
    ``ContentMember`` table. Most access checks are delegated to
    :class:`PermissionChecker` directly so folders don't pull in the full
    :class:`BaseContentOperations` machinery; search indexing is wired
    manually for the same reason.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialize folder operations."""
        self.session = session
        self.content_type = ContentType.FOLDER
        self.access_query = ContentAccessQuery(session)
        self.permission_checker = PermissionChecker(session)

    async def _index_for_search(
        self,
        folder: Folder,
        effective_policy: tuple[AccessMode, ContentRole | None] | None = None,
    ) -> dict[str, str] | None:
        """System folders (auto-provisioned Attachments/Recordings) stay out
        of the index; every user owning an identical copy is pure noise.
        Returns the metadata written so callers can publish it verbatim.
        """
        if folder.is_system or folder.is_deleted:
            return None

        from uniffy.core.search.indexer import SearchIndexer

        if effective_policy is None:
            effective_policy = await self._effective_policy(folder.organization_id, folder)
        effective_mode, effective_baseline = effective_policy

        members = await self.session.execute(
            select(
                ContentMember.subject_type,
                ContentMember.subject_id,
                ContentMember.role,
            ).where(
                ContentMember.content_type == ContentType.FOLDER,
                ContentMember.content_id == folder.id,
            )
        )
        shared_users: list[UUID] = []
        shared_groups: list[UUID] = []
        blocked_users: list[UUID] = []
        blocked_groups: list[UUID] = []
        for subject_type, subject_id, role in members.all():
            blocked = role == ContentRole.BLOCKED
            if subject_type == SubjectType.USER:
                (blocked_users if blocked else shared_users).append(subject_id)
            elif subject_type == SubjectType.GROUP:
                (blocked_groups if blocked else shared_groups).append(subject_id)

        parent_label = ""
        if folder.parent_id:
            parent = await self.get_by_id(folder.parent_id, folder.organization_id)
            parent_label = parent.name if parent else ""

        metadata = {
            "parent_id": str(folder.parent_id) if folder.parent_id else "",
            "parent_label": parent_label,
            **await self._child_stats(folder, effective_mode),
        }

        indexer = SearchIndexer(self.session)
        await indexer.index(
            urn=build_content_urn(ContentType.FOLDER, folder.id),
            organization_id=folder.organization_id,
            title=folder.name,
            entity_type=ContentType.FOLDER.value,
            url_path=f"/files?folder={folder.id}",
            owner_id=folder.owner_id,
            access_mode=effective_mode.value,
            baseline_role=effective_baseline.value if effective_baseline else None,
            keywords=folder.name,
            shared_user_ids=shared_users or None,
            shared_group_ids=shared_groups or None,
            blocked_user_ids=blocked_users or None,
            blocked_group_ids=blocked_groups or None,
            metadata=metadata,
        )
        return metadata

    async def _effective_policy(
        self,
        organization_id: UUID,
        folder: Folder,
    ) -> tuple[AccessMode, ContentRole | None]:
        """Materialise NULL access-policy columns against the org's defaults."""
        default_mode, default_baseline = await self.permission_checker.get_org_defaults(
            organization_id, ContentType.FOLDER
        )
        return resolve_effective_policy(
            folder.access_mode, folder.baseline_role, default_mode, default_baseline
        )

    async def _child_stats(self, folder: Folder, folder_mode: AccessMode) -> dict[str, str]:
        """Direct-children counts only; recursive totals would turn every
        deep mutation into a subtree walk. Children with a narrower effective
        mode stay uncounted: the stat reaches everyone who can resolve the
        folder, so it must not disclose restricted children.
        """
        allowed = modes_at_least_as_open(folder_mode)
        file_default, _ = await self.permission_checker.get_org_defaults(
            folder.organization_id, ContentType.FILE
        )
        folder_default, _ = await self.permission_checker.get_org_defaults(
            folder.organization_id, ContentType.FOLDER
        )

        def visible(mode_column, default_mode):
            condition = mode_column.in_(allowed)
            if (default_mode or AccessMode.OWNER_ONLY) in allowed:
                condition = or_(condition, mode_column.is_(None))
            return condition

        files_row = (
            await self.session.execute(
                select(
                    func.count(File.id),
                    func.coalesce(func.sum(File.size_bytes), 0),
                ).where(
                    File.folder_id == folder.id,
                    File.organization_id == folder.organization_id,
                    File.is_deleted == False,  # noqa: E712
                    visible(File.access_mode, file_default),
                )
            )
        ).one()
        subfolder_count = (
            await self.session.execute(
                select(func.count(Folder.id)).where(
                    Folder.parent_id == folder.id,
                    Folder.organization_id == folder.organization_id,
                    Folder.is_deleted == False,  # noqa: E712
                    visible(Folder.access_mode, folder_default),
                )
            )
        ).scalar_one()
        return {
            "file_count": str(files_row[0] or 0),
            "folder_count": str(subfolder_count or 0),
            "total_size": str(files_row[1] or 0),
        }

    async def refresh_folder_stats(
        self,
        folder_id: UUID | None,
        organization_id: UUID,
    ) -> None:
        """Child mutations change the folder's indexed counts; re-index and
        broadcast so visible folder chips update without a refresh. No-ops for
        root (None), system, and trashed folders.
        """
        if folder_id is None:
            return
        folder = await self.get_by_id(folder_id, organization_id)
        if not folder or folder.is_deleted or folder.is_system:
            return
        try:
            effective_policy = await self._effective_policy(organization_id, folder)
            metadata = await self._index_for_search(folder, effective_policy)
            if metadata is None:
                return
            await publish_mention_state(
                organization_id=organization_id,
                urn=build_content_urn(ContentType.FOLDER, folder.id),
                changes={"title": folder.name, **metadata},
                restricted=effective_policy[0] != AccessMode.OPEN_TO_ORG,
            )
        except Exception:
            logger.opt(exception=True).warning(f"Failed to refresh folder stats for {folder_id}")

    async def _remove_from_search(self, folder_id: UUID) -> None:
        from uniffy.core.search.indexer import SearchIndexer

        try:
            indexer = SearchIndexer(self.session)
            await indexer.remove(build_content_urn(ContentType.FOLDER, folder_id))
        except Exception:
            logger.warning(f"Search remove failed for folder {folder_id}")

    async def _role_for(self, user_id: UUID, organization_id: UUID, folder: Folder):
        if folder.owner_id == user_id:
            return ContentRole.OWNER
        return await self.permission_checker.effective_role(
            user_id=user_id,
            organization_id=organization_id,
            content_type=self.content_type,
            content_id=folder.id,
            owner_id=folder.owner_id,
            access_mode=folder.access_mode,
            baseline_role=folder.baseline_role,
        )

    async def require_view(self, user_id: UUID, organization_id: UUID, folder: Folder) -> None:
        if not role_can_view(await self._role_for(user_id, organization_id, folder)):
            raise PermissionDeniedError("view", "folder")

    async def require_edit(self, user_id: UUID, organization_id: UUID, folder: Folder) -> None:
        from uniffy.core.auth.permissions import role_can_edit

        if not role_can_edit(await self._role_for(user_id, organization_id, folder)):
            raise PermissionDeniedError("edit", "folder")

    async def _require_moveable_under(
        self,
        folder_id: UUID,
        parent_id: UUID,
        organization_id: UUID,
    ) -> None:
        """Refuse a move that would detach a subtree by filing a folder under
        itself or under one of its own descendants.
        """
        if parent_id == folder_id:
            raise ValidationError("parent_id", "A folder cannot be its own parent")

        current: UUID | None = parent_id
        # Bounded so a cycle already present in the data cannot spin here.
        for _ in range(_MAX_FOLDER_DEPTH):
            if current is None:
                return
            if current == folder_id:
                raise ValidationError("parent_id", "Cannot move a folder into its own subtree")
            current = (
                await self.session.execute(
                    select(Folder.parent_id).where(
                        Folder.id == current,
                        Folder.organization_id == organization_id,
                    )
                )
            ).scalar_one_or_none()

        raise ValidationError("parent_id", "Folder nesting is too deep")

    async def create(
        self,
        user_id: UUID,
        organization_id: UUID,
        name: str,
        parent_id: UUID | None = None,
        access_mode: AccessMode | None = None,
        baseline_role: ContentRole | None = None,
    ) -> Folder:
        """Create a new folder."""
        access_mode, baseline_role = await resolve_access_policy(
            self.session,
            organization_id,
            ContentType.FOLDER,
            access_mode,
            baseline_role,
        )

        folder = Folder(
            organization_id=organization_id,
            owner_id=user_id,
            name=name,
            parent_id=parent_id,
            access_mode=access_mode,
            baseline_role=baseline_role,
        )

        self.session.add(folder)
        await self.session.commit()
        await self.session.refresh(folder)

        # FolderOperations is standalone (not a BaseContentOperations subclass),
        # so it broadcasts the org-wide refresh directly. resolve_access_policy
        # above already materialised any inherited mode into access_mode.
        if access_mode == AccessMode.OPEN_TO_ORG:
            await publish_content_access_changed(
                content_type=content_type_to_proto(ContentType.FOLDER),
                content_id=folder.id,
                action="granted",
                organization_id=organization_id,
            )

        try:
            await self._index_for_search(folder)
        except Exception:
            logger.warning(f"Search index failed for folder {folder.id}")

        await self.refresh_folder_stats(parent_id, organization_id)

        return folder

    async def get_by_id(
        self,
        folder_id: UUID,
        organization_id: UUID,
    ) -> Folder | None:
        """Get a folder by ID."""
        result = await self.session.execute(
            select(Folder).where(
                Folder.id == folder_id,
                Folder.organization_id == organization_id,
            )
        )
        return result.scalar_one_or_none()

    async def update(
        self,
        user_id: UUID,
        organization_id: UUID,
        folder_id: UUID,
        name: str | None = None,
        parent_id: UUID | None | str = None,
        refresh_parent_stats: bool = True,
    ) -> Folder:
        """Update a folder's metadata.

        Access policy changes (access mode, members) go through the
        MembersService, not this method. ``refresh_parent_stats=False`` lets
        bulk movers refresh each affected parent once after their loop.
        """
        folder = await self.get_by_id(folder_id, organization_id)
        if not folder:
            raise NotFoundError("Folder", folder_id)

        await self.require_edit(user_id, organization_id, folder)

        if isinstance(parent_id, UUID):
            await self._require_moveable_under(folder.id, parent_id, organization_id)

        previous_parent_id = folder.parent_id
        name_changed = name is not None and name != folder.name
        if name is not None:
            if len(name) > 255:
                raise ValidationError("name", "Folder name must be 255 characters or fewer")
            folder.name = name
        if parent_id == "":
            folder.parent_id = None
        elif parent_id is not None:
            folder.parent_id = parent_id

        folder.updated_at = datetime.now(UTC)

        await self.session.commit()
        await self.session.refresh(folder)

        # Re-index + broadcast the folder's own chip state (title, breadcrumb, counts).
        await self.refresh_folder_stats(folder.id, organization_id)

        # Folder rename: every direct child (file or folder) carries the
        # folder name as ``parent_label`` in its search-index metadata, so
        # re-index them and broadcast a mention-state change so visible
        # chips pick up the new breadcrumb without a refresh.
        if name_changed:
            await self._refresh_children_after_rename(folder.id, folder.name, organization_id)

        if folder.parent_id != previous_parent_id and refresh_parent_stats:
            await self.refresh_folder_stats(previous_parent_id, organization_id)
            await self.refresh_folder_stats(folder.parent_id, organization_id)

        return folder

    async def _refresh_children_after_rename(
        self,
        folder_id: UUID,
        parent_label: str,
        organization_id: UUID,
    ) -> None:
        """Re-index every active direct child and broadcast the new
        ``parent_label`` so mention chips update live. Child folders route
        through ``refresh_folder_stats`` so each re-index ships with its
        recipient-gated broadcast.
        """
        file_ops = FileOperations(self.session)
        result = await self.session.execute(
            select(File).where(
                File.folder_id == folder_id,
                File.organization_id == organization_id,
                File.is_deleted == False,  # noqa: E712
            )
        )
        files = list(result.scalars().all())
        for f in files:
            try:
                await file_ops._index_for_search(f)
            except Exception:
                logger.opt(exception=True).warning(
                    f"Failed to re-index file {f.id} after folder rename"
                )
            try:
                await publish_mention_state(
                    organization_id=f.organization_id,
                    urn=build_content_urn(ContentType.FILE, f.id),
                    changes={"parent_label": parent_label},
                )
            except Exception:
                logger.opt(exception=True).warning(f"Failed to publish parent_label for file {f.id}")

        child_folder_ids = list(
            (
                await self.session.execute(
                    select(Folder.id).where(
                        Folder.parent_id == folder_id,
                        Folder.organization_id == organization_id,
                        Folder.is_deleted == False,  # noqa: E712
                    )
                )
            ).scalars()
        )
        for child_id in child_folder_ids:
            await self.refresh_folder_stats(child_id, organization_id)

    async def delete(
        self,
        user_id: UUID,
        organization_id: UUID,
        folder_id: UUID,
        permanent: bool = False,
        recursive: bool = False,
    ) -> tuple[int, int]:
        """Delete a folder; system folders are protected. Returns
        (files_deleted, folders_deleted).
        """
        folder = await self.get_by_id(folder_id, organization_id)
        if not folder:
            raise NotFoundError("Folder", folder_id)

        if folder.is_system:
            raise PermissionDeniedError("delete_system", "folder")

        if folder.owner_id != user_id:
            raise PermissionDeniedError("delete", "folder")

        files_deleted = 0
        folders_deleted = 0

        if recursive:
            files_deleted, folders_deleted = await self._delete_contents(
                folder_id, organization_id, user_id, permanent
            )

        parent_id = folder.parent_id
        # Resolved before the delete: the row is unreadable after the commit.
        effective_mode, _ = await self._effective_policy(organization_id, folder)

        if permanent:
            uploads_result = await self.session.execute(
                select(MultipartUpload).where(MultipartUpload.folder_id == folder_id)
            )
            for upload in uploads_result.scalars().all():
                await self.session.delete(upload)
            await self.session.flush()

            await self.session.delete(folder)
        else:
            folder.is_deleted = True
            folder.deleted_at = datetime.now(UTC)

        await self.session.commit()

        await self._remove_from_search(folder_id)
        try:
            await publish_mention_state(
                organization_id=organization_id,
                urn=build_content_urn(ContentType.FOLDER, folder_id),
                changes={"urn_status": "DELETED"},
                restricted=effective_mode != AccessMode.OPEN_TO_ORG,
            )
        except Exception:
            logger.opt(exception=True).warning(f"Failed to publish folder tombstone for {folder_id}")
        await self.refresh_folder_stats(parent_id, organization_id)

        return files_deleted, folders_deleted + 1

    async def restore_folder(
        self,
        user_id: UUID,
        organization_id: UUID,
        folder_id: UUID,
    ) -> Folder:
        """
        Restore a soft-deleted folder (and all of its contents) back to active.

        Only the owner may restore. Cascades to every file and subfolder that
        was soft-deleted alongside it.
        """
        folder = await self.session.execute(
            select(Folder).where(
                Folder.id == folder_id,
                Folder.organization_id == organization_id,
            )
        )
        folder_obj = folder.scalar_one_or_none()
        if not folder_obj:
            raise NotFoundError("Folder", str(folder_id))

        if folder_obj.owner_id != user_id:
            raise PermissionDeniedError("restore", "folder")

        folder_obj.is_deleted = False
        folder_obj.deleted_at = None

        # Cascade restore to every descendant (file or folder) that was deleted.
        restored_files, restored_folders = await self._restore_contents(
            folder_id, organization_id, user_id
        )

        await self.session.commit()
        await self.session.refresh(folder_obj)

        # Deletion dropped every doc from the search index; restore must put
        # them back or restored content stays unfindable. Folders go through
        # refresh_folder_stats so each re-index ships with its broadcast.
        file_ops = FileOperations(self.session)
        for restored in restored_folders:
            await self.refresh_folder_stats(restored.id, organization_id)
        for file in restored_files:
            try:
                await file_ops._index_for_search(model=file)
            except Exception:
                logger.opt(exception=True).warning(
                    f"Search index failed for restored file {file.id}"
                )

        # The restored subtree changes its parent's counts, and visible chips
        # for the restored folder itself need a fresh broadcast.
        await self.refresh_folder_stats(folder_obj.id, organization_id)
        await self.refresh_folder_stats(folder_obj.parent_id, organization_id)

        return folder_obj

    async def _restore_contents(
        self,
        folder_id: UUID,
        organization_id: UUID,
        user_id: UUID,
    ) -> tuple[list[File], list[Folder]]:
        """Recursively un-delete files and subfolders owned by the user;
        returns everything it touched so the caller can re-index after commit.
        """
        restored_files: list[File] = []
        restored_folders: list[Folder] = []

        files_result = await self.session.execute(
            select(File).where(
                File.folder_id == folder_id,
                File.organization_id == organization_id,
                File.owner_id == user_id,
                File.is_deleted == True,  # noqa: E712
            )
        )
        for file in files_result.scalars().all():
            file.is_deleted = False
            file.deleted_at = None
            restored_files.append(file)

        folders_result = await self.session.execute(
            select(Folder).where(
                Folder.parent_id == folder_id,
                Folder.organization_id == organization_id,
                Folder.owner_id == user_id,
                Folder.is_deleted == True,  # noqa: E712
            )
        )
        for child in folders_result.scalars().all():
            child.is_deleted = False
            child.deleted_at = None
            restored_folders.append(child)
            child_files, child_folders = await self._restore_contents(
                child.id, organization_id, user_id
            )
            restored_files.extend(child_files)
            restored_folders.extend(child_folders)

        return restored_files, restored_folders

    async def _delete_contents(
        self,
        folder_id: UUID,
        organization_id: UUID,
        user_id: UUID,
        permanent: bool,
    ) -> tuple[int, int]:
        """
        Recursively delete folder contents.

        IMPORTANT: Only deletes items owned by user_id.
        Raises PermissionDeniedError if any nested item is not owned by user.
        """
        files_deleted = 0
        folders_deleted = 0

        # Get child files
        files_result = await self.session.execute(
            select(File).where(
                File.folder_id == folder_id,
                File.organization_id == organization_id,
            )
        )
        files = list(files_result.scalars().all())

        # SECURITY CHECK: Verify ownership of each file before deletion
        for file in files:
            if file.owner_id != user_id:
                raise PermissionDeniedError("delete_nested", "file")

        # Safe to delete all files (ownership verified)
        if permanent and files:
            s3 = get_s3_client()

            # Break FK constraint: clear current_version_id before deleting versions
            for file in files:
                file.current_version_id = None
            await self.session.flush()

            # Delete all file versions and their S3 objects
            for file in files:
                versions_result = await self.session.execute(
                    select(FileVersion).where(FileVersion.file_id == file.id)
                )
                for version in versions_result.scalars().all():
                    await s3.delete_object(version.storage_key)
                    await self.session.delete(version)
            await self.session.flush()

        from uniffy.core.search.indexer import SearchIndexer

        indexer = SearchIndexer(self.session)
        tag_ops = TagOperations(self.session)
        for file in files:
            if permanent:
                s3 = get_s3_client()
                await s3.delete_object(file.storage_key)
                await tag_ops.unassign_all_for_urn(
                    actor_id=user_id,
                    organization_id=organization_id,
                    content_urn=build_content_urn(ContentType.FILE, file.id),
                )
                await self.session.delete(file)
            else:
                file.is_deleted = True
                file.deleted_at = datetime.now(UTC)
            # Drop the file from the search index regardless of
            # permanent vs soft delete -- a soft-deleted file should
            # not show up in global search either.
            try:
                await indexer.remove(build_content_urn(ContentType.FILE, file.id))
            except Exception:
                logger.warning(f"Search remove failed for file {file.id}")
            files_deleted += 1

        if permanent and files:
            await self.session.flush()

        # Get child folders
        folders_result = await self.session.execute(
            select(Folder).where(
                Folder.parent_id == folder_id,
                Folder.organization_id == organization_id,
            )
        )
        folders = list(folders_result.scalars().all())

        # SECURITY CHECK: Verify ownership of each folder before deletion
        for child_folder in folders:
            if child_folder.owner_id != user_id:
                raise PermissionDeniedError("delete_nested", "folder")

        # Clean up multipart uploads referencing these folders before deleting them
        if permanent and folders:
            folder_ids_to_delete = [f.id for f in folders]
            uploads_result = await self.session.execute(
                select(MultipartUpload).where(MultipartUpload.folder_id.in_(folder_ids_to_delete))
            )
            for upload in uploads_result.scalars().all():
                await self.session.delete(upload)
            await self.session.flush()

        # Safe to delete all folders (ownership verified)
        for child_folder in folders:
            # Recurse first so grandchildren are deleted before this child
            child_files, child_folders = await self._delete_contents(
                child_folder.id, organization_id, user_id, permanent
            )
            files_deleted += child_files
            folders_deleted += child_folders

            if permanent:
                await self.session.delete(child_folder)
                await self.session.flush()
            else:
                child_folder.is_deleted = True
                child_folder.deleted_at = datetime.now(UTC)
            await self._remove_from_search(child_folder.id)
            folders_deleted += 1

        return files_deleted, folders_deleted

    async def create_folder_tree(
        self,
        user_id: UUID,
        organization_id: UUID,
        tree: list[dict],
        parent_id: UUID | None = None,
        access_mode: AccessMode | None = None,
        baseline_role: ContentRole | None = None,
    ) -> list[dict]:
        """Create a folder tree in one transaction; returns flat [{id, name, path, parent_id}]."""
        access_mode, baseline_role = await resolve_access_policy(
            self.session,
            organization_id,
            ContentType.FOLDER,
            access_mode,
            baseline_role,
        )

        created: list[dict] = []
        created_folders: list[Folder] = []

        async def create_recursive(
            nodes: list[dict],
            current_parent_id: UUID | None,
            path_prefix: str,
            depth: int,
        ) -> None:
            if depth > 20:
                return

            for node in nodes:
                name = node.get("name", "")
                if not name:
                    continue

                path = f"{path_prefix}/{name}" if path_prefix else name

                folder = Folder(
                    organization_id=organization_id,
                    owner_id=user_id,
                    name=name,
                    parent_id=current_parent_id,
                    access_mode=access_mode,
                    baseline_role=baseline_role,
                )
                self.session.add(folder)
                await self.session.flush()

                created.append({
                    "id": folder.id,
                    "name": folder.name,
                    "path": path,
                    "parent_id": current_parent_id,
                })
                created_folders.append(folder)

                children = node.get("children", [])
                if children:
                    await create_recursive(children, folder.id, path, depth + 1)

        await create_recursive(tree, parent_id, "", 0)
        await self.session.commit()

        for folder in created_folders:
            try:
                await self._index_for_search(folder)
            except Exception:
                logger.opt(exception=True).warning(f"Search index failed for folder {folder.id}")

        # The dropped tree changes the destination folder's subfolder count.
        await self.refresh_folder_stats(parent_id, organization_id)

        return created

    async def ensure_named_folder(
        self,
        user_id: UUID,
        organization_id: UUID,
        name: str,
    ) -> Folder:
        """Lazily create or fetch a per-user root folder by name.

        Idempotent under concurrency: 15-20 backend instances may all attempt
        to create the same auto-provisioned folder (e.g. "Recordings") on the
        user's first upload. The partial unique index
        ``uq_folders_owner_root_name_active`` covers
        ``(owner_id, organization_id, name) WHERE parent_id IS NULL AND
        is_deleted = false`` so concurrent inserts deterministically fold
        into a single row.

        Used for system-managed folders ("Recordings", "Attachments"). Always
        creates at the personal scope (``OWNER_ONLY``). Always at the root
        (``parent_id = NULL``).
        """
        existing = await self.session.execute(
            select(Folder).where(
                Folder.organization_id == organization_id,
                Folder.owner_id == user_id,
                Folder.name == name,
                Folder.parent_id.is_(None),
                Folder.is_deleted == False,  # noqa: E712
            )
        )
        folder = existing.scalar_one_or_none()
        if folder is not None:
            return folder

        now = datetime.now(UTC)
        stmt = (
            pg_insert(Folder)
            .values(
                organization_id=organization_id,
                owner_id=user_id,
                name=name,
                parent_id=None,
                access_mode=AccessMode.OWNER_ONLY,
                baseline_role=None,
                is_system=True,
                is_deleted=False,
                created_at=now,
                updated_at=now,
            )
            .on_conflict_do_nothing(
                index_elements=["owner_id", "organization_id", "name"],
                index_where=text("parent_id IS NULL AND is_deleted = false AND is_system = true"),
            )
        )
        await self.session.execute(stmt)
        await self.session.commit()

        result = await self.session.execute(
            select(Folder).where(
                Folder.organization_id == organization_id,
                Folder.owner_id == user_id,
                Folder.name == name,
                Folder.parent_id.is_(None),
                Folder.is_deleted == False,  # noqa: E712
            )
        )
        folder = result.scalar_one_or_none()
        if folder is None:
            raise NotFoundError("Folder", name)
        return folder

    async def list_folders(
        self,
        user_id: UUID,
        organization_id: UUID,
        parent_id: UUID | None = None,
        include_deleted: bool = False,
        personal_only: bool = False,
        access_mode: AccessMode | None = None,
        limit: int | None = None,
        offset: int = 0,
    ) -> list[Folder]:
        """List folders with permission filtering.

        ``limit`` is opt-in: the sidebar tree is a full-set caller and asks for
        every folder it can see. Anything that renders into a bounded surface
        (an agent tool result, an API page) passes one.
        """
        query = select(Folder).where(Folder.organization_id == organization_id)

        if personal_only:
            query = query.where(Folder.owner_id == user_id)
        else:
            access_filter = await self.access_query.build_accessible_filter(
                user_id=user_id,
                organization_id=organization_id,
                content_type=self.content_type,
                content_id_column=Folder.id,
                owner_id_column=Folder.owner_id,
                access_mode_column=Folder.access_mode,
                baseline_role_column=Folder.baseline_role,
            )
            query = query.where(access_filter)

        if parent_id is None:
            query = query.where(Folder.parent_id.is_(None))
        else:
            query = query.where(Folder.parent_id == parent_id)

        if access_mode is not None:
            query = query.where(Folder.access_mode == access_mode)

        if not include_deleted:
            query = query.where(Folder.is_deleted == False)  # noqa: E712

        query = query.order_by(Folder.name.asc())
        if limit is not None:
            query = query.offset(offset).limit(limit)

        result = await self.session.execute(query)
        return list(result.scalars().all())


# Content loader registration for ContentMembersOperations


async def _load_file(
    session: AsyncSession,
    organization_id: UUID,
    content_id: UUID,
) -> File | None:
    """Loader for ``ContentMembersOperations`` to fetch a file row."""
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
    """Loader for ``ContentMembersOperations`` to fetch a folder row."""
    result = await session.execute(
        select(Folder).where(
            Folder.id == content_id,
            Folder.organization_id == organization_id,
        )
    )
    return result.scalar_one_or_none()


register_content_loader(ContentType.FILE, _load_file)
register_content_loader(ContentType.FOLDER, _load_folder)
