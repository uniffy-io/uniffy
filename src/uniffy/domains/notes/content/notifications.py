"""Note sharing and mention notifications."""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID

from uniffy.core.content.team_mentions import expand_team_mentions
from uniffy.core.events import (
    NotificationEvent,
    emit_notification,
    extract_mentioned_team_ids,
    extract_mentioned_user_ids,
)
from uniffy.core.models.notes.note import Note
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import ContentType, NotificationType

if TYPE_CHECKING:
    from uniffy.domains.notes.operations import NoteOperations


class NoteNotifications:
    def __init__(self, operations: NoteOperations) -> None:
        self.operations = operations

    async def notify_new_mentions(
        self,
        user_id: UUID,
        organization_id: UUID,
        note: Note,
        old_refs: list[str] | None,
        writer_id: UUID | None = None,
    ) -> None:
        new_mentioned = extract_mentioned_user_ids(note.outgoing_references)
        if writer_id is not None:
            new_mentioned.discard(writer_id)
        if old_refs is not None:
            new_mentioned -= extract_mentioned_user_ids(old_refs)

        source_urn = build_content_urn(ContentType.NOTE, note.id)
        if new_mentioned:
            await emit_notification(
                NotificationEvent(
                    notification_type=NotificationType.CONTENT_MENTIONED,
                    organization_id=organization_id,
                    actor_id=user_id,
                    title=f"Mentioned you in: {note.title}",
                    source_urn=source_urn,
                    target_user_ids=list(new_mentioned),
                )
            )

        new_teams = extract_mentioned_team_ids(note.outgoing_references)
        if old_refs is not None:
            already_mentioned = set(extract_mentioned_team_ids(old_refs))
            new_teams = [team_id for team_id in new_teams if team_id not in already_mentioned]
        if not new_teams:
            return

        notified = set(new_mentioned)
        if writer_id is not None:
            notified.add(writer_id)
        for expansion in await expand_team_mentions(
            self.operations.session,
            organization_id,
            new_teams,
        ):
            targets = [user_id for user_id in expansion.member_ids if user_id not in notified]
            if not targets:
                continue
            await emit_notification(
                NotificationEvent(
                    notification_type=NotificationType.CONTENT_MENTIONED,
                    organization_id=organization_id,
                    actor_id=user_id,
                    title=f"Mentioned {expansion.name} in: {note.title}",
                    source_urn=source_urn,
                    target_user_ids=targets,
                    metadata={
                        "team_id": str(expansion.team_id),
                        "team_name": expansion.name,
                    },
                )
            )
            notified.update(targets)

    async def emit_shared(
        self,
        user_id: UUID,
        organization_id: UUID,
        note: Note,
    ) -> None:
        await emit_notification(
            NotificationEvent(
                notification_type=NotificationType.CONTENT_SHARED,
                organization_id=organization_id,
                actor_id=user_id,
                title=f"Shared note: {note.title}",
                source_urn=build_content_urn(ContentType.NOTE, note.id),
                content_type=ContentType.NOTE,
                content_id=note.id,
            )
        )
