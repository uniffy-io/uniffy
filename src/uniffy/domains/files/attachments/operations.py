"""Attachment operations for linking files to content."""

from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from uniffy.core.auth.permissions import PermissionChecker, resolve_effective_policy
from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models.files.attachment import Attachment
from uniffy.core.models.files.file import ExtractionStatus, File
from uniffy.core.models.files.file_version import FileVersion
from uniffy.core.models.files.folder import Folder
from uniffy.core.models.files.media_info import FileMediaInfo
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.login.user import User
from uniffy.core.storage import get_s3_client
from uniffy.core.types import (
    AccessMode,
    ContentRole,
    ContentType,
    generate_id,
)
from uniffy.core.valkey import QueueName, get_queue
from uniffy.domains.files.attachments.access import AttachmentTargetAccess
from uniffy.domains.permissions.resource_access import (
    ResourceAccessPurpose,
    ResourceAccessResolver,
    ResourceKey,
    ResourceRowState,
)
from uniffy.workers.utils.mime import get_jobs_for_mime_type, supports_thumbnail

logger = logger.bind(component="attachments.operations")

ATTACHMENTS_FOLDER_NAME = "Attachments"
ORG_ATTACHMENTS_FOLDER_NAME = "Organization Attachments"


def is_attachment_staging_folder(folder: Folder | None) -> bool:
    """True for a personal Attachments folder - uploads staged there stay
    OWNER_ONLY and out of the search index until an attach links them to a parent."""
    return (
        folder is not None
        and folder.is_system
        and not folder.is_org_attachments
        and folder.name == ATTACHMENTS_FOLDER_NAME
        and folder.parent_id is None
    )


