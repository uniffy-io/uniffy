from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import NotFoundError
from uniffy.core.types import ContentType
from uniffy.domains.calendar.operations import CalendarEventOperations
from uniffy.domains.files.operations import FileOperations
from uniffy.domains.notes.operations import NoteOperations
from uniffy.domains.projects.operations import ProjectOperations, TaskOperations


class CommentTargetAccess:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def require_view(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
    ) -> None:
        if content_type == ContentType.NOTE:
            await NoteOperations(self.session).get_by_id(user_id, organization_id, content_id)
            return
        if content_type == ContentType.FILE:
            await FileOperations(self.session).get_by_id(user_id, organization_id, content_id)
            return
        if content_type == ContentType.CALENDAR_EVENT:
            await CalendarEventOperations(self.session).get_by_id(
                user_id, organization_id, content_id
            )
            return
        if content_type == ContentType.PROJECT:
            await ProjectOperations(self.session).get_by_id(user_id, organization_id, content_id)
            return
        if content_type == ContentType.TASK:
            await TaskOperations(self.session).get_by_id(user_id, organization_id, content_id)
            return
        raise NotFoundError("Content", str(content_id))

    async def require_comment(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
    ) -> None:
        if content_type == ContentType.NOTE:
            await NoteOperations(self.session).get_for_comment(user_id, organization_id, content_id)
            return
        if content_type == ContentType.FILE:
            await FileOperations(self.session).get_for_comment(user_id, organization_id, content_id)
            return
        if content_type == ContentType.CALENDAR_EVENT:
            await CalendarEventOperations(self.session).get_for_comment(
                user_id, organization_id, content_id
            )
            return
        if content_type == ContentType.PROJECT:
            await ProjectOperations(self.session).get_for_comment(
                user_id, organization_id, content_id
            )
            return
        if content_type == ContentType.TASK:
            await TaskOperations(self.session).get_for_comment(user_id, organization_id, content_id)
            return
        raise NotFoundError("Content", str(content_id))

    async def require_edit(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
    ) -> None:
        if content_type == ContentType.NOTE:
            await NoteOperations(self.session).get_for_edit(user_id, organization_id, content_id)
            return
        if content_type == ContentType.FILE:
            await FileOperations(self.session).get_for_edit(user_id, organization_id, content_id)
            return
        if content_type == ContentType.CALENDAR_EVENT:
            await CalendarEventOperations(self.session).get_for_edit(
                user_id, organization_id, content_id
            )
            return
        if content_type == ContentType.PROJECT:
            await ProjectOperations(self.session).get_for_edit(user_id, organization_id, content_id)
            return
        if content_type == ContentType.TASK:
            await TaskOperations(self.session).get_for_edit(user_id, organization_id, content_id)
            return
        raise NotFoundError("Content", str(content_id))
