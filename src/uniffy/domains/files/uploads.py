"""Multipart upload lifecycle for files."""

import os
from datetime import UTC, datetime, timedelta
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.jobs import enqueue_job
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.files.file import ExtractionStatus, File, ThumbnailStatus, TranscodeStatus
from uniffy.core.models.files.file_version import FileVersion
from uniffy.core.models.files.folder import Folder
from uniffy.core.models.files.multipart_part import MultipartPart
from uniffy.core.models.files.multipart_upload import MultipartUpload, UploadStatus
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import (
    AccessMode,
    ContentRole,
    generate_id,
)
from uniffy.domains.files.attachments.folders import is_attachment_staging_folder
from uniffy.domains.files.folders.operations import FolderOperations
from uniffy.domains.files.jobs.processing import (
    file_processing_job_id,
    initial_extraction_status,
    initial_thumbnail_status,
    pending_jobs_for_file,
)
from uniffy.domains.files.quota.operations import QuotaOperations
from uniffy.domains.tags.operations import TagOperations

logger = logger.bind(component="files.uploads")

MIN_CHUNK_SIZE = 5 * 1024 * 1024  # S3 minimum.
SMALL_CHUNK_SIZE = 5 * 1024 * 1024
MEDIUM_CHUNK_SIZE = 10 * 1024 * 1024
LARGE_CHUNK_SIZE = 25 * 1024 * 1024
XLARGE_CHUNK_SIZE = 50 * 1024 * 1024

THRESHOLD_MEDIUM = 50 * 1024 * 1024
THRESHOLD_LARGE = 500 * 1024 * 1024
THRESHOLD_XLARGE = 2 * 1024 * 1024 * 1024

DEFAULT_UPLOAD_EXPIRY_HOURS = int(os.getenv("UPLOAD_EXPIRY_HOURS", 24))


def _file_uploaded_audit_enabled() -> bool:
    # Default off; one row per upload swamps the audit table on storage-heavy deployments.
    return os.getenv("AUDIT_EVENTS_FILE_UPLOADED", "false").lower() in {
        "1",
        "true",
        "yes",
    }


def calculate_chunk_size(total_size: int) -> int:
    """Pick a chunk size that keeps the multipart part count bounded."""
    if total_size >= THRESHOLD_XLARGE:
        return XLARGE_CHUNK_SIZE
    if total_size >= THRESHOLD_LARGE:
        return LARGE_CHUNK_SIZE
    if total_size >= THRESHOLD_MEDIUM:
        return MEDIUM_CHUNK_SIZE
    return SMALL_CHUNK_SIZE


class FileUploadOperations:
    def __init__(self, files: object) -> None:
        self.files = files
        self.session = files.session
        self.s3 = files.s3
        self.content_type = files.content_type
        self.access_query = files.access_query
        self.search_indexer = files.search_indexer

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
        folder = None
        if folder_id is not None:
            folder_ops = FolderOperations(self.session)
            folder = await folder_ops.get_by_id(folder_id, organization_id)
            if not folder or folder.is_deleted:
                raise NotFoundError("Folder", folder_id)
            await folder_ops.require_view(user_id, organization_id, folder)

        if is_attachment_staging_folder(folder):
            # Staged attachment uploads never inherit the org FILE default:
            # they stay private until attach_file derives access from a parent.
            access_mode, baseline_role = AccessMode.OWNER_ONLY, None
        else:
            access_mode, baseline_role = await self.files._resolve_access_policy(
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

        if version_of_file_id is not None:
            await self.s3.complete_multipart_upload(
                key=upload.storage_key,
                upload_id=upload.s3_upload_id,
                parts=[{"PartNumber": row.part_number, "ETag": row.etag} for row in part_rows],
            )
            return await self.files.versions.complete_uploaded_version(
                upload=upload,
                file_id=version_of_file_id,
                user_id=user_id,
                actual_size=actual_size,
            )

        extraction_status = self._get_initial_extraction_status(upload.mime_type)
        thumbnail_status = self._get_initial_thumbnail_status(upload.mime_type)
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
            thumbnail_status=thumbnail_status,
            transcode_status=transcode_status,
        )

        staged_tags = None
        try:
            self.session.add(file)
            await self.session.flush()

            if tag_ids:
                staged_tags = await TagOperations(self.session).stage_manual_tags(
                    actor_id=user_id,
                    organization_id=file.organization_id,
                    content_urn=build_content_urn(self.content_type, file.id),
                    tag_ids=tag_ids,
                )

            await self.s3.complete_multipart_upload(
                key=upload.storage_key,
                upload_id=upload.s3_upload_id,
                parts=[{"PartNumber": row.part_number, "ETag": row.etag} for row in part_rows],
            )

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
        except Exception:
            await self.session.rollback()
            raise
        await self.session.refresh(file)

        if staged_tags is not None:
            try:
                await TagOperations(self.session).finish_manual_tags_after_commit(staged_tags)
            except Exception:
                await self.session.rollback()
                logger.opt(exception=True).warning(
                    "File created with stale tag projections",
                    file_id=str(file.id),
                )
                await self.session.refresh(file)
                await self.session.refresh(upload)

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

        staging_folder = None
        if file.folder_id is not None:
            staging_folder = (
                await self.session.execute(select(Folder).where(Folder.id == file.folder_id))
            ).scalar_one_or_none()

        # Staged attachment uploads stay out of search/mentions until an
        # attach links them; attach_file indexes the org-wide ones itself.
        if not is_attachment_staging_folder(staging_folder):
            await self.files._index_for_search(
                model=file,
                skip_member_lookup=True,
            )

            effective_mode, _ = await self.files._effective_policy(file.organization_id, file)
            await self.files._broadcast_open_to_org_create(
                file.organization_id,
                file.id,
                effective_mode,
            )

        await FolderOperations(self.session).refresh_folder_stats(
            file.folder_id, file.organization_id
        )

        if pending_jobs_for_file(file):
            await self._enqueue_processing_jobs(file)

        return file

    @staticmethod
    async def _enqueue_processing_jobs(file: File) -> None:
        """Enqueue MIME-type-driven processing jobs; non-fatal if queue unavailable."""
        try:
            for job_ref in pending_jobs_for_file(file):
                await enqueue_job(
                    job_ref,
                    str(file.id),
                    str(file.organization_id),
                    _job_id=file_processing_job_id(job_ref, file.id, file.version),
                )
                logger.debug(f"Enqueued {job_ref.name} for file {file.id}")

        except Exception:
            logger.opt(exception=True).warning(
                "Could not enqueue file-processing jobs",
                file_id=str(file.id),
            )

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

    @staticmethod
    def _get_initial_transcode_status(mime_type: str, filename: str) -> TranscodeStatus:
        # video/webm with .mp4 filename = screen recording; transcode required.
        if mime_type == "video/webm" and filename.lower().endswith(".mp4"):  # noqa: PLR2004
            return TranscodeStatus.PENDING
        return TranscodeStatus.NOT_NEEDED

    @staticmethod
    def _get_initial_extraction_status(mime_type: str) -> ExtractionStatus:
        return initial_extraction_status(mime_type)

    @staticmethod
    def _get_initial_thumbnail_status(mime_type: str) -> ThumbnailStatus:
        return initial_thumbnail_status(mime_type)
