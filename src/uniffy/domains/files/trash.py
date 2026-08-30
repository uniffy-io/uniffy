"""Permanent cleanup for user-owned file trash."""

from uuid import UUID

from loguru import logger
from sqlalchemy import select

from uniffy.core.models.files.file import File
from uniffy.core.models.files.file_version import FileVersion
from uniffy.core.models.files.folder import Folder
from uniffy.core.models.files.multipart_upload import MultipartUpload
from uniffy.core.search.indexer import SearchIndexer, build_content_urn
from uniffy.core.storage import ObjectStorage
from uniffy.core.types import (
    ContentType,
)
from uniffy.domains.files.quota.operations import QuotaOperations
from uniffy.domains.tags.operations import TagOperations

logger = logger.bind(component="files.trash")


class FileTrashOperations:
    def __init__(self, files: object) -> None:
        self.files = files
        self.session = files.session
        self.content_type = files.content_type
        self.access_query = files.access_query

    @property
    def search_indexer(self) -> SearchIndexer:
        return self.files.search_indexer

    @property
    def storage(self) -> ObjectStorage:
        return self.files.storage

    async def empty_trash(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> tuple[int, int]:
        """Permanently delete every trashed file and folder; returns
        (files_deleted, folders_deleted).
        """
        file_access = await self.access_query.build_accessible_filter(
            user_id=user_id,
            organization_id=organization_id,
            content_type=ContentType.FILE,
            content_id_column=File.id,
            owner_id_column=File.owner_id,
            access_mode_column=File.access_mode,
            baseline_role_column=File.baseline_role,
        )
        files_result = await self.session.execute(
            select(File).where(
                File.organization_id == organization_id,
                File.is_deleted == True,  # noqa: E712
                File.owner_id == user_id,
                file_access,
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
                await self.storage.delete_object(version.storage_key)
                await self.session.delete(version)

        # Flush version deletions before deleting files
        await self.session.flush()

        # Delete files from S3 and DB, track sizes for usage decrement
        total_deleted_bytes = 0
        tag_ops = TagOperations(self.session, self.search_indexer)
        for file in files:
            total_deleted_bytes += file.size_bytes
            await self.storage.delete_object(file.storage_key)
            await tag_ops.unassign_all_for_urn(
                actor_id=user_id,
                organization_id=organization_id,
                content_urn=build_content_urn(self.content_type, file.id),
            )
            await self.search_indexer.remove(build_content_urn(self.content_type, file.id))
            await self.session.delete(file)

        # Get all deleted folders
        folder_access = await self.access_query.build_accessible_filter(
            user_id=user_id,
            organization_id=organization_id,
            content_type=ContentType.FOLDER,
            content_id_column=Folder.id,
            owner_id_column=Folder.owner_id,
            access_mode_column=Folder.access_mode,
            baseline_role_column=Folder.baseline_role,
        )
        folders_result = await self.session.execute(
            select(Folder).where(
                Folder.organization_id == organization_id,
                Folder.is_deleted == True,  # noqa: E712
                Folder.owner_id == user_id,
                folder_access,
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
