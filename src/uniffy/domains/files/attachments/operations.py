"""Attachment operations for linking files to content."""

from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from uniffy.core.auth.permissions import role_can_edit, role_can_view
from uniffy.core.auth.permissions.queries import ContentAccessQuery
from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models.files.attachment import Attachment
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

logger = logger.bind(component="attachments.operations")

ATTACHMENTS_FOLDER_NAME = "Attachments"
ORG_ATTACHMENTS_FOLDER_NAME = "Organization Attachments"


class AttachmentOperations:
    """Link files to content; manages file copies in the Attachments folder."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._access_query = ContentAccessQuery(session)
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

        from uniffy.core.models.login.organization_member import (
            OrganizationMember,
            OrganizationRole,
        )

        # FK owner is nominal; pick highest-ranking active member so the
        # FK survives deactivation of the original creator.
        members = (
            await self._session.execute(
                select(OrganizationMember.user_id, OrganizationMember.role)
                .where(
                    OrganizationMember.organization_id == organization_id,
                    OrganizationMember.is_active == True,  # noqa: E712
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
        from uniffy.core.auth.permissions import resolve_effective_policy
        from uniffy.core.auth.permissions.checker import PermissionChecker

        checker = PermissionChecker(self._session)
        default_mode, default_baseline = await checker.get_org_defaults(
            organization_id, content_type,
        )
        return resolve_effective_policy(
            raw_access_mode, raw_baseline_role, default_mode, default_baseline,
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

        await self._verify_content_access(user_id, organization_id, content_type, content_id)

        _, parent_mode_raw, parent_baseline_raw, parent_type, _ = (
            await self._load_parent_policy(organization_id, content_type, content_id)
        )
        parent_mode, parent_baseline = await self._resolve_parent_effective(
            organization_id, parent_type, parent_mode_raw, parent_baseline_raw,
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

        if source_file.folder_id == folder.id and (
            parent_mode == AccessMode.OPEN_TO_ORG or source_file.owner_id == user_id
        ):
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

        if attachment.attached_by_user_id != user_id:
            await self._verify_content_edit_access(
                user_id,
                organization_id,
                attachment.content_type,
                attachment.content_id,
            )

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
            await self._session.delete(file)

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
        """Detach all files from a piece of content; called on content delete."""
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

    async def batch_list_attachments(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_ids: list[UUID],
    ) -> dict[UUID, list[tuple[Attachment, File, User | None]]]:
        """Batched attachment list for N content rows in a single SQL round-trip.

        Chat messages share the channel access check across the batch;
        other types fall back to per-row verification.
        """
        if not content_ids:
            return {}
        content_ids = content_ids[:200]

        accessible_ids: list[UUID] = []
        if content_type == ContentType.CHAT_MESSAGE:
            from uniffy.core.models.chat.message import ChatMessage
            from uniffy.domains.chat.access import ChatAccessChecker

            msg_rows = await self._session.execute(
                select(ChatMessage.id, ChatMessage.channel_id).where(
                    ChatMessage.id.in_(content_ids),
                    ChatMessage.is_deleted == False,  # noqa: E712
                )
            )
            messages_by_channel: dict[UUID, list[UUID]] = {}
            for mid, cid in msg_rows.all():
                messages_by_channel.setdefault(cid, []).append(mid)

            checker = ChatAccessChecker(self._session)
            for channel_id, message_ids in messages_by_channel.items():
                try:
                    channel = await checker.get_channel(channel_id, organization_id)
                    await checker.check_access(user_id, organization_id, channel)
                    accessible_ids.extend(message_ids)
                except (NotFoundError, PermissionDeniedError):
                    continue
        else:
            for cid in content_ids:
                try:
                    role = await self._resolve_parent_role(
                        user_id, organization_id, content_type, cid
                    )
                    if role_can_view(role):
                        accessible_ids.append(cid)
                except NotFoundError:
                    continue

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
            grouped.setdefault(attachment.content_id, []).append(
                (attachment, row[1], row[2])
            )
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
        except PermissionDeniedError:
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
        except (PermissionDeniedError, NotFoundError):
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

        return new_file

    async def _enqueue_processing_jobs(self, file: File) -> None:
        from uniffy.core.valkey import get_queue

        jobs = get_jobs_for_mime_type(file.mime_type or "")
        if not jobs:
            return

        try:
            queue = get_queue("core")
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

    async def _verify_chat_message_access(
        self,
        user_id: UUID,
        organization_id: UUID,
        message_id: UUID,
        require_sender: bool = False,
    ) -> None:
        """Delegate chat-message access to `ChatAccessChecker`.

        `require_sender=True` additionally demands sender or elevated role
        (used for edit operations like detaching files).
        """
        from uniffy.core.models.chat.message import ChatMessage
        from uniffy.domains.chat.access import ChatAccessChecker

        result = await self._session.execute(
            select(ChatMessage.channel_id, ChatMessage.sender_id).where(
                ChatMessage.id == message_id,
                ChatMessage.is_deleted == False,  # noqa: E712
            )
        )
        row = result.one_or_none()
        if not row:
            raise NotFoundError("ChatMessage", str(message_id))

        channel_id, sender_id = row[0], row[1]
        checker = ChatAccessChecker(self._session)
        channel = await checker.get_channel(channel_id, organization_id)
        await checker.check_access(user_id, organization_id, channel)

        if require_sender and sender_id != user_id:
            is_elevated = await checker.require_elevated(user_id, organization_id, channel.id)
            if not is_elevated:
                raise PermissionDeniedError("edit", "chat message")

    async def _load_parent_policy(
        self,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
    ) -> tuple[UUID, AccessMode, ContentRole | None, ContentType, UUID]:
        """Load `(owner_id, access_mode, baseline_role, type, id)` for a parent.

        Tasks resolve to their parent project for the checker.
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
                select(Project.owner_id, Project.access_mode, Project.baseline_role).where(
                    Project.id == project_id,
                    Project.organization_id == organization_id,
                )
            )
            proj_row = proj_result.one_or_none()
            if not proj_row:
                raise NotFoundError("Project", str(project_id))
            return proj_row[0], proj_row[1], proj_row[2], ContentType.PROJECT, project_id

        if content_type == ContentType.CHAT_MESSAGE:
            from uniffy.core.models.chat.channel import ChannelType, ChatChannel
            from uniffy.core.models.chat.message import ChatMessage

            msg_result = await self._session.execute(
                select(ChatMessage.channel_id).where(
                    ChatMessage.id == content_id,
                )
            )
            channel_id = msg_result.scalar_one_or_none()
            if not channel_id:
                raise NotFoundError("ChatMessage", str(content_id))

            ch_result = await self._session.execute(
                select(ChatChannel.owner_id, ChatChannel.channel_type).where(
                    ChatChannel.id == channel_id,
                    ChatChannel.organization_id == organization_id,
                )
            )
            ch_row = ch_result.one_or_none()
            if not ch_row:
                raise NotFoundError("ChatChannel", str(channel_id))

            # PUBLIC channels inherit OPEN_TO_ORG so inline previews work for
            # everyone; private/DM stays OWNER_ONLY and relies on channel
            # membership via _verify_chat_message_access.
            if ch_row[1] == ChannelType.PUBLIC:
                return (
                    ch_row[0],
                    AccessMode.OPEN_TO_ORG,
                    ContentRole.VIEWER,
                    ContentType.CHAT,
                    channel_id,
                )
            return ch_row[0], AccessMode.OWNER_ONLY, None, ContentType.CHAT, channel_id

        raise NotFoundError("Content", str(content_id))

    async def _resolve_parent_role(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
    ) -> ContentRole | None:
        from uniffy.core.auth.permissions.checker import PermissionChecker

        (
            owner_id,
            access_mode,
            baseline_role,
            resolved_type,
            resolved_id,
        ) = await self._load_parent_policy(organization_id, content_type, content_id)

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
        if content_type == ContentType.CHAT_MESSAGE:
            await self._verify_chat_message_access(user_id, organization_id, content_id)
            return
        role = await self._resolve_parent_role(user_id, organization_id, content_type, content_id)
        if not role_can_view(role):
            raise PermissionDeniedError("access", "content")

    async def _verify_content_edit_access(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
    ) -> None:
        if content_type == ContentType.CHAT_MESSAGE:
            await self._verify_chat_message_access(
                user_id, organization_id, content_id, require_sender=True
            )
            return
        role = await self._resolve_parent_role(user_id, organization_id, content_type, content_id)
        if not role_can_edit(role):
            raise PermissionDeniedError("edit", "content")
