"""Attachment operations for linking files to content."""

from uuid import UUID

from loguru import logger
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from uniffy.core.auth.permissions import role_can_edit, role_can_view
from uniffy.core.auth.permissions.queries import ContentAccessQuery
from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models.attachments.attachment import Attachment
from uniffy.core.models.files.file import ExtractionStatus, File
from uniffy.core.models.files.file_version import FileVersion
from uniffy.core.models.files.folder import Folder
from uniffy.core.models.files.media_info import FileMediaInfo
from uniffy.core.models.login.user import User
from uniffy.core.storage import get_s3_client
from uniffy.core.types import (
    AccessMode,
    ContentRole,
    ContentType,
    generate_id,
)
from uniffy.workers.utils.mime import get_jobs_for_mime_type, supports_thumbnail

# Name of the system Attachments folder
ATTACHMENTS_FOLDER_NAME = "Attachments"


class AttachmentOperations:
    """
    Attachment operations for linking files to content.

    Handles creating, listing, and removing attachments while managing
    the underlying file copies in the user's Attachments folder.
    """

    def __init__(self, session: AsyncSession) -> None:
        """
        Initialize attachment operations.

        Parameters
        ----------
        session : AsyncSession
            Database session.

        """
        self._session = session
        self._access_query = ContentAccessQuery(session)
        self._s3 = get_s3_client()

    # ─────────────────────────────────────────────────────────────
    # Attachments Folder Management
    # ─────────────────────────────────────────────────────────────

    async def get_or_create_attachments_folder(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> Folder:
        """
        Get or create the user's Attachments folder.

        Each user has a protected "Attachments" folder in each organization.
        This folder is system-managed and cannot be deleted by the user.

        Parameters
        ----------
        user_id : UUID
            User ID.
        organization_id : UUID
            Organization ID.

        Returns
        -------
        Folder
            The user's Attachments folder.

        """
        # Check if folder already exists
        result = await self._session.execute(
            select(Folder).where(
                Folder.organization_id == organization_id,
                Folder.owner_id == user_id,
                Folder.name == ATTACHMENTS_FOLDER_NAME,
                Folder.is_system == True,  # noqa: E712
                Folder.parent_id.is_(None),
            )
        )
        folder = result.scalar_one_or_none()

        if folder:
            return folder

        # Create the Attachments folder (always OWNER_ONLY).
        folder = Folder(
            organization_id=organization_id,
            owner_id=user_id,
            name=ATTACHMENTS_FOLDER_NAME,
            access_mode=AccessMode.OWNER_ONLY,
            baseline_role=None,
            is_system=True,
            parent_id=None,
        )
        self._session.add(folder)
        await self._session.flush()
        await self._session.refresh(folder)

        return folder

    async def get_attachments_folder_id(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> UUID | None:
        """
        Get the user's Attachments folder ID.

        Parameters
        ----------
        user_id : UUID
            User ID.
        organization_id : UUID
            Organization ID.

        Returns
        -------
        UUID | None
            The folder ID if it exists, None otherwise.

        """
        result = await self._session.execute(
            select(Folder.id).where(
                Folder.organization_id == organization_id,
                Folder.owner_id == user_id,
                Folder.name == ATTACHMENTS_FOLDER_NAME,
                Folder.is_system == True,  # noqa: E712
                Folder.parent_id.is_(None),
            )
        )
        row = result.first()
        return row[0] if row else None

    # ─────────────────────────────────────────────────────────────
    # Attach/Detach Operations
    # ─────────────────────────────────────────────────────────────

    async def attach_file(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
        source_file_id: UUID,
    ) -> Attachment:
        """
        Attach a file to content.

        If the file is already in the user's Attachments folder, it will be
        linked directly. Otherwise, a copy is created in the Attachments folder.

        Parameters
        ----------
        user_id : UUID
            User attaching the file.
        organization_id : UUID
            Organization ID.
        content_type : ContentType
            Type of content to attach to (NOTE, CHAT_MESSAGE, etc.).
        content_id : UUID
            ID of the content to attach to.
        source_file_id : UUID
            ID of the file to attach.

        Returns
        -------
        Attachment
            The created attachment.

        Raises
        ------
        NotFoundError
            If the source file is not found.
        PermissionDeniedError
            If the user cannot access the source file or the content.

        """
        # Verify user can access the source file
        source_file = await self._get_accessible_file(user_id, organization_id, source_file_id)
        if not source_file:
            raise NotFoundError("File", str(source_file_id))

        # Verify user can access the content they're attaching to
        await self._verify_content_access(user_id, organization_id, content_type, content_id)

        # Load parent content policy so the attachment file can inherit it.
        _, parent_mode, parent_baseline, _, _ = await self._load_parent_policy(
            organization_id, content_type, content_id
        )

        # Only inherit OPEN_TO_ORG; otherwise keep the attachment private.
        if parent_mode == AccessMode.OPEN_TO_ORG:
            file_access_mode = AccessMode.OPEN_TO_ORG
            file_baseline_role = parent_baseline
        else:
            file_access_mode = AccessMode.OWNER_ONLY
            file_baseline_role = None

        # Get or create Attachments folder
        folder = await self.get_or_create_attachments_folder(user_id, organization_id)

        # Check if file is already in user's Attachments folder
        if source_file.folder_id == folder.id and source_file.owner_id == user_id:
            if (
                source_file.access_mode != file_access_mode
                or source_file.baseline_role != file_baseline_role
            ):
                source_file.access_mode = file_access_mode
                source_file.baseline_role = file_baseline_role
                await self._session.flush()
            file_to_link = source_file
        else:
            file_to_link = await self._copy_file_to_folder(
                source_file=source_file,
                target_folder_id=folder.id,
                user_id=user_id,
                organization_id=organization_id,
                access_mode=file_access_mode,
                baseline_role=file_baseline_role,
            )

        # Create the attachment link
        attachment = Attachment(
            organization_id=organization_id,
            file_id=file_to_link.id,
            content_type=content_type,
            content_id=content_id,
            attached_by_user_id=user_id,
        )
        self._session.add(attachment)
        await self._session.flush()
        await self._session.refresh(attachment)

        return attachment

    async def detach_file(
        self,
        user_id: UUID,
        organization_id: UUID,
        attachment_id: UUID,
    ) -> bool:
        """
        Detach a file from content and delete the attachment file.

        Since each attachment has its own file copy (1:1 relationship),
        detaching also deletes the file from the Attachments folder.

        Parameters
        ----------
        user_id : UUID
            User detaching the file.
        organization_id : UUID
            Organization ID.
        attachment_id : UUID
            ID of the attachment to remove.

        Returns
        -------
        bool
            True if successfully detached.

        Raises
        ------
        NotFoundError
            If the attachment is not found.
        PermissionDeniedError
            If the user cannot detach the file.

        """
        # Get the attachment
        result = await self._session.execute(
            select(Attachment).where(
                Attachment.id == attachment_id,
                Attachment.organization_id == organization_id,
            )
        )
        attachment = result.scalar_one_or_none()
        if not attachment:
            raise NotFoundError("Attachment", str(attachment_id))

        # Check if user can detach (must be the one who attached or have edit access to content)
        if attachment.attached_by_user_id != user_id:
            # Verify user has edit access to the content
            await self._verify_content_edit_access(
                user_id,
                organization_id,
                attachment.content_type,
                attachment.content_id,
            )

        # Get and delete the file
        file_result = await self._session.execute(select(File).where(File.id == attachment.file_id))
        file = file_result.scalar_one_or_none()

        if file:
            # Delete from S3
            await self._s3.delete_object(file.storage_key)

            # Delete file versions
            versions_result = await self._session.execute(
                select(FileVersion).where(FileVersion.file_id == file.id)
            )
            for version in versions_result.scalars().all():
                if version.storage_key != file.storage_key:
                    await self._s3.delete_object(version.storage_key)
                await self._session.delete(version)

            # Delete the file record
            file.current_version_id = None
            await self._session.flush()
            await self._session.delete(file)

        # Delete the attachment record
        await self._session.delete(attachment)
        await self._session.flush()

        return True

    async def detach_all_for_content(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
    ) -> int:
        """
        Detach all files from a piece of content.

        Called when content is deleted to clean up all attachments.

        Parameters
        ----------
        user_id : UUID
            User performing the deletion.
        organization_id : UUID
            Organization ID.
        content_type : ContentType
            Type of content.
        content_id : UUID
            ID of the content.

        Returns
        -------
        int
            Number of attachments removed.

        """
        # Get all attachments for this content
        result = await self._session.execute(
            select(Attachment).where(
                Attachment.organization_id == organization_id,
                Attachment.content_type == content_type,
                Attachment.content_id == content_id,
            )
        )
        attachments = list(result.scalars().all())

        count = 0
        for attachment in attachments:
            await self.detach_file(user_id, organization_id, attachment.id)
            count += 1

        return count

    # ─────────────────────────────────────────────────────────────
    # List Operations
    # ─────────────────────────────────────────────────────────────

    async def list_attachments(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
    ) -> list[tuple[Attachment, File, User | None]]:
        """
        List all attachments for a piece of content.

        Parameters
        ----------
        user_id : UUID
            User requesting the list.
        organization_id : UUID
            Organization ID.
        content_type : ContentType
            Type of content.
        content_id : UUID
            ID of the content.

        Returns
        -------
        list[tuple[Attachment, File, User | None]]
            List of (attachment, file, owner) tuples.

        """
        # Verify user can access the content
        await self._verify_content_access(user_id, organization_id, content_type, content_id)

        # Get attachments with file info
        result = await self._session.execute(
            select(Attachment, File, User)
            .join(File, Attachment.file_id == File.id)
            .outerjoin(User, File.owner_id == User.id)
            .where(
                Attachment.organization_id == organization_id,
                Attachment.content_type == content_type,
                Attachment.content_id == content_id,
            )
            .order_by(Attachment.attached_at.desc())
        )

        return [(row[0], row[1], row[2]) for row in result.all()]

    async def list_shared_attachments(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type_filter: ContentType | None = None,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[list[tuple[Attachment, File, User | None]], int]:
        """
        List attachments from content shared with the user.

        Returns attachments from notes, chats, etc. that have been
        shared with the user (not owned by them).

        Parameters
        ----------
        user_id : UUID
            User requesting the list.
        organization_id : UUID
            Organization ID.
        content_type_filter : ContentType | None
            Optional filter by content type.
        page : int
            Page number (1-indexed).
        page_size : int
            Items per page.

        Returns
        -------
        tuple[list[tuple[Attachment, File, User | None]], int]
            List of (attachment, file, owner) tuples and total count.

        """
        # Build query for attachments where user is NOT the one who attached
        # but has access via content sharing
        query = (
            select(Attachment, File, User)
            .join(File, Attachment.file_id == File.id)
            .outerjoin(User, File.owner_id == User.id)
            .where(
                Attachment.organization_id == organization_id,
                Attachment.attached_by_user_id != user_id,
            )
        )

        if content_type_filter:
            query = query.where(Attachment.content_type == content_type_filter)

        # TODO: Add content access filtering when shared content support is ready
        # For now, this returns attachments where user is not the attacher

        # Get total count
        count_query = select(func.count()).select_from(
            select(Attachment.id)
            .where(
                Attachment.organization_id == organization_id,
                Attachment.attached_by_user_id != user_id,
            )
            .subquery()
        )
        if content_type_filter:
            count_query = select(func.count()).select_from(
                select(Attachment.id)
                .where(
                    Attachment.organization_id == organization_id,
                    Attachment.attached_by_user_id != user_id,
                    Attachment.content_type == content_type_filter,
                )
                .subquery()
            )
        total = (await self._session.execute(count_query)).scalar() or 0

        # Apply pagination
        query = query.order_by(Attachment.attached_at.desc())
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self._session.execute(query)
        attachments = [(row[0], row[1], row[2]) for row in result.all()]

        return attachments, total

    # ─────────────────────────────────────────────────────────────
    # Permission Checking
    # ─────────────────────────────────────────────────────────────

    async def can_access_attachment(
        self,
        user_id: UUID,
        organization_id: UUID,
        attachment_id: UUID,
    ) -> bool:
        """
        Check if user can access an attachment via parent content.

        Parameters
        ----------
        user_id : UUID
            User ID.
        organization_id : UUID
            Organization ID.
        attachment_id : UUID
            Attachment ID.

        Returns
        -------
        bool
            True if user can access the attachment.

        """
        # Get the attachment
        result = await self._session.execute(
            select(Attachment).where(
                Attachment.id == attachment_id,
                Attachment.organization_id == organization_id,
            )
        )
        attachment = result.scalar_one_or_none()
        if not attachment:
            return False

        # Check if user can access the parent content
        try:
            await self._verify_content_access(
                user_id,
                organization_id,
                attachment.content_type,
                attachment.content_id,
            )
            return True
        except PermissionDeniedError:
            return False

    # ─────────────────────────────────────────────────────────────
    # Private Helpers
    # ─────────────────────────────────────────────────────────────

    async def _get_accessible_file(
        self,
        user_id: UUID,
        organization_id: UUID,
        file_id: UUID,
    ) -> File | None:
        """Get a file if user has access, with media_info eager-loaded."""
        result = await self._session.execute(
            select(File)
            .where(
                File.id == file_id,
                File.organization_id == organization_id,
                File.is_deleted == False,  # noqa: E712
            )
            .options(selectinload(File.media_info))
        )
        file = result.scalar_one_or_none()
        if not file:
            return None

        # Check access using the permission system
        access_filter = self._access_query.build_accessible_filter(
            user_id=user_id,
            organization_id=organization_id,
            content_type=ContentType.FILE,
            content_id_column=File.id,
            owner_id_column=File.owner_id,
            access_mode_column=File.access_mode,
            baseline_role_column=File.baseline_role,
        )

        result = await self._session.execute(
            select(File)
            .where(
                File.id == file_id,
                File.organization_id == organization_id,
                access_filter,
            )
            .options(selectinload(File.media_info))
        )
        return result.scalar_one_or_none()

    async def _copy_file_to_folder(
        self,
        source_file: File,
        target_folder_id: UUID,
        user_id: UUID,
        organization_id: UUID,
        access_mode: AccessMode = AccessMode.OWNER_ONLY,
        baseline_role: ContentRole | None = None,
    ) -> File:
        """Copy a file to a target folder with thumbnail handling."""
        # Generate new storage key
        new_file_id = generate_id()
        new_storage_key = f"{organization_id}/{user_id}/{new_file_id}/{source_file.filename}"

        # Copy file content in S3
        await self._s3.copy_object(
            source_key=source_file.storage_key,
            destination_key=new_storage_key,
            content_type=source_file.mime_type,
        )

        extraction_status = ExtractionStatus.SKIPPED
        new_media_info: FileMediaInfo | None = None
        source_info = source_file.media_info

        # Handle thumbnail: copy if exists, or mark for processing
        if (
            source_file.extraction_status == ExtractionStatus.COMPLETED
            and source_info
            and source_info.thumbnail_key
        ):
            # Source has a completed thumbnail - copy it to new location
            new_thumb_key = f"{organization_id}/thumbnails/{new_file_id}.jpg"

            try:
                await self._s3.copy_object(
                    source_key=source_info.thumbnail_key,
                    destination_key=new_thumb_key,
                    content_type="image/jpeg",
                )
                # Build new media info from source, with updated thumbnail key
                new_media_info = FileMediaInfo(
                    file_id=new_file_id,
                    thumbnail_key=new_thumb_key,
                    thumbnail_width=source_info.thumbnail_width,
                    thumbnail_height=source_info.thumbnail_height,
                    width=source_info.width,
                    height=source_info.height,
                    format=source_info.format,
                    color_mode=source_info.color_mode,
                    duration_seconds=source_info.duration_seconds,
                    page_count=source_info.page_count,
                    exif=source_info.exif.copy() if source_info.exif else None,
                )
                extraction_status = ExtractionStatus.COMPLETED
            except Exception as e:
                logger.warning(f"Failed to copy thumbnail for attachment: {e}")
                # Copy non-thumbnail metadata if available
                if source_info and (source_info.width or source_info.exif):
                    new_media_info = FileMediaInfo(
                        file_id=new_file_id,
                        width=source_info.width,
                        height=source_info.height,
                        format=source_info.format,
                        color_mode=source_info.color_mode,
                        exif=source_info.exif.copy() if source_info.exif else None,
                    )
                if supports_thumbnail(source_file.mime_type or ""):
                    extraction_status = ExtractionStatus.PENDING
        elif source_info and (source_info.width or source_info.exif):
            # Copy non-thumbnail metadata from source
            new_media_info = FileMediaInfo(
                file_id=new_file_id,
                width=source_info.width,
                height=source_info.height,
                format=source_info.format,
                color_mode=source_info.color_mode,
                duration_seconds=source_info.duration_seconds,
                page_count=source_info.page_count,
                exif=source_info.exif.copy() if source_info.exif else None,
            )
            if supports_thumbnail(source_file.mime_type or ""):
                extraction_status = ExtractionStatus.PENDING
        elif supports_thumbnail(source_file.mime_type or ""):
            extraction_status = ExtractionStatus.PENDING

        # Create new file record (no search indexing for attachments)
        new_file = File(
            id=new_file_id,
            organization_id=organization_id,
            owner_id=user_id,
            access_mode=access_mode,
            baseline_role=baseline_role,
            filename=source_file.filename,
            original_filename=source_file.original_filename,
            mime_type=source_file.mime_type,
            size_bytes=source_file.size_bytes,
            storage_key=new_storage_key,
            storage_bucket=source_file.storage_bucket,
            folder_id=target_folder_id,
            tags=source_file.tags.copy() if source_file.tags else None,
            description=source_file.description,
            extraction_status=extraction_status,
        )
        self._session.add(new_file)
        await self._session.flush()

        # Create FileMediaInfo row if we have data to copy
        if new_media_info:
            self._session.add(new_media_info)
            await self._session.flush()

        # Create file version
        version = FileVersion(
            file_id=new_file.id,
            version_number=1,
            size_bytes=source_file.size_bytes,
            storage_key=new_storage_key,
            storage_bucket=source_file.storage_bucket,
            uploaded_by=user_id,
        )
        self._session.add(version)
        await self._session.flush()

        new_file.current_version_id = version.id
        await self._session.refresh(new_file)

        # Enqueue processing jobs if needed
        if extraction_status == ExtractionStatus.PENDING:
            await self._enqueue_processing_jobs(new_file)

        return new_file

    async def _enqueue_processing_jobs(self, file: File) -> None:
        """
        Enqueue background processing jobs for a file.

        Parameters
        ----------
        file : File
            The file to process.

        """
        from uniffy.core.valkey import get_queue

        jobs = get_jobs_for_mime_type(file.mime_type or "")
        if not jobs:
            return

        try:
            queue = get_queue()
            for job_name in jobs:
                await queue.enqueue_job(
                    job_name,
                    str(file.id),
                    str(file.organization_id),
                )
                logger.debug(f"Enqueued {job_name} for attachment file {file.id}")
        except RuntimeError as e:
            # Queue not available - non-fatal, file stays PENDING
            logger.warning(f"Could not enqueue jobs for attachment {file.id}: {e}")

    async def _load_parent_policy(
        self,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
    ) -> tuple[UUID, AccessMode, ContentRole | None, ContentType, UUID]:
        """Load (owner_id, access_mode, baseline_role, type, id) for a parent.

        Tasks delegate to their parent project; the returned ``(type, id)``
        pair is what the permission checker should use.
        """
        if content_type == ContentType.NOTE:
            from uniffy.core.models.notes.note import Note

            result = await self._session.execute(
                select(Note.owner_id, Note.access_mode, Note.baseline_role).where(
                    Note.id == content_id,
                    Note.organization_id == organization_id,
                )
            )
            row = result.one_or_none()
            if not row:
                raise NotFoundError("Note", str(content_id))
            return row[0], row[1], row[2], content_type, content_id

        if content_type == ContentType.FILE:
            result = await self._session.execute(
                select(File.owner_id, File.access_mode, File.baseline_role).where(
                    File.id == content_id,
                    File.organization_id == organization_id,
                )
            )
            row = result.one_or_none()
            if not row:
                raise NotFoundError("File", str(content_id))
            return row[0], row[1], row[2], content_type, content_id

        if content_type == ContentType.CALENDAR_EVENT:
            from uniffy.core.models.calendar.event import CalendarEvent

            result = await self._session.execute(
                select(
                    CalendarEvent.organizer_id,
                    CalendarEvent.access_mode,
                    CalendarEvent.baseline_role,
                ).where(
                    CalendarEvent.id == content_id,
                    CalendarEvent.organization_id == organization_id,
                )
            )
            row = result.one_or_none()
            if not row:
                raise NotFoundError("CalendarEvent", str(content_id))
            return row[0], row[1], row[2], content_type, content_id

        if content_type == ContentType.TASK:
            from uniffy.core.models.projects.project import Project
            from uniffy.core.models.projects.task import Task

            task_result = await self._session.execute(
                select(Task.project_id).where(
                    Task.id == content_id,
                    Task.organization_id == organization_id,
                )
            )
            task_row = task_result.one_or_none()
            if not task_row:
                raise NotFoundError("Task", str(content_id))
            project_id = task_row[0]

            proj_result = await self._session.execute(
                select(
                    Project.owner_id, Project.access_mode, Project.baseline_role
                ).where(
                    Project.id == project_id,
                    Project.organization_id == organization_id,
                )
            )
            proj_row = proj_result.one_or_none()
            if not proj_row:
                raise NotFoundError("Project", str(project_id))
            return proj_row[0], proj_row[1], proj_row[2], ContentType.PROJECT, project_id

        raise NotFoundError("Content", str(content_id))

    async def _resolve_parent_role(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
    ) -> ContentRole | None:
        """Return the user's effective role on the parent content."""
        from uniffy.core.auth.permissions.checker import PermissionChecker

        owner_id, access_mode, baseline_role, resolved_type, resolved_id = (
            await self._load_parent_policy(
                organization_id, content_type, content_id
            )
        )

        checker = PermissionChecker(self._session)
        return await checker.effective_role(
            user_id=user_id,
            organization_id=organization_id,
            content_type=resolved_type,
            content_id=resolved_id,
            owner_id=owner_id,
            access_mode=access_mode,
            baseline_role=baseline_role,
        )

    async def _verify_content_access(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
    ) -> None:
        """Verify the user can view the parent content."""
        role = await self._resolve_parent_role(
            user_id, organization_id, content_type, content_id
        )
        if not role_can_view(role):
            raise PermissionDeniedError("access", "content")

    async def _verify_content_edit_access(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
    ) -> None:
        """Verify the user can edit the parent content."""
        role = await self._resolve_parent_role(
            user_id, organization_id, content_type, content_id
        )
        if not role_can_edit(role):
            raise PermissionDeniedError("edit", "content")
