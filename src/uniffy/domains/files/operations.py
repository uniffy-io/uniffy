"""File and folder operations extending BaseContentOperations."""

import os
from datetime import UTC, datetime, timedelta
from uuid import UUID

from loguru import logger
from sqlalchemy import String, cast, func, or_, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from uniffy.core.auth.permissions import (
    PermissionChecker,
    resolve_access_policy,
)
from uniffy.core.auth.permissions.queries import ContentAccessQuery
from uniffy.core.content.base_operations import BaseContentOperations
from uniffy.core.content.cascade import propagate_rename
from uniffy.core.content.members import register_content_loader
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
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
    SubjectType,
    generate_id,
)
from uniffy.domains.files.quota_operations import QuotaOperations
from uniffy.domains.tags import TagAssignment, TagOperations
from uniffy.workers.utils.mime import get_jobs_for_mime_type, get_processable_mime_types

# Chunk size constants (in bytes)
MIN_CHUNK_SIZE = 5 * 1024 * 1024  # 5 MB (S3 minimum)
SMALL_CHUNK_SIZE = 5 * 1024 * 1024  # 5 MB for files < 50 MB
MEDIUM_CHUNK_SIZE = 10 * 1024 * 1024  # 10 MB for files 50-500 MB
LARGE_CHUNK_SIZE = 25 * 1024 * 1024  # 25 MB for files 500 MB - 2 GB
XLARGE_CHUNK_SIZE = 50 * 1024 * 1024  # 50 MB for files > 2 GB

# Size thresholds for adaptive chunking
THRESHOLD_MEDIUM = 50 * 1024 * 1024  # 50 MB
THRESHOLD_LARGE = 500 * 1024 * 1024  # 500 MB
THRESHOLD_XLARGE = 2 * 1024 * 1024 * 1024  # 2 GB

# Default upload expiry: 24 hours
DEFAULT_UPLOAD_EXPIRY_HOURS = int(os.getenv("UPLOAD_EXPIRY_HOURS", 24))


def calculate_chunk_size(total_size: int) -> int:
    """
    Calculate optimal chunk size based on file size.

    Uses larger chunks for bigger files to reduce the number of HTTP requests
    while maintaining reasonable progress granularity.

    Parameters
    ----------
    total_size : int
        Total file size in bytes.

    Returns
    -------
    int
        Optimal chunk size in bytes.

    Examples
    --------
    - 10 MB file -> 5 MB chunks (2 chunks)
    - 100 MB file -> 10 MB chunks (10 chunks)
    - 1 GB file -> 25 MB chunks (40 chunks)
    - 3 GB file -> 50 MB chunks (60 chunks)
    """
    if total_size >= THRESHOLD_XLARGE:
        return XLARGE_CHUNK_SIZE
    elif total_size >= THRESHOLD_LARGE:
        return LARGE_CHUNK_SIZE
    elif total_size >= THRESHOLD_MEDIUM:
        return MEDIUM_CHUNK_SIZE
    else:
        return SMALL_CHUNK_SIZE


