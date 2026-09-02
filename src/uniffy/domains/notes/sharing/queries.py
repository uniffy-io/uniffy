"""Sharing presentation data for note responses."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import func, or_, select

from uniffy.core.models.login.group import Group
from uniffy.core.models.login.group_member import GroupMember
from uniffy.core.models.login.user import User
from uniffy.core.models.notes.note import Note
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.types import ContentRole, ContentType, SubjectType

if TYPE_CHECKING:
    from uniffy.domains.notes.operations import NoteOperations


@dataclass
class NoteSharingInfo:
    owner_info: dict | None = None
    shared_with: list[dict] | None = None


class NoteSharingQueries:
    def __init__(self, operations: NoteOperations) -> None:
        self.operations = operations

    async def get_notes_sharing_info(
        self,
        notes: list[Note],
        current_user_id: UUID,
    ) -> dict[UUID, NoteSharingInfo]:
        result: dict[UUID, NoteSharingInfo] = {}
        owned_notes = [note for note in notes if note.owner_id == current_user_id]
        shared_notes = [note for note in notes if note.owner_id != current_user_id]

        if shared_notes:
            owners = await self.load_owners({note.owner_id for note in shared_notes})
            for note in shared_notes:
                result[note.id] = NoteSharingInfo(
                    owner_info=self.owner_info_dict(note.owner_id, owners.get(note.owner_id))
                )

        if owned_notes:
            members_by_note = await self.load_members_by_note([note.id for note in owned_notes])
            user_lookup, group_lookup, group_counts = await self.load_subject_lookups(
                members_by_note
            )
            for note in owned_notes:
                shared_with = self.build_shared_with(
                    members_by_note.get(note.id, []),
                    user_lookup,
                    group_lookup,
                    group_counts,
                )
                result[note.id] = NoteSharingInfo(shared_with=shared_with or None)
        return result

    async def load_owners(self, owner_ids: set[UUID]) -> dict[UUID, User]:
        if not owner_ids:
            return {}
        result = await self.operations.session.execute(select(User).where(User.id.in_(owner_ids)))
        return {user.id: user for user in result.scalars().all()}

    @staticmethod
    def owner_info_dict(owner_id: UUID, owner: User | None) -> dict | None:
        if owner is None:
            return None
        return {
            "id": str(owner_id),
            "name": owner.full_name or owner.username,
            "email": owner.email,
        }

    async def load_members_by_note(
        self,
        note_ids: list[UUID],
    ) -> dict[UUID, list[ContentMember]]:
        if not note_ids:
            return {}
        now = datetime.now(UTC)
        result = await self.operations.session.execute(
            select(ContentMember)
            .where(ContentMember.content_type == ContentType.NOTE)
            .where(ContentMember.content_id.in_(note_ids))
            .where(ContentMember.role != ContentRole.BLOCKED)
            .where(or_(ContentMember.expires_at.is_(None), ContentMember.expires_at > now))
        )
        members_by_note: dict[UUID, list[ContentMember]] = {note_id: [] for note_id in note_ids}
        for member in result.scalars().all():
            members_by_note[member.content_id].append(member)
        return members_by_note

    async def load_subject_lookups(
        self,
        members_by_note: dict[UUID, list[ContentMember]],
    ) -> tuple[dict[UUID, User], dict[UUID, Group], dict[UUID, int]]:
        user_ids: set[UUID] = set()
        group_ids: set[UUID] = set()
        for members in members_by_note.values():
            for member in members:
                if member.subject_type == SubjectType.USER:
                    user_ids.add(member.subject_id)
                elif member.subject_type == SubjectType.GROUP:
                    group_ids.add(member.subject_id)

        user_lookup: dict[UUID, User] = {}
        if user_ids:
            users = await self.operations.session.execute(select(User).where(User.id.in_(user_ids)))
            user_lookup = {user.id: user for user in users.scalars().all()}

        group_lookup: dict[UUID, Group] = {}
        group_counts: dict[UUID, int] = {}
        if group_ids:
            groups = await self.operations.session.execute(
                select(Group).where(Group.id.in_(group_ids))
            )
            group_lookup = {group.id: group for group in groups.scalars().all()}
            counts = await self.operations.session.execute(
                select(GroupMember.group_id, func.count(GroupMember.id).label("count"))
                .where(GroupMember.group_id.in_(group_ids))
                .where(GroupMember.is_active == True)  # noqa: E712
                .group_by(GroupMember.group_id)
            )
            group_counts = {row[0]: row[1] for row in counts.all()}
        return user_lookup, group_lookup, group_counts

    @staticmethod
    def build_shared_with(
        members: list[ContentMember],
        user_lookup: dict[UUID, User],
        group_lookup: dict[UUID, Group],
        group_counts: dict[UUID, int],
    ) -> list[dict]:
        shared_with: list[dict] = []
        for member in members:
            if member.subject_type == SubjectType.USER:
                user = user_lookup.get(member.subject_id)
                if user is None:
                    continue
                shared_with.append({
                    "id": str(user.id),
                    "type": "user",
                    "name": user.full_name or user.username,
                    "email": user.email,
                    "member_count": 0,
                    "role": member.role.value,
                })
            elif member.subject_type == SubjectType.GROUP:
                group = group_lookup.get(member.subject_id)
                if group is None:
                    continue
                shared_with.append({
                    "id": str(group.id),
                    "type": "group",
                    "name": group.name,
                    "email": "",
                    "member_count": group_counts.get(group.id, 0),
                    "role": member.role.value,
                })
        return shared_with
