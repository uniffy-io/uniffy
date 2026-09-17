"""File version creation, restoration, and retention."""

from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import select

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.errors import NotFoundError, ValidationError
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.files.file import File
from uniffy.core.models.files.file_version import FileVersion
from uniffy.core.models.files.multipart_upload import MultipartUpload, UploadStatus
from uniffy.core.search.indexer import SearchIndexer
from uniffy.core.storage import ObjectStorage
from uniffy.core.types import (
    generate_id,
)
from uniffy.domains.files.folders.operations import FolderOperations
from uniffy.domains.files.jobs.processing import (
    pending_jobs_for_file,
    reset_playback,
)
from uniffy.domains.files.quota.operations import QuotaOperations
from uniffy.domains.files.uploads import _file_uploaded_audit_enabled
from uniffy.domains.files.versions.policy import (
    resolve_version_policy,
    select_versions_to_prune,
)

logger = logger.bind(component="files.versions.operations")


class FileVersionOperations:
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

    async def complete_uploaded_version(
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
        await self.files._require_edit(user_id, upload.organization_id, file)

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
        file.extraction_status = self.files.uploads._get_initial_extraction_status(file.mime_type)
        file.thumbnail_status = self.files.uploads._get_initial_thumbnail_status(file.mime_type)
        file.transcode_status = self.files.uploads._get_initial_transcode_status(
            file.mime_type,
            file.filename,
        )
        reset_playback(file)
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

        await self.files._index_for_search(model=file, skip_member_lookup=False)
        await self.session.commit()

        await FolderOperations(
            self.session,
            self.files.storage,
            self.files.search_indexer,
        ).refresh_folder_stats(file.folder_id, file.organization_id)

        if pending_jobs_for_file(file):
            await self.files.uploads._enqueue_processing_jobs(file)

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
        await self.files._require_edit(user_id, organization_id, file)

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
        if not await self.storage.object_exists(source.storage_key):
            raise ValidationError(
                "version_id",
                "The stored bytes for this version are no longer available",
            )

        source_size = source.size_bytes
        source_number = source.version_number

        new_storage_key = f"{organization_id}/{file.owner_id}/{generate_id()}/{file.filename}"
        await self.storage.copy_object(
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
        file.extraction_status = self.files.uploads._get_initial_extraction_status(file.mime_type)
        file.thumbnail_status = self.files.uploads._get_initial_thumbnail_status(file.mime_type)
        file.transcode_status = self.files.uploads._get_initial_transcode_status(
            file.mime_type,
            file.filename,
        )
        reset_playback(file)
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

        await self.files._index_for_search(model=file, skip_member_lookup=False)
        await self.session.commit()

        await FolderOperations(
            self.session,
            self.files.storage,
            self.files.search_indexer,
        ).refresh_folder_stats(file.folder_id, file.organization_id)

        if pending_jobs_for_file(file):
            await self.files.uploads._enqueue_processing_jobs(file)

        await self.prune_file_versions(file)

        return file

    async def prune_file_versions(self, file: File) -> None:
        """Retention: keep the newest N versions per org policy (the current one
        always survives), delete pruned S3 objects, release quota. Runs after
        every version-creating write; failures never fail that write.
        """
        try:
            policy = await resolve_version_policy(self.session, file.organization_id)
            versions = await self.list_versions(file.id)
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
                await self.storage.delete_objects(pruned_keys)
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

    async def list_versions(self, file_id: UUID) -> list[FileVersion]:
        result = await self.session.execute(
            select(FileVersion)
            .where(FileVersion.file_id == file_id)
            .order_by(FileVersion.version_number.desc())
        )
        return list(result.scalars().all())
