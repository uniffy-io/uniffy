from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models.chat.channel import ChannelType
from uniffy.core.models.chat.message import ChatMessage
from uniffy.core.models.projects.project import Project
from uniffy.core.types import AccessMode, ContentRole, ContentType
from uniffy.domains.calendar.operations import CalendarEventOperations
from uniffy.domains.chat.access import ChatAccessChecker
from uniffy.domains.files.operations import FileOperations
from uniffy.domains.notes.operations import NoteOperations
from uniffy.domains.projects.operations import ProjectOperations, TaskOperations


@dataclass(frozen=True, slots=True)
class AttachmentTargetPolicy:
    content_type: ContentType
    access_mode: AccessMode | None
    baseline_role: ContentRole | None


class AttachmentTargetAccess:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def require_edit(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
    ) -> AttachmentTargetPolicy:
        if content_type == ContentType.NOTE:
            note = await NoteOperations(self.session).get_for_edit(
                user_id, organization_id, content_id
            )
            return AttachmentTargetPolicy(content_type, note.access_mode, note.baseline_role)

        if content_type == ContentType.FILE:
            file = await FileOperations(self.session).get_for_edit(
                user_id, organization_id, content_id
            )
            return AttachmentTargetPolicy(content_type, file.access_mode, file.baseline_role)

        if content_type == ContentType.CALENDAR_EVENT:
            event = await CalendarEventOperations(self.session).get_for_edit(
                user_id, organization_id, content_id
            )
            return AttachmentTargetPolicy(content_type, event.access_mode, event.baseline_role)

        if content_type == ContentType.PROJECT:
            project = await ProjectOperations(self.session).get_for_edit(
                user_id, organization_id, content_id
            )
            return AttachmentTargetPolicy(content_type, project.access_mode, project.baseline_role)

        if content_type == ContentType.TASK:
            task = await TaskOperations(self.session).get_for_edit(
                user_id, organization_id, content_id
            )
            project = await self.session.get(Project, task.project_id)
            if project is None or project.is_deleted:
                raise NotFoundError("Project", str(task.project_id))
            return AttachmentTargetPolicy(
                ContentType.PROJECT,
                project.access_mode,
                project.baseline_role,
            )

        if content_type == ContentType.CHAT_MESSAGE:
            return await self._require_chat_message_edit(
                user_id,
                organization_id,
                content_id,
            )

        raise NotFoundError("Content", str(content_id))

    async def _require_chat_message_edit(
        self,
        user_id: UUID,
        organization_id: UUID,
        message_id: UUID,
    ) -> AttachmentTargetPolicy:
        row = (
            await self.session.execute(
                select(ChatMessage.channel_id, ChatMessage.sender_id).where(
                    ChatMessage.id == message_id,
                    ChatMessage.is_deleted.is_(False),
                )
            )
        ).one_or_none()
        if not row:
            raise NotFoundError("ChatMessage", str(message_id))

        checker = ChatAccessChecker(self.session)
        channel = await checker.get_channel(row.channel_id, organization_id)
        await checker.check_access(user_id, organization_id, channel)
        if row.sender_id != user_id:
            is_elevated = await checker.require_elevated(
                user_id,
                organization_id,
                channel.id,
            )
            if not is_elevated:
                raise PermissionDeniedError("edit", "chat message")

        if channel.channel_type == ChannelType.PUBLIC:
            return AttachmentTargetPolicy(
                ContentType.CHAT,
                AccessMode.OPEN_TO_ORG,
                ContentRole.VIEWER,
            )
        return AttachmentTargetPolicy(ContentType.CHAT, AccessMode.OWNER_ONLY, None)
