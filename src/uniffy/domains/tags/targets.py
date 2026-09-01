from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import NotFoundError
from uniffy.core.models.chat.message import ChatMessage
from uniffy.core.types import ContentType
from uniffy.domains.agents.agents.operations import AgentOperations
from uniffy.domains.chat.access import ChatAccessChecker
from uniffy.domains.files.operations import FileOperations, FolderOperations
from uniffy.domains.notes.reader import NoteReader
from uniffy.domains.projects.operations import ProjectOperations, TaskReader
from uniffy.domains.scheduling.calendar.operations import CalendarEventReader
from uniffy.domains.scheduling.rooms.lifecycle import RoomOperations


class TagTargetAccess:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def require_edit(
        self,
        actor_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
    ) -> None:
        operations_by_type = {
            ContentType.FILE: FileOperations,
            ContentType.PROJECT: ProjectOperations,
            ContentType.AGENT: AgentOperations,
            ContentType.ROOM: RoomOperations,
        }
        operations_type = operations_by_type.get(content_type)
        if content_type == ContentType.NOTE:
            await NoteReader(self.session).get_for_edit(
                actor_id,
                organization_id,
                content_id,
            )
            return
        if content_type == ContentType.TASK:
            await TaskReader(self.session).get_for_edit(
                actor_id,
                organization_id,
                content_id,
            )
            return
        if content_type == ContentType.CALENDAR_EVENT:
            await CalendarEventReader(self.session).get_for_edit(
                actor_id,
                organization_id,
                content_id,
            )
            return
        if operations_type is not None:
            await operations_type(self.session).get_for_edit(
                actor_id,
                organization_id,
                content_id,
            )
            return

        if content_type == ContentType.FOLDER:
            operations = FolderOperations(self.session)
            folder = await operations.get_by_id(content_id, organization_id)
            if folder is None or folder.is_deleted:
                raise NotFoundError("Folder", content_id)
            await operations.require_edit(actor_id, organization_id, folder)
            return

        if content_type in (ContentType.CHAT, ContentType.CHAT_MESSAGE):
            await self._require_chat_send(
                actor_id,
                organization_id,
                content_type,
                content_id,
            )
            return

        raise NotFoundError("Content", content_id)

    async def _require_chat_send(
        self,
        actor_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
    ) -> None:
        channel_id = content_id
        if content_type == ContentType.CHAT_MESSAGE:
            channel_id = (
                await self.session.execute(
                    select(ChatMessage.channel_id).where(
                        ChatMessage.id == content_id,
                        ChatMessage.is_deleted.is_(False),
                    )
                )
            ).scalar_one_or_none()
            if channel_id is None:
                raise NotFoundError("ChatMessage", content_id)
        access = ChatAccessChecker(self.session)
        channel = await access.get_channel(channel_id, organization_id)
        await access.require_send(actor_id, channel)
