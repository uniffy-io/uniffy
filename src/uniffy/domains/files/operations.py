"""File and folder operations extending BaseContentOperations."""

import os
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions.queries import ContentAccessQuery
from uniffy.core.content.base_operations import BaseContentOperations
from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models.files.file import ExtractionStatus, File
from uniffy.core.models.files.file_version import FileVersion
from uniffy.core.models.files.folder import Folder
from uniffy.core.models.files.multipart_upload import MultipartUpload, UploadStatus
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.storage import get_s3_client
from uniffy.core.types import ContentType, VisibilityScope, generate_id
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
        """
        Build search keywords from file metadata.

        Includes filename, original filename, tags, description, and mime type.
        """
        parts = [model.filename, model.original_filename]
        if model.tags:
            parts.extend(f"tag:{tag}" for tag in model.tags)
        if model.description:
            parts.append(model.description)
        if model.mime_type:
            parts.append(model.mime_type)
        return " ".join(filter(None, parts))

    def _get_search_title(self, model: File) -> str:
        """Get filename for search."""
        return model.filename

    def _get_url_path(self, model: File) -> str:
        """Get URL path for file."""
        return f"/files/{model.id}"

    def _get_search_description(self, model: File) -> str | None:
        """Get search description from file metadata."""
        return model.description

    def _get_search_tags(self, model: File) -> list[str] | None:
        """Get tags for search index."""
        return model.tags if model.tags else None

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
        visibility: VisibilityScope = VisibilityScope.PRIVATE,
    ) -> MultipartUpload:
        """
        Initiate a new file upload.

        Creates a MultipartUpload record and initiates S3 multipart upload.

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
        visibility : VisibilityScope
            Target visibility for the file.

        Returns
        -------
        MultipartUpload
            The created upload record with S3 upload ID.

        """
        # Generate storage key
        storage_key = f"{organization_id}/{user_id}/{generate_id()}/{filename}"

        # Initiate S3 multipart upload
        s3_upload_id = await self.s3.create_multipart_upload(
            key=storage_key,
            content_type=mime_type,
        )

        # Calculate chunks with adaptive sizing based on file size
        chunk_size = calculate_chunk_size(total_size)
        total_chunks = (total_size + chunk_size - 1) // chunk_size

        # Create upload record
        upload = MultipartUpload(
            organization_id=organization_id,
            user_id=user_id,
            s3_upload_id=s3_upload_id,
            storage_key=storage_key,
            storage_bucket=self.s3.config.bucket_name,
            filename=filename,
            mime_type=mime_type,
            total_size=total_size,
            total_chunks=total_chunks,
            chunk_size=chunk_size,
            folder_id=folder_id,
            visibility=visibility,
            status=UploadStatus.ACTIVE,
            parts_completed=[],
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
        """
        Record that a chunk has been uploaded to S3.

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
            Updated upload record.

        """
        upload = await self.get_upload_status(upload_id)
        if not upload:
            raise NotFoundError("Upload", upload_id)

        # Add part to completed list
        parts = list(upload.parts_completed or [])
        parts.append({
            "part_number": part_number,
            "etag": etag,
            "size": size,
        })
        upload.parts_completed = parts
        upload.updated_at = datetime.now(UTC)

        await self.session.commit()
        await self.session.refresh(upload)
        return upload

    async def complete_upload(
        self,
        upload_id: UUID,
        user_id: UUID,
        group_ids: list[UUID] | None = None,
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
        upload = await self.get_upload_status(upload_id)
        if not upload:
            raise NotFoundError("Upload", upload_id)

        if upload.user_id != user_id:
            raise PermissionDeniedError("complete", "upload")

        # Complete S3 multipart upload
        parts = [
            {"PartNumber": p["part_number"], "ETag": p["etag"]}
            for p in (upload.parts_completed or [])
        ]
        await self.s3.complete_multipart_upload(
            key=upload.storage_key,
            upload_id=upload.s3_upload_id,
            parts=parts,
        )

        # Calculate actual size from parts
        actual_size = sum(p["size"] for p in (upload.parts_completed or []))

        # Determine extraction status based on mime type
        extraction_status = self._get_initial_extraction_status(upload.mime_type)

        # Create file record
        file = File(
            organization_id=upload.organization_id,
            owner_id=upload.user_id,
            visibility=upload.visibility,
            filename=upload.filename,
            original_filename=upload.filename,
            mime_type=upload.mime_type,
            size_bytes=actual_size,
            storage_key=upload.storage_key,
            storage_bucket=upload.storage_bucket,
            folder_id=upload.folder_id,
            extraction_status=extraction_status,
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

        # Create group links if visibility is GROUP
        if upload.visibility == VisibilityScope.GROUP and group_ids:
            await self._create_group_links(
                content_id=file.id,
                organization_id=upload.organization_id,
                user_id=user_id,
                group_ids=group_ids,
            )

        # Mark upload as completed
        upload.status = UploadStatus.COMPLETED
        upload.updated_at = datetime.now(UTC)

        await self.session.commit()
        await self.session.refresh(file)

        # Index for search
        await self._index_for_search(
            model=file,
            group_ids=group_ids if upload.visibility == VisibilityScope.GROUP else None,
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
            from uniffy.core.queue import get_queue

            queue = get_queue()
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
        tags: list[str] | None = None,
        description: str | None = None,
        visibility: VisibilityScope | None = None,
        target_group_ids: list[UUID] | None = None,
    ) -> File:
        """
        Update file metadata.

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
        tags : list[str] | None
            New tags.
        description : str | None
            New description.
        visibility : VisibilityScope | None
            New visibility.
        target_group_ids : list[UUID] | None
            Groups to share with (required if visibility is GROUP).

        Returns
        -------
        File
            Updated file.

        """
        file = await self._fetch_by_id(file_id, organization_id)
        if not file:
            raise NotFoundError("File", file_id)

        await self._require_edit(user_id, organization_id, file)

        if filename is not None:
            file.filename = filename
        if tags is not None:
            file.tags = tags
        if description is not None:
            file.description = description

        # Handle visibility change with proper group link management
        old_visibility = file.visibility
        if visibility is not None and visibility != old_visibility:
            # Only owner can change visibility scope
            if file.owner_id != user_id:
                raise PermissionDeniedError("change_visibility", "file")

            file.visibility = visibility

            # Handle group links based on new visibility
            if visibility == VisibilityScope.GROUP:
                if not target_group_ids:
                    from uniffy.core.errors import ValidationError

                    raise ValidationError("group_ids required for GROUP visibility")

                # Remove old group links
                await self._remove_group_links(file.id)

                # Create new group links
                await self._create_group_links(
                    content_id=file.id,
                    group_ids=target_group_ids,
                    user_id=user_id,
                    organization_id=organization_id,
                )
            elif old_visibility == VisibilityScope.GROUP:
                # Moving away from GROUP visibility - remove all group links
                await self._remove_group_links(file.id)

        file.version += 1
        file.updated_at = datetime.now(UTC)

        await self.session.commit()
        await self.session.refresh(file)

        # Update search index with current group IDs
        new_group_ids = (
            target_group_ids
            if visibility == VisibilityScope.GROUP
            else await self._get_content_group_ids(file.id)
        )
        await self._index_for_search(model=file, group_ids=new_group_ids)
        await self.session.commit()

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
            # Delete from S3
            await self.s3.delete_object(file.storage_key)
            # Delete all versions from S3
            versions = await self._get_file_versions(file_id)
            for v in versions:
                if v.storage_key != file.storage_key:
                    await self.s3.delete_object(v.storage_key)
            # Delete from database
            await self.session.delete(file)
        else:
            file.is_deleted = True
            file.deleted_at = datetime.now(UTC)

        await self.session.commit()

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
        group_ids = await self._get_content_group_ids(file.id)
        await self._index_for_search(model=file, group_ids=group_ids)
        await self.session.commit()

        return file

    async def list_files(
        self,
        user_id: UUID,
        organization_id: UUID,
        folder_id: UUID | None | str = None,
        visibility: VisibilityScope | None = None,
        group_id: UUID | None = None,
        personal_only: bool = False,
        shared_only: bool = False,
        include_deleted: bool = False,
        tags: list[str] | None = None,
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
        visibility : VisibilityScope | None
            Filter by visibility.
        group_id : UUID | None
            Filter by group.
        personal_only : bool
            Only personal files.
        shared_only : bool
            Only files shared with user (not owned by user).
        include_deleted : bool
            Include trash.
        tags : list[str] | None
            Filter by tags.
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

        # Apply visibility/access filter
        if personal_only:
            personal_filter = self.access_query.build_personal_filter(
                user_id=user_id,
                owner_id_column=File.owner_id,
                visibility_column=File.visibility,
            )
            query = query.where(personal_filter)
        elif shared_only:
            shared_filter = self.access_query.build_shared_with_me_filter(
                user_id=user_id,
                organization_id=organization_id,
                content_type=self.content_type,
                content_id_column=File.id,
                owner_id_column=File.owner_id,
                visibility_column=File.visibility,
            )
            query = query.where(shared_filter)
        elif group_id:
            group_filter = self.access_query.build_group_filter(
                group_id=group_id,
                organization_id=organization_id,
                content_type=self.content_type,
                content_id_column=File.id,
                visibility_column=File.visibility,
            )
            query = query.where(group_filter)
        else:
            access_filter = self.access_query.build_accessible_filter(
                user_id=user_id,
                organization_id=organization_id,
                content_type=self.content_type,
                content_id_column=File.id,
                owner_id_column=File.owner_id,
                visibility_column=File.visibility,
            )
            query = query.where(access_filter)

        # Folder filter with parent access check
        if folder_id is None:
            # Show only root-level files (no folder)
            query = query.where(File.folder_id.is_(None))
        elif folder_id != "all":
            # Show files in specific folder
            query = query.where(File.folder_id == folder_id)
        else:
            # folder_id == "all" - enforce parent folder access
            # Build subquery for accessible folder IDs
            folder_access_filter = self.access_query.build_accessible_filter(
                user_id=user_id,
                organization_id=organization_id,
                content_type=ContentType.FOLDER,
                content_id_column=Folder.id,
                owner_id_column=Folder.owner_id,
                visibility_column=Folder.visibility,
            )

            accessible_folders_query = select(Folder.id).where(
                Folder.organization_id == organization_id,
                folder_access_filter,
            )

            # Only show files in accessible folders OR root-level files
            query = query.where(
                or_(
                    File.folder_id.is_(None),  # Root-level files
                    File.folder_id.in_(accessible_folders_query),  # Files in accessible folders
                )
            )

        if visibility:
            query = query.where(File.visibility == visibility)

        if not include_deleted:
            query = query.where(File.is_deleted == False)  # noqa: E712

        if tags:
            for tag in tags:
                query = query.where(File.tags.contains([tag]))

        # Count total
        count_query = select(func.count()).select_from(query.subquery())
        total = (await self.session.execute(count_query)).scalar() or 0

        # Sort
        sort_col = getattr(File, sort_by, File.updated_at)
        if sort_order == "asc":
            query = query.order_by(sort_col.asc())
        else:
            query = query.order_by(sort_col.desc())

        # Paginate
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self.session.execute(query)
        files = list(result.scalars().all())

        return files, total

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

        # Delete files from S3 and DB
        for file in files:
            await self.s3.delete_object(file.storage_key)
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

        return len(files), len(folders)


class FolderOperations:
    """
    Folder CRUD operations.

    Folders don't extend BaseContentOperations because they're
    not searchable, but they do use the permission system.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialize folder operations."""
        self.session = session
        self.content_type = ContentType.FOLDER
        self.access_query = ContentAccessQuery(session)

    async def create(
        self,
        user_id: UUID,
        organization_id: UUID,
        name: str,
        parent_id: UUID | None = None,
        visibility: VisibilityScope = VisibilityScope.PRIVATE,
    ) -> Folder:
        """
        Create a new folder.

        Parameters
        ----------
        user_id : UUID
            User creating the folder.
        organization_id : UUID
            Organization ID.
        name : str
            Folder name.
        parent_id : UUID | None
            Parent folder ID.
        visibility : VisibilityScope
            Folder visibility.

        Returns
        -------
        Folder
            Created folder.

        """
        folder = Folder(
            organization_id=organization_id,
            owner_id=user_id,
            name=name,
            parent_id=parent_id,
            visibility=visibility,
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
        visibility: VisibilityScope | None = None,
        target_group_ids: list[UUID] | None = None,
    ) -> Folder:
        """
        Update a folder.

        Parameters
        ----------
        user_id : UUID
            User performing update.
        organization_id : UUID
            Organization ID.
        folder_id : UUID
            Folder to update.
        name : str | None
            New name.
        parent_id : UUID | None | str
            New parent ("" to move to root).
        visibility : VisibilityScope | None
            New visibility.
        target_group_ids : list[UUID] | None
            Groups to share with (required if visibility is GROUP).

        Returns
        -------
        Folder
            Updated folder.

        """
        folder = await self.get_by_id(folder_id, organization_id)
        if not folder:
            raise NotFoundError("Folder", folder_id)

        if folder.owner_id != user_id:
            raise PermissionDeniedError("edit", "folder")

        if name is not None:
            folder.name = name
        if parent_id == "":
            folder.parent_id = None
        elif parent_id is not None:
            folder.parent_id = parent_id

        # Handle visibility change with proper group link management
        old_visibility = folder.visibility
        if visibility is not None and visibility != old_visibility:
            folder.visibility = visibility

            # Handle group links based on new visibility
            if visibility == VisibilityScope.GROUP:
                if not target_group_ids:
                    from uniffy.core.errors import ValidationError

                    raise ValidationError("group_ids required for GROUP visibility")

                # Remove old group links (folders don't extend BaseContentOperations
                # so we do it directly)
                from sqlalchemy import delete

                from uniffy.core.models.permissions.content_group_link import ContentGroupLink

                await self.session.execute(
                    delete(ContentGroupLink).where(
                        ContentGroupLink.content_id == folder.id,
                        ContentGroupLink.content_type == ContentType.FILE,
                    )
                )

                # Create new group links
                for group_id in target_group_ids:
                    link = ContentGroupLink(
                        organization_id=organization_id,
                        content_type=ContentType.FILE,
                        content_id=folder.id,
                        group_id=group_id,
                        linked_by_user_id=user_id,
                    )
                    self.session.add(link)
            elif old_visibility == VisibilityScope.GROUP:
                # Moving away from GROUP visibility - remove all group links
                from sqlalchemy import delete

                from uniffy.core.models.permissions.content_group_link import ContentGroupLink

                await self.session.execute(
                    delete(ContentGroupLink).where(
                        ContentGroupLink.content_id == folder.id,
                        ContentGroupLink.content_type == ContentType.FILE,
                    )
                )

        folder.updated_at = datetime.now(UTC)

        await self.session.commit()
        await self.session.refresh(folder)

        return folder

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
            await self.session.delete(folder)
        else:
            folder.is_deleted = True
            folder.deleted_at = datetime.now(UTC)

        await self.session.commit()

        return files_deleted, folders_deleted + 1

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
        for file in files:
            if permanent:
                s3 = get_s3_client()
                await s3.delete_object(file.storage_key)
                await self.session.delete(file)
            else:
                file.is_deleted = True
                file.deleted_at = datetime.now(UTC)
            files_deleted += 1

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

        # Safe to delete all folders (ownership verified)
        for child_folder in folders:
            # Recurse (will perform ownership checks on nested contents)
            child_files, child_folders = await self._delete_contents(
                child_folder.id, organization_id, user_id, permanent
            )
            files_deleted += child_files
            folders_deleted += child_folders

            if permanent:
                await self.session.delete(child_folder)
            else:
                child_folder.is_deleted = True
                child_folder.deleted_at = datetime.now(UTC)
            folders_deleted += 1

        return files_deleted, folders_deleted

    async def list_folders(
        self,
        user_id: UUID,
        organization_id: UUID,
        parent_id: UUID | None = None,
        include_deleted: bool = False,
        personal_only: bool = False,
        visibility: VisibilityScope | None = None,
    ) -> list[Folder]:
        """
        List folders in a parent folder with permission filtering.

        Parameters
        ----------
        user_id : UUID
            User requesting list.
        organization_id : UUID
            Organization ID.
        parent_id : UUID | None
            Parent folder ID (None for root).
        include_deleted : bool
            Include deleted folders.
        personal_only : bool
            Only show user's PRIVATE folders.
        visibility : VisibilityScope | None
            Filter by visibility scope.

        Returns
        -------
        list[Folder]
            List of folders user has access to.

        """
        query = select(Folder).where(Folder.organization_id == organization_id)

        # Apply permission filtering
        if personal_only:
            # Show only user's PRIVATE folders
            personal_filter = self.access_query.build_personal_filter(
                user_id=user_id,
                owner_id_column=Folder.owner_id,
                visibility_column=Folder.visibility,
            )
            query = query.where(personal_filter)
        else:
            # Show all accessible folders (PRIVATE owned by user, GROUP where member, ORGANIZATION)
            access_filter = self.access_query.build_accessible_filter(
                user_id=user_id,
                organization_id=organization_id,
                content_type=self.content_type,
                content_id_column=Folder.id,
                owner_id_column=Folder.owner_id,
                visibility_column=Folder.visibility,
            )
            query = query.where(access_filter)

        # Apply parent folder filter
        if parent_id is None:
            query = query.where(Folder.parent_id.is_(None))
        else:
            query = query.where(Folder.parent_id == parent_id)

        # Apply visibility filter if specified
        if visibility:
            query = query.where(Folder.visibility == visibility)

        # Filter deleted folders
        if not include_deleted:
            query = query.where(Folder.is_deleted == False)  # noqa: E712

        query = query.order_by(Folder.name.asc())

        result = await self.session.execute(query)
        return list(result.scalars().all())
