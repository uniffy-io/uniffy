"""Note access-policy transitions."""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID

from uniffy.core.errors import NotFoundError
from uniffy.core.models.notes.note import Note
from uniffy.core.types import AccessMode, ContentRole, ContentType, SubjectType
from uniffy.domains.permissions.members import ContentMembersOperations

if TYPE_CHECKING:
    from uniffy.domains.notes.operations import NoteOperations


class NoteSharing:
    def __init__(self, operations: NoteOperations) -> None:
        self.operations = operations

    async def move(
        self,
        user_id: UUID,
        organization_id: UUID,
        note_id: UUID,
        target_access_mode: AccessMode | None,
        target_baseline_role: ContentRole | None = None,
        target_group_ids: list[UUID] | None = None,
    ) -> Note:
        members = ContentMembersOperations(self.operations.session)
        await members.set_access_mode(
            actor_user_id=user_id,
            organization_id=organization_id,
            content_type=ContentType.NOTE,
            content_id=note_id,
            new_access_mode=target_access_mode,
            new_baseline_role=target_baseline_role,
            remove_members_on_narrow=False,
        )
        for group_id in target_group_ids or []:
            await members.add_member(
                actor_user_id=user_id,
                organization_id=organization_id,
                content_type=ContentType.NOTE,
                content_id=note_id,
                subject_type=SubjectType.GROUP,
                subject_id=group_id,
                role=ContentRole.VIEWER,
            )

        note = await self.operations._fetch_by_id(note_id, organization_id)
        if note is None:
            raise NotFoundError("Note", note_id)
        effective_mode, _ = await self.operations._effective_policy(organization_id, note)
        if effective_mode != AccessMode.OWNER_ONLY:
            await self.operations._emit_shared_notification(user_id, organization_id, note)
        return note
