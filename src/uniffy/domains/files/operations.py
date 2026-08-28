"""Stable public operations façade for files and folders."""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.files.file import ExtractionStatus, File, ThumbnailStatus, TranscodeStatus
from uniffy.core.models.files.file_version import FileVersion
from uniffy.core.models.files.folder import Folder
from uniffy.core.models.files.multipart_upload import MultipartUpload
from uniffy.core.storage import get_s3_client
from uniffy.core.types import (
    AccessMode,
    ContentRole,
    ParentSelection,
    SortOrder,
)
from uniffy.domains.files.attachments.access import can_view_attached_file
from uniffy.domains.files.folders.operations import FolderOperations
from uniffy.domains.files.items import FileMutationOperations
from uniffy.domains.files.queries import FileQueryOperations
from uniffy.domains.files.registration import register_file_content
from uniffy.domains.files.search import FileSearchOperations
from uniffy.domains.files.trash import FileTrashOperations
from uniffy.domains.files.uploads import (
    FileUploadOperations,
    _file_uploaded_audit_enabled,
    calculate_chunk_size,
)
from uniffy.domains.files.versions.operations import FileVersionOperations

__all__ = [
    "FileOperations",
    "FolderOperations",
    "_file_uploaded_audit_enabled",
    "calculate_chunk_size",
]


class FileOperations(FileSearchOperations):
    def __init__(self, session: AsyncSession) -> None:
        register_file_content()
        super().__init__(session)
        self.s3 = get_s3_client()
        self.uploads = FileUploadOperations(self)
        self.versions = FileVersionOperations(self)
        self.items = FileMutationOperations(self)
        self.queries = FileQueryOperations(self)
        self.trash = FileTrashOperations(self)

    async def _resolve_role(
        self,
        user_id: UUID,
        organization_id: UUID,
        content: File,
    ) -> ContentRole | None:
        role = await super()._resolve_role(user_id, organization_id, content)
        if role is not None:
            return role
        if await can_view_attached_file(
            self.session,
            user_id=user_id,
            organization_id=organization_id,
            file_id=content.id,
        ):
            return ContentRole.VIEWER
        return None

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
        return await self.uploads.initiate_upload(
            user_id,
            organization_id,
            filename,
            mime_type,
            total_size,
            folder_id,
            access_mode,
            baseline_role,
        )

    async def get_upload_status(self, upload_id: UUID) -> MultipartUpload | None:
        return await self.uploads.get_upload_status(upload_id)

    async def record_chunk_completed(
        self,
        upload_id: UUID,
        part_number: int,
        etag: str,
        size: int,
    ) -> MultipartUpload:
        return await self.uploads.record_chunk_completed(upload_id, part_number, etag, size)

    async def list_completed_part_numbers(self, upload_id: UUID) -> list[int]:
        return await self.uploads.list_completed_part_numbers(upload_id)

    async def complete_upload(
        self,
        upload_id: UUID,
        user_id: UUID,
        tag_ids: list[UUID] | None = None,
        version_of_file_id: UUID | None = None,
    ) -> File:
        return await self.uploads.complete_upload(
            upload_id,
            user_id,
            tag_ids,
            version_of_file_id,
        )

    async def restore_file_version(
        self,
        user_id: UUID,
        organization_id: UUID,
        file_id: UUID,
        version_id: UUID,
    ) -> File:
        return await self.versions.restore_file_version(
            user_id,
            organization_id,
            file_id,
            version_id,
        )

    async def prune_file_versions(self, file: File) -> None:
        await self.versions.prune_file_versions(file)

    async def _enqueue_processing_jobs(self, file: File) -> None:
        await FileUploadOperations._enqueue_processing_jobs(file)

    async def abort_upload(self, upload_id: UUID, user_id: UUID) -> bool:
        return await self.uploads.abort_upload(upload_id, user_id)

    def _get_initial_transcode_status(self, mime_type: str, filename: str) -> TranscodeStatus:
        return FileUploadOperations._get_initial_transcode_status(mime_type, filename)

    def _get_initial_extraction_status(self, mime_type: str) -> ExtractionStatus:
        return FileUploadOperations._get_initial_extraction_status(mime_type)

    def _get_initial_thumbnail_status(self, mime_type: str) -> ThumbnailStatus:
        return FileUploadOperations._get_initial_thumbnail_status(mime_type)

    async def update(
        self,
        user_id: UUID,
        organization_id: UUID,
        file_id: UUID,
        filename: str | None = None,
        tag_ids: list[UUID] | None = None,
        description: str | None = None,
    ) -> File:
        return await self.items.update(
            user_id,
            organization_id,
            file_id,
            filename,
            tag_ids,
            description,
        )

    async def move_file(
        self,
        user_id: UUID,
        organization_id: UUID,
        file_id: UUID,
        folder_id: UUID | None,
        refresh_stats: bool = True,
    ) -> File:
        return await self.items.move_file(
            user_id,
            organization_id,
            file_id,
            folder_id,
            refresh_stats,
        )

    async def delete(
        self,
        user_id: UUID,
        organization_id: UUID,
        file_id: UUID,
        permanent: bool = False,
    ) -> bool:
        return await self.items.delete(user_id, organization_id, file_id, permanent)

    async def restore(
        self,
        user_id: UUID,
        organization_id: UUID,
        file_id: UUID,
    ) -> File:
        return await self.items.restore(user_id, organization_id, file_id)

    async def list_trashed_items(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> tuple[list[File], list[Folder]]:
        return await self.queries.list_trashed_items(user_id, organization_id)

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
        return await self.queries.list_files(
            user_id,
            organization_id,
            folder_id,
            access_mode,
            group_id,
            personal_only,
            shared_only,
            include_deleted,
            tag_ids,
            page,
            page_size,
            sort_by,
            sort_order,
        )

    def _explicit_grant_subquery(self, user_id: UUID, organization_id: UUID):
        return self.queries._explicit_grant_subquery(user_id, organization_id)

    def _tag_filter_subquery(self, tag_ids: list[UUID]):
        return self.queries._tag_filter_subquery(tag_ids)

    async def _get_file_versions(self, file_id: UUID) -> list[FileVersion]:
        return await self.versions.list_versions(file_id)

    async def empty_trash(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> tuple[int, int]:
        return await self.trash.empty_trash(user_id, organization_id)