class FileOperations(BaseContentOperations[File]):
    """
    File CRUD operations with permissions and search.

    Extends BaseContentOperations to provide file-specific functionality
    including upload handling, versioning, and S3 integration.
    """

    content_type = ContentType.FILE
    model_class = File

    def __init__(self, session: AsyncSession) -> None:
        """Initialize file operations."""
        super().__init__(session)
        self.s3 = get_s3_client()

    # ─────────────────────────────────────────────────────────────
    # Abstract method implementations
    # ─────────────────────────────────────────────────────────────

    def _build_search_keywords(self, model: File) -> str:
        """Build search keywords from file metadata.

        Tag slugs are written into the dedicated ``tags`` array on the
        search document via :meth:`_get_search_tags_async`, so they are
        not duplicated into the keyword stream.
        """
        parts = [model.filename, model.original_filename]
        if model.description:
            parts.append(model.description)
        if model.mime_type:
            parts.append(model.mime_type)
        if model.media_info and model.media_info.extracted_text:
            parts.append(model.media_info.extracted_text)
        return " ".join(filter(None, parts))

    def _get_search_title(self, model: File) -> str:
        """Get filename for search."""
        return model.filename

    def _get_url_path(self, model: File) -> str:
        """Get URL path for file."""
        return f"/files/{model.id}"

    def _get_search_description(self, model: File) -> str | None:
        """Get search description from file metadata.

        Falls back to a snippet of the extracted text when the user did not
        provide a description, so mention previews can show file contents.
        """
        if model.description:
            return model.description
        if model.media_info and model.media_info.extracted_text:
            return model.media_info.extracted_text[:300].strip() or None
        return None

    async def _get_search_tags_async(self, model: File) -> list[str] | None:
        """Return slugs assigned to this file via the unified tag store."""
        tag_ops = TagOperations(self.session)
        urn = build_content_urn(self.content_type, model.id)
        bulk = await tag_ops.get_for_urns(
            organization_id=model.organization_id,
            content_urns=[urn],
        )
        slugs = sorted({tag.slug for tag in bulk.get(urn, [])})
        return slugs or None

    def _get_search_metadata(self, model: File) -> dict[str, str] | None:
        """Sync metadata path -- MIME type and parent folder id.

        ``folder_id`` lets folder deletion cascade-remove every file
        it contained from the search index in a single filter call.
        ``parent_label`` (folder name) is added in
        :meth:`_get_search_metadata_async` so the lookup against the
        folders table can run with the session.
        """
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
        """
        Fetch file by ID with eager-loaded media_info.

        Overrides base to add selectinload for the media_info relationship.

        Parameters
        ----------
        content_id : UUID
            File ID.
        organization_id : UUID
            Organization ID.

        Returns
        -------
        File | None
            The file with media_info loaded, or None.

        """
        result = await self.session.execute(
            select(File)
            .where(File.id == content_id)
            .where(File.organization_id == organization_id)
            .options(selectinload(File.media_info))
        )
        return result.scalar_one_or_none()

    # ─────────────────────────────────────────────────────────────
    # Upload initiation
    # ─────────────────────────────────────────────────────────────

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
        """
        Initiate a new file upload.

        Creates a :class:`MultipartUpload` record (with the access policy
        the resulting :class:`File` will inherit) and starts the S3
        multipart upload.

        Parameters
        ----------
        user_id : UUID
            User initiating the upload.
        organization_id : UUID
            Organization ID.
        filename : str
            Target filename.
        mime_type : str
            MIME type of the file.
        total_size : int
            Expected total size in bytes.
        folder_id : UUID | None
            Target folder ID (None for root).
        access_mode : AccessMode | None
            Access mode the resulting file should use. If ``None``, the
            org default for ``ContentType.FILE`` is resolved.
        baseline_role : ContentRole | None
            Baseline role when ``access_mode == OPEN_TO_ORG``.

        Returns
        -------
        MultipartUpload
            The created upload record with S3 upload ID.

        """
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
        """Get an upload by ID."""
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
        """Record that a chunk has been uploaded to S3.

        Concurrency-safe under HA: 15-20 backend instances may all be writing
        parts for the same upload. The previous JSONB read-modify-write pattern
        lost parts. We now insert into the dedicated `files_multipart_parts`
        table, where `UNIQUE(upload_id, part_number)` lets us upsert idempotently
        with `INSERT ... ON CONFLICT DO UPDATE`.

        Refuses to record parts for non-ACTIVE uploads to keep
        `complete_upload` and `abort_upload` from racing with late chunks.

        Parameters
        ----------
        upload_id : UUID
            Upload ID.
        part_number : int
            Part number (1-indexed).
        etag : str
            ETag returned by S3.
        size : int
            Size of the part in bytes.

        Returns
        -------
        MultipartUpload
            The upload record (unchanged; the part is stored in `multipart_parts`).

        """
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
        """Return the sorted list of part numbers already uploaded.

        Reads from `files_multipart_parts`. Used by handlers and by client
        resume flows.
        """
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
    ) -> File:
        """
        Complete a multipart upload and create the File record.

        Parameters
        ----------
        upload_id : UUID
            Upload ID.
        user_id : UUID
            User completing the upload.
        group_ids : list[UUID] | None
            Group IDs if visibility is GROUP.

        Returns
        -------
        File
            The created file.

        """
        upload_row = await self.session.execute(
            select(MultipartUpload)
            .where(MultipartUpload.id == upload_id)
            .with_for_update()
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
            parts=[
                {"PartNumber": row.part_number, "ETag": row.etag}
                for row in part_rows
            ],
        )

        # Determine extraction status based on mime type
        extraction_status = self._get_initial_extraction_status(upload.mime_type)
        transcode_status = self._get_initial_transcode_status(
            upload.mime_type, upload.filename
        )

        # Create file record
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

        # Create initial version
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

        # Update file with current version
        file.current_version_id = version.id

        # Optional convenience: add explicit group ContentMember rows.
        # Canonical path is the MembersService AddMember RPC.
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

        # Mark upload as completed
        upload.status = UploadStatus.COMPLETED
        upload.updated_at = datetime.now(UTC)

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

        # Increment storage usage tracking
        try:
            quota_ops = QuotaOperations(self.session)
            await quota_ops.increment_usage(
                organization_id=upload.organization_id,
                user_id=upload.user_id,
                bytes_delta=actual_size,
                file_count_delta=1,
            )
        except Exception:
            logger.warning(
                "Failed to increment storage usage",
                file_id=str(file.id),
                exc_info=True,
            )

        # Index for search
        await self._index_for_search(
            model=file,
            skip_member_lookup=not group_ids,
        )
        await self.session.commit()

        # Enqueue background jobs for processing (thumbnails, metadata extraction)
        if file.extraction_status == ExtractionStatus.PENDING:
            await self._enqueue_processing_jobs(file)

        return file

    async def _enqueue_processing_jobs(self, file: File) -> None:
        """
        Enqueue background processing jobs for the file.

        Determines which jobs to run based on MIME type and
        enqueues them to the job queue. Non-fatal if queue unavailable.

        Parameters
        ----------
        file : File
            The file to process.

        """
        from loguru import logger

        try:
            from uniffy.core.valkey import get_queue

            queue = get_queue("core")
            jobs = get_jobs_for_mime_type(file.mime_type)

            for job_name in jobs:
                await queue.enqueue_job(
                    job_name,
                    str(file.id),
                    str(file.organization_id),
                )
                logger.debug(f"Enqueued {job_name} for file {file.id}")

        except RuntimeError:
            # Queue not initialized (e.g., in tests or if Valkey unavailable)
            from loguru import logger

            logger.warning(f"Queue unavailable, skipping job enqueue for file {file.id}")

    async def abort_upload(self, upload_id: UUID, user_id: UUID) -> bool:
        """
        Abort an in-progress upload.

        Parameters
        ----------
        upload_id : UUID
            Upload ID.
        user_id : UUID
            User aborting the upload.

        Returns
        -------
        bool
            True if aborted successfully.

        """
        upload = await self.get_upload_status(upload_id)
        if not upload:
            raise NotFoundError("Upload", upload_id)

        if upload.user_id != user_id:
            raise PermissionDeniedError("abort", "upload")

        # Abort S3 multipart upload
        await self.s3.abort_multipart_upload(
            key=upload.storage_key,
            upload_id=upload.s3_upload_id,
        )

        # Mark upload as aborted
        upload.status = UploadStatus.ABORTED
        upload.updated_at = datetime.now(UTC)

        await self.session.commit()
        return True

    def _get_initial_transcode_status(
        self, mime_type: str, filename: str
    ) -> TranscodeStatus:
        """Decide whether to enqueue the WebM -> MP4 transcode.

        Recordings are uploaded with `mime_type='video/webm'` but with a
        filename already labelled `.mp4` (the frontend commits to that
        from the moment the user clicks Stop). This combination is the
        signal that a transcode is required. Drag-and-drop WebM uploads
        keep their `.webm` filename and are left at `NOT_NEEDED` so the
        user gets exactly the bytes they uploaded.
        """
        if (
            mime_type == "video/webm"
            and filename.lower().endswith(".mp4")
        ):
            return TranscodeStatus.PENDING
        return TranscodeStatus.NOT_NEEDED

    def _get_initial_extraction_status(self, mime_type: str) -> ExtractionStatus:
        """
        Determine initial extraction status based on MIME type.

        Returns PENDING for file types that support background processing
        (thumbnails, metadata extraction), SKIPPED for unsupported types.

        Parameters
        ----------
        mime_type : str
            MIME type of the file.

        Returns
        -------
        ExtractionStatus
            PENDING if background jobs will process this file, SKIPPED otherwise.

        """
        processable = get_processable_mime_types()
        if mime_type in processable:
            return ExtractionStatus.PENDING
        return ExtractionStatus.SKIPPED

    # ─────────────────────────────────────────────────────────────
    # File CRUD
    # ─────────────────────────────────────────────────────────────

    async def update(
        self,
        user_id: UUID,
        organization_id: UUID,
        file_id: UUID,
        filename: str | None = None,
        tag_ids: list[UUID] | None = None,
        description: str | None = None,
    ) -> File:
        """
        Update file metadata.

        Access policy changes (access mode, baseline role, members) go
        through the MembersService, not this method.

        ``tag_ids=None`` leaves manual tags untouched (partial update);
        an empty list clears every manual assignment. Inline-source
        assignments are not exposed for files (no markdown surface).

        Parameters
        ----------
        user_id : UUID
            User performing update.
        organization_id : UUID
            Organization ID.
        file_id : UUID
            File to update.
        filename : str | None
            New filename.
        tag_ids : list[UUID] | None
            Replacement set of manual tag ids.
        description : str | None
            New description.

        Returns
        -------
        File
            Updated file.

        """
        file = await self._fetch_by_id(file_id, organization_id)
        if not file:
            raise NotFoundError("File", file_id)

        await self._require_edit(user_id, organization_id, file)

        filename_changed = filename is not None and filename != file.filename
        if filename is not None:
            if len(filename) > 255:
                raise ValidationError("Filename must be 255 characters or fewer")
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

        # Propagate filename change to mention labels in referencing content
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
                logger.warning(
                    "Failed to propagate file rename to mentions",
                    file_id=str(file_id),
                    exc_info=True,
                )

        return file

    async def delete(
        self,
        user_id: UUID,
        organization_id: UUID,
        file_id: UUID,
        permanent: bool = False,
    ) -> bool:
        """
        Delete a file (soft or permanent).

        Parameters
        ----------
        user_id : UUID
            User performing delete.
        organization_id : UUID
            Organization ID.
        file_id : UUID
            File to delete.
        permanent : bool
            If True, permanently delete including S3 objects.

        Returns
        -------
        bool
            True if deleted successfully.

        """
        file = await self._fetch_by_id(file_id, organization_id)
        if not file:
            raise NotFoundError("File", file_id)

        await self._require_delete(user_id, organization_id, file)

        if permanent:
            file_size = file.size_bytes
            file_owner = file.owner_id
            file_org = file.organization_id

            # Break FK: clear current_version_id
            file.current_version_id = None
            await self.session.flush()

            # Delete all versions (S3 + DB)
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
                logger.warning(
                    "Failed to decrement storage usage on permanent delete",
                    file_id=str(file_id),
                    exc_info=True,
                )

        if permanent:
            tag_ops = TagOperations(self.session)
            await tag_ops.unassign_all_for_urn(
                organization_id=file_org,
                content_urn=build_content_urn(self.content_type, file_id),
            )

        # Remove from search index
        await self.search_indexer.remove(build_content_urn(self.content_type, file_id))
        await self.session.commit()

        return True

    async def restore(
        self,
        user_id: UUID,
        organization_id: UUID,
        file_id: UUID,
    ) -> File:
        """
        Restore a soft-deleted file.

        Parameters
        ----------
        user_id : UUID
            User performing restore.
        organization_id : UUID
            Organization ID.
        file_id : UUID
            File to restore.

        Returns
        -------
        File
            Restored file.

        """
        file = await self._fetch_by_id(file_id, organization_id)
        if not file:
            raise NotFoundError("File", file_id)

        await self._require_edit(user_id, organization_id, file)

        file.is_deleted = False
        file.deleted_at = None
        file.updated_at = datetime.now(UTC)

        await self.session.commit()
        await self.session.refresh(file)

        # Re-index for search
        await self._index_for_search(model=file)
        await self.session.commit()

        return file

    async def list_trashed_items(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> tuple[list[File], list[Folder]]:
        """
        List all soft-deleted files and folders owned by the user in an organization.

        Returns a flat list of both. The caller decides which are shown at the
        "trash root" (items whose parent is not itself deleted) and which are
        shown as children when navigating into a trashed folder.

        Returns
        -------
        tuple[list[File], list[Folder]]
            (deleted_files, deleted_folders)

        """
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
        folder_id: UUID | None | str = None,
        access_mode: AccessMode | None = None,
        group_id: UUID | None = None,
        personal_only: bool = False,
        shared_only: bool = False,
        include_deleted: bool = False,
        tag_ids: list[UUID] | None = None,
        page: int = 1,
        page_size: int = 50,
        sort_by: str = "updated_at",
        sort_order: str = "desc",
    ) -> tuple[list[File], int]:
        """
        List files with filters and permission checking.

        Parameters
        ----------
        user_id : UUID
            User requesting list.
        organization_id : UUID
            Organization ID.
        folder_id : UUID | None | str
            Folder filter (None=root, "all"=all files, UUID=specific folder).
        access_mode : AccessMode | None
            Optional access-mode filter.
        group_id : UUID | None
            Filter to files where the given group is an explicit member.
        personal_only : bool
            Only files owned by the requester.
        shared_only : bool
            Only files the requester does not own but has access to via
            an explicit ContentMember row (any non-blocked role).
        include_deleted : bool
            Include trash.
        tag_ids : list[UUID] | None
            Filter to files carrying every tag id (logical AND).
        page : int
            Page number.
        page_size : int
            Items per page.
        sort_by : str
            Sort column.
        sort_order : str
            Sort direction (asc/desc).

        Returns
        -------
        tuple[list[File], int]
            List of files and total count.

        """
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
            is_org_admin = await self.permission_checker.is_org_admin(user_id, organization_id)
            is_domain_admin = await self.permission_checker.is_domain_admin(
                user_id, organization_id, self.content_type
            )
            if not (is_org_admin or is_domain_admin):
                access_filter = self.access_query.build_accessible_filter(
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
        elif folder_id != "all":
            query = query.where(File.folder_id == folder_id)
        else:
            folder_access_filter = self.access_query.build_accessible_filter(
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
        if sort_order == "asc":
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
        """
        Permanently delete all trash files and folders in organization.

        Parameters
        ----------
        user_id : UUID
            User performing action.
        organization_id : UUID
            Organization ID.

        Returns
        -------
        tuple[int, int]
            (files_deleted, folders_deleted)

        """
        # Get all deleted files
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
                logger.warning(
                    "Failed to decrement storage usage on empty trash",
                    user_id=str(user_id),
                    exc_info=True,
                )

        return len(files), len(folders)


class FolderOperations:
    """Folder CRUD operations.

    Folders are not searchable but they participate in the permission
    system through the same generic ``ContentMember`` table. Most access
    checks are delegated to :class:`PermissionChecker` directly so folders
    don't pull in the full :class:`BaseContentOperations` machinery.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialize folder operations."""
        self.session = session
        self.content_type = ContentType.FOLDER
        self.access_query = ContentAccessQuery(session)
        self.permission_checker = PermissionChecker(session)

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
    ) -> Folder:
        """Update a folder's metadata.

        Access policy changes (access mode, members) go through the
        MembersService, not this method.
        """
        folder = await self.get_by_id(folder_id, organization_id)
        if not folder:
            raise NotFoundError("Folder", folder_id)

        if folder.owner_id != user_id:
            role = await self.permission_checker.effective_role(
                user_id=user_id,
                organization_id=organization_id,
                content_type=self.content_type,
                content_id=folder.id,
                owner_id=folder.owner_id,
                access_mode=folder.access_mode,
                baseline_role=folder.baseline_role,
            )
            from uniffy.core.auth.permissions import role_can_edit

            if not role_can_edit(role):
                raise PermissionDeniedError("edit", "folder")

        name_changed = name is not None and name != folder.name
        if name is not None:
            if len(name) > 255:
                raise ValidationError("Folder name must be 255 characters or fewer")
            folder.name = name
        if parent_id == "":
            folder.parent_id = None
        elif parent_id is not None:
            folder.parent_id = parent_id

        folder.updated_at = datetime.now(UTC)

        await self.session.commit()
        await self.session.refresh(folder)

        # Folder rename: every file inside carries the folder name as
        # ``parent_label`` in its search-index metadata, so re-index
        # them and broadcast a mention-state change so visible chips
        # pick up the new breadcrumb without a refresh.
        if name_changed:
            await self._refresh_files_in_folder(folder.id, folder.name)

        return folder

    async def _refresh_files_in_folder(self, folder_id: UUID, parent_label: str) -> None:
        """Re-index every active file in the folder and broadcast the
        new ``parent_label`` so mention chips update live.
        """
        from uniffy.core.valkey.mentions import publish_mention_state

        file_ops = FileOperations(self.session)
        result = await self.session.execute(
            select(File).where(
                File.folder_id == folder_id,
                File.is_deleted == False,  # noqa: E712
            )
        )
        files = list(result.scalars().all())
        for f in files:
            try:
                await file_ops._index_for_search(f)
            except Exception:
                logger.warning(f"Failed to re-index file {f.id} after folder rename")
            try:
                await publish_mention_state(
                    organization_id=f.organization_id,
                    urn=build_content_urn(ContentType.FILE, f.id),
                    changes={"parent_label": parent_label},
                )
            except Exception:
                logger.warning(f"Failed to publish parent_label for file {f.id}")

    async def delete(
        self,
        user_id: UUID,
        organization_id: UUID,
        folder_id: UUID,
        permanent: bool = False,
        recursive: bool = False,
    ) -> tuple[int, int]:
        """
        Delete a folder.

        Parameters
        ----------
        user_id : UUID
            User performing delete.
        organization_id : UUID
            Organization ID.
        folder_id : UUID
            Folder to delete.
        permanent : bool
            If True, permanently delete.
        recursive : bool
            If True, also delete contents.

        Returns
        -------
        tuple[int, int]
            (files_deleted, folders_deleted)

        Raises
        ------
        NotFoundError
            If folder not found.
        PermissionDeniedError
            If user cannot delete the folder or if it's a system folder.

        """
        folder = await self.get_by_id(folder_id, organization_id)
        if not folder:
            raise NotFoundError("Folder", folder_id)

        # System folders cannot be deleted
        if folder.is_system:
            raise PermissionDeniedError("delete_system", "folder")

        if folder.owner_id != user_id:
            raise PermissionDeniedError("delete", "folder")

        files_deleted = 0
        folders_deleted = 0

        if recursive:
            # Recursively delete contents
            files_deleted, folders_deleted = await self._delete_contents(
                folder_id, organization_id, user_id, permanent
            )

        if permanent:
            # Clean up any multipart uploads referencing this folder
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
        await self._restore_contents(folder_id, organization_id, user_id)

        await self.session.commit()
        await self.session.refresh(folder_obj)
        return folder_obj

    async def _restore_contents(
        self,
        folder_id: UUID,
        organization_id: UUID,
        user_id: UUID,
    ) -> None:
        """Recursively un-delete files and subfolders owned by the user."""
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
            await self._restore_contents(child.id, organization_id, user_id)

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
        """
        Create a folder tree in a single transaction.

        Recursively creates folders preserving the directory structure.
        All folders are created with the same access mode.

        Parameters
        ----------
        user_id : UUID
            User creating the folders.
        organization_id : UUID
            Organization ID.
        tree : list[dict]
            List of ``{"name": str, "children": list}`` nodes.
        parent_id : UUID | None
            Parent folder ID for the root of the tree.
        access_mode : AccessMode | None
            Access mode for all created folders.
        baseline_role : ContentRole | None
            Baseline role when access_mode is OPEN_TO_ORG.

        Returns
        -------
        list[dict]
            Flat list of created folders with id, name, path, parent_id.

        """
        access_mode, baseline_role = await resolve_access_policy(
            self.session,
            organization_id,
            ContentType.FOLDER,
            access_mode,
            baseline_role,
        )

        created: list[dict] = []

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

                children = node.get("children", [])
                if children:
                    await create_recursive(children, folder.id, path, depth + 1)

        await create_recursive(tree, parent_id, "", 0)
        await self.session.commit()

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
                index_where=text(
                    "parent_id IS NULL AND is_deleted = false AND is_system = true"
                ),
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
    ) -> list[Folder]:
        """List folders with permission filtering."""
        query = select(Folder).where(Folder.organization_id == organization_id)

        if personal_only:
            query = query.where(Folder.owner_id == user_id)
        else:
            is_org_admin = await self.permission_checker.is_org_admin(user_id, organization_id)
            is_domain_admin = await self.permission_checker.is_domain_admin(
                user_id, organization_id, self.content_type
            )
            if not (is_org_admin or is_domain_admin):
                access_filter = self.access_query.build_accessible_filter(
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