class AttachmentOperations:
    """Link files to content; manages file copies in the Attachments folder."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._s3 = get_s3_client()

    async def get_or_create_attachments_folder(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> Folder:
        """Get or create the user's protected per-org Attachments folder."""
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

    async def get_or_create_org_attachments_folder(
        self,
        organization_id: UUID,
    ) -> Folder:
        """Return the per-org system Attachments folder.

        Carries an explicit `OPEN_TO_ORG/EDITOR` policy so it serves every
        active member regardless of org Files-default flips.
        """
        result = await self._session.execute(
            select(Folder).where(
                Folder.organization_id == organization_id,
                Folder.is_org_attachments == True,  # noqa: E712
                Folder.is_deleted == False,  # noqa: E712
            )
        )
        folder = result.scalar_one_or_none()
        if folder:
            return folder

        members = (
            await self._session.execute(
                select(OrganizationMember.user_id, OrganizationMember.role)
                .join(User, User.id == OrganizationMember.user_id)
                .join(Organization, Organization.id == OrganizationMember.organization_id)
                .where(
                    OrganizationMember.organization_id == organization_id,
                    OrganizationMember.is_active.is_(True),
                    User.is_active.is_(True),
                    Organization.deleted_at.is_(None),
                    Organization.is_suspended.is_(False),
                )
                .order_by(OrganizationMember.joined_at)
            )
        ).all()
        if not members:
            raise NotFoundError("Organization", str(organization_id))

        role_rank = {OrganizationRole.OWNER: 0, OrganizationRole.ADMIN: 1}
        owner_member = min(
            members,
            key=lambda row: role_rank.get(row[1], 2),
        )
        owner_user_id = owner_member[0]

        folder = Folder(
            organization_id=organization_id,
            owner_id=owner_user_id,
            name=ORG_ATTACHMENTS_FOLDER_NAME,
            access_mode=AccessMode.OPEN_TO_ORG,
            baseline_role=ContentRole.EDITOR,
            is_system=True,
            is_org_attachments=True,
            parent_id=None,
        )
        self._session.add(folder)
        await self._session.flush()
        await self._session.refresh(folder)
        return folder

    async def _resolve_parent_effective(
        self,
        organization_id: UUID,
        content_type: ContentType,
        raw_access_mode: AccessMode | None,
        raw_baseline_role: ContentRole | None,
    ) -> tuple[AccessMode, ContentRole | None]:
        """Resolve effective `(mode, baseline)` using org defaults when NULL."""
        checker = PermissionChecker(self._session)
        default_mode, default_baseline = await checker.get_org_defaults(
            organization_id,
            content_type,
        )
        return resolve_effective_policy(
            raw_access_mode,
            raw_baseline_role,
            default_mode,
            default_baseline,
        )

    async def get_attachments_folder_id(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> UUID | None:
        """Return the user's Attachments folder ID, or None when missing."""
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

    async def attach_file(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
        source_file_id: UUID,
    ) -> Attachment:
        """Attach a file to content; reuses or copies into the Attachments folder."""
        source_file = await self._get_accessible_file(user_id, organization_id, source_file_id)
        if not source_file:
            raise NotFoundError("File", str(source_file_id))

        target_policy = await AttachmentTargetAccess(self._session).require_edit(
            user_id,
            organization_id,
            content_type,
            content_id,
        )
        parent_mode, parent_baseline = await self._resolve_parent_effective(
            organization_id,
            target_policy.content_type,
            target_policy.access_mode,
            target_policy.baseline_role,
        )

        # Org-wide parent -> org Attachments folder + OPEN_TO_ORG/EDITOR file.
        # Otherwise -> attacher's personal folder, OWNER_ONLY.
        if parent_mode == AccessMode.OPEN_TO_ORG:
            folder = await self.get_or_create_org_attachments_folder(organization_id)
            file_access_mode = AccessMode.OPEN_TO_ORG
            file_baseline_role = parent_baseline or ContentRole.EDITOR
        else:
            folder = await self.get_or_create_attachments_folder(user_id, organization_id)
            file_access_mode = AccessMode.OWNER_ONLY
            file_baseline_role = None

        # A staged upload is linked in place, never copied: the editor/composer
        # already embedded ITS id in the content, so the id the readers resolve
        # must be the id the attachment protects. Copying leaves the content
        # pointing at an unprotected leftover. Anything else (reuse of a real
        # Files-area file, or a staged file another attachment already claimed -
        # file_id is unique) gets a private copy so the original lives on.
        if await self._can_link_in_place(source_file, user_id):
            file_to_link = source_file
            await self._apply_attachment_policy(
                file_to_link,
                target_folder_id=folder.id,
                access_mode=file_access_mode,
                baseline_role=file_baseline_role,
            )
        else:
            file_to_link = await self._copy_file_to_folder(
                source_file=source_file,
                target_folder_id=folder.id,
                user_id=user_id,
                organization_id=organization_id,
                access_mode=file_access_mode,
                baseline_role=file_baseline_role,
            )

        attachment = Attachment(
            organization_id=organization_id,
            file_id=file_to_link.id,
            source_file_id=source_file.id,
            content_type=content_type,
            content_id=content_id,
            attached_by_user_id=user_id,
        )
        self._session.add(attachment)
        await self._session.flush()
        await self._session.refresh(attachment)

        return attachment

    async def _can_link_in_place(self, source_file: File, user_id: UUID) -> bool:
        """Staged upload owned by the attacher, still unclaimed by any attachment."""
        if source_file.owner_id != user_id:
            return False
        if source_file.folder_id is None:
            return False
        folder = (
            await self._session.execute(select(Folder).where(Folder.id == source_file.folder_id))
        ).scalar_one_or_none()
        if not is_attachment_staging_folder(folder):
            return False
        claimed = (
            await self._session.execute(
                select(Attachment.id).where(Attachment.file_id == source_file.id).limit(1)
            )
        ).first()
        return claimed is None

    async def _apply_attachment_policy(
        self,
        file: File,
        target_folder_id: UUID,
        access_mode: AccessMode,
        baseline_role: ContentRole | None,
    ) -> None:
        """Move a linked file under its attachment policy; index org-wide ones."""
        file.folder_id = target_folder_id
        file.access_mode = access_mode
        file.baseline_role = baseline_role
        await self._session.flush()

        # Staged uploads carry no search document; the attach creates one so
        # mention chips resolve a preview. Its access fields keep the doc out
        # of other users' candidates - authorization stays with PostgreSQL.
        await self._index_attachment_file(file)

    async def _index_attachment_file(self, file: File) -> None:
        from uniffy.domains.files.operations import FileOperations

        await FileOperations(self._session)._index_for_search(
            model=file,
            skip_member_lookup=True,
        )

    async def detach_file(
        self,
        user_id: UUID,
        organization_id: UUID,
        attachment_id: UUID,
    ) -> bool:
        """Detach a file from content and delete the underlying file copy."""
        result = await self._session.execute(
            select(Attachment).where(
                Attachment.id == attachment_id,
                Attachment.organization_id == organization_id,
            )
        )
        attachment = result.scalar_one_or_none()
        if not attachment:
            raise NotFoundError("Attachment", str(attachment_id))

        if attachment.attached_by_user_id == user_id:
            await self._verify_content_access(
                user_id,
                organization_id,
                attachment.content_type,
                attachment.content_id,
            )
        else:
            await self._verify_content_edit_access(
                user_id,
                organization_id,
                attachment.content_type,
                attachment.content_id,
            )

        await self._delete_attachment(attachment)
        return True

    async def _delete_attachment(self, attachment: Attachment) -> None:
        file_result = await self._session.execute(select(File).where(File.id == attachment.file_id))
        file = file_result.scalar_one_or_none()

        if file:
            await self._s3.delete_object(file.storage_key)

            versions_result = await self._session.execute(
                select(FileVersion).where(FileVersion.file_id == file.id)
            )
            for version in versions_result.scalars().all():
                if version.storage_key != file.storage_key:
                    await self._s3.delete_object(version.storage_key)
                await self._session.delete(version)

            file.current_version_id = None
            await self._session.flush()

            file_owner = file.owner_id
            file_org = file.organization_id
            file_size = file.size_bytes
            await self._session.delete(file)

            from uniffy.core.search.indexer import SearchIndexer

            urn = f"urn:uniffy:content:{ContentType.FILE.value}:{attachment.file_id}"
            await SearchIndexer(self._session).remove(urn)

            # A linked staged upload was quota-counted at complete_upload;
            # copies never were, so only the linked shape decrements.
            if attachment.source_file_id == attachment.file_id:
                from uniffy.domains.files.quota_operations import QuotaOperations

                try:
                    await QuotaOperations(self._session).decrement_usage(
                        organization_id=file_org,
                        user_id=file_owner,
                        bytes_delta=file_size,
                        file_count_delta=1,
                    )
                except Exception:
                    logger.opt(exception=True).warning(
                        "Failed to decrement storage usage on detach",
                        file_id=str(attachment.file_id),
                    )

        await self._session.delete(attachment)
        await self._session.flush()

    async def detach_all_for_content(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
    ) -> int:
        """Detach every file after one authoritative parent edit check."""
        await self._verify_content_edit_access(
            user_id,
            organization_id,
            content_type,
            content_id,
        )
        result = await self._session.execute(
            select(Attachment).where(
                Attachment.organization_id == organization_id,
                Attachment.content_type == content_type,
                Attachment.content_id == content_id,
            )
        )
        attachments = list(result.scalars().all())

        for attachment in attachments:
            await self._delete_attachment(attachment)

        return len(attachments)

    async def reconcile_inline_attachments(
        self,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
        referenced_file_ids: set[UUID],
    ) -> int:
        """Detach editor uploads their parent's content no longer references.

        Only attachments that own their staged upload (``source_file_id ==
        file_id``) are eligible - those exist purely as inline media. Copies
        made from picked existing files stay until explicitly detached.
        """
        result = await self._session.execute(
            select(Attachment).where(
                Attachment.organization_id == organization_id,
                Attachment.content_type == content_type,
                Attachment.content_id == content_id,
            )
        )
        removed = 0
        for attachment in result.scalars().all():
            if attachment.source_file_id != attachment.file_id:
                continue
            if attachment.file_id in referenced_file_ids:
                continue
            await self._delete_attachment(attachment)
            removed += 1
        return removed

    async def purge_attachments_for_content(
        self,
        organization_id: UUID,
        content_type: ContentType,
        content_ids: list[UUID],
    ) -> int:
        """Delete attachments (rows, files, bytes) for parents being destroyed.

        No actor gate: the caller already authorized the parent delete, and the
        parent row may be gone by the time this runs.
        """
        if not content_ids:
            return 0
        deleted = 0
        for start in range(0, len(content_ids), 200):
            batch = content_ids[start : start + 200]
            result = await self._session.execute(
                select(Attachment).where(
                    Attachment.organization_id == organization_id,
                    Attachment.content_type == content_type,
                    Attachment.content_id.in_(batch),
                )
            )
            for attachment in result.scalars().all():
                await self._delete_attachment(attachment)
                deleted += 1
        return deleted

    async def list_attachments(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
    ) -> list[tuple[Attachment, File, User | None]]:
        """List all attachments for a content row as `(attachment, file, owner)`."""
        await self._verify_content_access(user_id, organization_id, content_type, content_id)

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

    async def viewable_source_file_ids(
        self,
        user_id: UUID,
        organization_id: UUID,
        attachments: list[Attachment],
    ) -> set[UUID]:
        """Subset of the attachments' ``source_file_id``s this reader may view.

        ``source_file_id`` points at the ORIGINAL file, which is checked against
        the attacher's access at write time and never the reader's - echoing it
        unconditionally tells a reader the id of a file they cannot open. One
        query for the whole page keeps the batched list path batched.
        """
        source_ids = {a.source_file_id for a in attachments if a.source_file_id}
        if not source_ids:
            return set()

        decisions = await ResourceAccessResolver(self._session).resolve(
            actor_id=user_id,
            organization_id=organization_id,
            keys=[ResourceKey(ContentType.FILE, file_id) for file_id in source_ids],
            purpose=ResourceAccessPurpose.LIST,
        )
        return {key.content_id for key, decision in decisions.items() if decision.can_view}

    async def batch_list_attachments(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_ids: list[UUID],
    ) -> dict[UUID, list[tuple[Attachment, File, User | None]]]:
        """Batched attachment list for an authorized content page."""
        if not content_ids:
            return {}
        content_ids = content_ids[:200]

        keys = [ResourceKey(content_type, content_id) for content_id in content_ids]
        decisions = await ResourceAccessResolver(self._session).resolve(
            actor_id=user_id,
            organization_id=organization_id,
            keys=keys,
            purpose=ResourceAccessPurpose.LIST,
        )
        accessible_ids = [key.content_id for key in keys if decisions[key].can_view]

        if not accessible_ids:
            return {}

        result = await self._session.execute(
            select(Attachment, File, User)
            .join(File, Attachment.file_id == File.id)
            .outerjoin(User, File.owner_id == User.id)
            .where(
                Attachment.organization_id == organization_id,
                Attachment.content_type == content_type,
                Attachment.content_id.in_(accessible_ids),
            )
            .order_by(Attachment.attached_at.desc())
        )

        grouped: dict[UUID, list[tuple[Attachment, File, User | None]]] = {}
        for row in result.all():
            attachment = row[0]
            grouped.setdefault(attachment.content_id, []).append((attachment, row[1], row[2]))
        return grouped

    async def can_access_attachment(
        self,
        user_id: UUID,
        organization_id: UUID,
        attachment_id: UUID,
    ) -> bool:
        """Check if user can access an attachment via its parent content."""
        result = await self._session.execute(
            select(Attachment).where(
                Attachment.id == attachment_id,
                Attachment.organization_id == organization_id,
            )
        )
        attachment = result.scalar_one_or_none()
        if not attachment:
            return False

        try:
            await self._verify_content_access(
                user_id,
                organization_id,
                attachment.content_type,
                attachment.content_id,
            )
            return True
        except PermissionDeniedError, NotFoundError:
            return False

    async def can_view_file_via_attachment(
        self,
        user_id: UUID,
        organization_id: UUID,
        file_id: UUID,
    ) -> bool:
        """True when `file_id` is an attachment whose parent content the user can view.

        The asset read path uses this so viewing a note/event/task/channel grants
        read access to the files attached to it - the file copy stays in the owner's
        private folder, but access is derived from the parent (and revoked with it).
        """
        result = await self._session.execute(
            select(Attachment.content_type, Attachment.content_id).where(
                Attachment.file_id == file_id,
                Attachment.organization_id == organization_id,
            )
        )
        row = result.one_or_none()
        if not row:
            return False

        try:
            await self._verify_content_access(user_id, organization_id, row[0], row[1])
            return True
        except PermissionDeniedError, NotFoundError:
            return False

    async def _get_accessible_file(
        self,
        user_id: UUID,
        organization_id: UUID,
        file_id: UUID,
    ) -> File | None:
        """Return the file if accessible, with `media_info` eager-loaded."""
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

        key = ResourceKey(ContentType.FILE, file_id)
        decision = (
            await ResourceAccessResolver(self._session).resolve(
                actor_id=user_id,
                organization_id=organization_id,
                keys=[key],
                purpose=ResourceAccessPurpose.REFERENCE,
            )
        )[key]
        return file if decision.can_view else None

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
        new_file_id = generate_id()
        new_storage_key = f"{organization_id}/{user_id}/{new_file_id}/{source_file.filename}"

        await self._s3.copy_object(
            source_key=source_file.storage_key,
            destination_key=new_storage_key,
            content_type=source_file.mime_type,
        )

        extraction_status = ExtractionStatus.SKIPPED
        new_media_info: FileMediaInfo | None = None
        source_info = source_file.media_info

        if (
            source_file.extraction_status == ExtractionStatus.COMPLETED
            and source_info
            and source_info.thumbnail_key
        ):
            new_thumb_key = f"{organization_id}/thumbnails/{new_file_id}.jpg"

            try:
                await self._s3.copy_object(
                    source_key=source_info.thumbnail_key,
                    destination_key=new_thumb_key,
                    content_type="image/jpeg",
                )
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
            description=source_file.description,
            extraction_status=extraction_status,
        )
        self._session.add(new_file)
        await self._session.flush()

        if new_media_info:
            self._session.add(new_media_info)
            await self._session.flush()

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

        if extraction_status == ExtractionStatus.PENDING:
            await self._enqueue_processing_jobs(new_file)

        await self._index_attachment_file(new_file)

        return new_file

    async def _enqueue_processing_jobs(self, file: File) -> None:
        jobs = get_jobs_for_mime_type(file.mime_type or "")
        if not jobs:
            return

        try:
            queue = get_queue(QueueName.CORE)
            for job_name in jobs:
                await queue.enqueue_job(
                    job_name,
                    str(file.id),
                    str(file.organization_id),
                )
                logger.debug(f"Enqueued {job_name} for attachment file {file.id}")
        except RuntimeError as e:
            # Queue not available; file stays PENDING.
            logger.warning(f"Could not enqueue jobs for attachment {file.id}: {e}")

    async def _verify_content_access(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
    ) -> None:
        key = ResourceKey(content_type, content_id)
        decision = (
            await ResourceAccessResolver(self._session).resolve(
                actor_id=user_id,
                organization_id=organization_id,
                keys=[key],
                purpose=ResourceAccessPurpose.REFERENCE,
            )
        )[key]
        if decision.row_state != ResourceRowState.LIVE:
            raise NotFoundError(content_type.value, str(content_id))
        if not decision.can_view:
            raise PermissionDeniedError("access", "content")

    async def _verify_content_edit_access(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
    ) -> None:
        await AttachmentTargetAccess(self._session).require_edit(
            user_id,
            organization_id,
            content_type,
            content_id,
        )
