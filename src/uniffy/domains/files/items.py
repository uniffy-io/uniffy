"""File metadata, placement, and lifecycle mutations."""

from datetime import UTC, datetime
from uuid import UUID

from loguru import logger

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.errors import NotFoundError, ValidationError
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.files.file import File
from uniffy.core.search.indexer import SearchIndexer, build_content_urn
from uniffy.core.storage import ObjectStorage
from uniffy.core.valkey.mentions import publish_mention_state
from uniffy.domains.files.folders.operations import FolderOperations
from uniffy.domains.files.quota.operations import QuotaOperations
from uniffy.domains.search.rename import propagate_rename
from uniffy.domains.tags.operations import TagOperations

logger = logger.bind(component="files.items")


class FileMutationOperations:
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
        file = await self.files._fetch_by_id(file_id, organization_id)
        if not file:
            raise NotFoundError("File", file_id)

        await self.files._require_edit(user_id, organization_id, file)

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
            tag_ops = TagOperations(self.session, self.search_indexer)
            await tag_ops.replace_manual_tags(
                actor_id=user_id,
                organization_id=organization_id,
                content_urn=build_content_urn(self.content_type, file.id),
                tag_ids=tag_ids,
            )

        await self.files._index_for_search(model=file)
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
        file = await self.files._fetch_by_id(file_id, organization_id)
        if not file:
            raise NotFoundError("File", file_id)

        await self.files._require_edit(user_id, organization_id, file)

        folder_name = ""
        if folder_id is not None:
            folder_ops = FolderOperations(
                self.session,
                self.storage,
                self.search_indexer,
            )
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

        await self.files._index_for_search(model=file)
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
            folder_ops = FolderOperations(
                self.session,
                self.storage,
                self.search_indexer,
            )
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
        file = await self.files._fetch_by_id(file_id, organization_id)
        if not file:
            raise NotFoundError("File", file_id)

        await self.files._require_delete(user_id, organization_id, file)

        parent_folder_id = file.folder_id

        if permanent:
            file_size = file.size_bytes
            file_owner = file.owner_id
            file_org = file.organization_id

            # Break FK before deleting versions.
            file.current_version_id = None
            await self.session.flush()

            versions = await self.files.versions.list_versions(file_id)
            for v in versions:
                await self.storage.delete_object(v.storage_key)
                await self.session.delete(v)
            await self.session.flush()

            # Delete the file's own S3 object (if not already covered by a version)
            if not versions or all(v.storage_key != file.storage_key for v in versions):
                await self.storage.delete_object(file.storage_key)

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
            tag_ops = TagOperations(self.session, self.search_indexer)
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

        await FolderOperations(
            self.session,
            self.storage,
            self.search_indexer,
        ).refresh_folder_stats(parent_folder_id, organization_id)

        return True

    async def restore(
        self,
        user_id: UUID,
        organization_id: UUID,
        file_id: UUID,
    ) -> File:
        """Restore a soft-deleted file."""
        file = await self.files._fetch_by_id(file_id, organization_id)
        if not file:
            raise NotFoundError("File", file_id)

        await self.files._require_edit(user_id, organization_id, file)

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

        await self.files._index_for_search(model=file)
        await self.session.commit()

        await FolderOperations(
            self.session,
            self.storage,
            self.search_indexer,
        ).refresh_folder_stats(file.folder_id, organization_id)

        return file
