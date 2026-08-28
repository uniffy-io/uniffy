"""Recursive folder deletion and restoration."""

from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import select

from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models.files.file import File
from uniffy.core.models.files.file_version import FileVersion
from uniffy.core.models.files.folder import Folder
from uniffy.core.models.files.multipart_upload import MultipartUpload
from uniffy.core.search.indexer import SearchIndexer, build_content_urn
from uniffy.core.storage import get_s3_client
from uniffy.core.types import (
    ContentType,
)
from uniffy.core.valkey.mentions import publish_mention_state
from uniffy.domains.files.search import FileSearchOperations
from uniffy.domains.tags.operations import TagOperations

logger = logger.bind(component="files.folders.trash")


class FolderTrashOperations:
    def __init__(self, folders: object) -> None:
        self.folders = folders
        self.session = folders.session
        self.content_type = folders.content_type
        self.access_query = folders.access_query
        self.permission_checker = folders.permission_checker

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
        folder = await self.folders.get_by_id(folder_id, organization_id)
        if not folder:
            raise NotFoundError("Folder", folder_id)

        if folder.is_system:
            raise PermissionDeniedError("delete_system", "folder")

        await self.folders.require_delete(user_id, organization_id, folder)

        files_deleted = 0
        folders_deleted = 0

        if recursive:
            files_deleted, folders_deleted = await self._delete_contents(
                folder_id, organization_id, user_id, permanent
            )

        parent_id = folder.parent_id

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

        await self.folders.projection.remove_from_search(folder_id)
        try:
            await publish_mention_state(
                organization_id=organization_id,
                urn=build_content_urn(ContentType.FOLDER, folder_id),
                changes={"urn_status": "DELETED"},
            )
        except Exception:
            logger.opt(exception=True).warning(f"Failed to publish folder tombstone for {folder_id}")
        await self.folders.refresh_folder_stats(parent_id, organization_id)

        return files_deleted, folders_deleted + 1

    async def restore_folder(
        self,
        user_id: UUID,
        organization_id: UUID,
        folder_id: UUID,
    ) -> Folder:
        """Restore a deleted folder and the actor-owned deleted descendants."""
        folder = await self.session.execute(
            select(Folder).where(
                Folder.id == folder_id,
                Folder.organization_id == organization_id,
            )
        )
        folder_obj = folder.scalar_one_or_none()
        if not folder_obj:
            raise NotFoundError("Folder", str(folder_id))

        await self.folders.require_edit(user_id, organization_id, folder_obj)

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
        file_ops = FileSearchOperations(self.session)
        for restored in restored_folders:
            await self.folders.refresh_folder_stats(restored.id, organization_id)
        for file in restored_files:
            try:
                await file_ops._index_for_search(model=file)
            except Exception:
                logger.opt(exception=True).warning(
                    f"Search index failed for restored file {file.id}"
                )

        # The restored subtree changes its parent's counts, and visible chips
        # for the restored folder itself need a fresh broadcast.
        await self.folders.refresh_folder_stats(folder_obj.id, organization_id)
        await self.folders.refresh_folder_stats(folder_obj.parent_id, organization_id)

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
                File.folder_id == folder_id,
                File.organization_id == organization_id,
                File.owner_id == user_id,
                File.is_deleted == True,  # noqa: E712
                file_access,
            )
        )
        for file in files_result.scalars().all():
            file.is_deleted = False
            file.deleted_at = None
            restored_files.append(file)

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
                Folder.parent_id == folder_id,
                Folder.organization_id == organization_id,
                Folder.owner_id == user_id,
                Folder.is_deleted == True,  # noqa: E712
                folder_access,
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

        file_ops = FileSearchOperations(self.session)
        for file in files:
            await file_ops._require_delete(user_id, organization_id, file)

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

        for child_folder in folders:
            await self.folders.require_delete(user_id, organization_id, child_folder)

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
            await self.folders.projection.remove_from_search(child_folder.id)
            folders_deleted += 1

        return files_deleted, folders_deleted
