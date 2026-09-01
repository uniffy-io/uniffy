"""Transactional note creation."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any
from uuid import UUID

from loguru import logger

from uniffy.core.models.notes.note import Note
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import AccessMode, ContentRole, ContentType, NodeType, SubjectType
from uniffy.domains.notes import queries
from uniffy.domains.notes.content.fields import extract_content_fields
from uniffy.domains.permissions.members import (
    ContentMembersOperations,
    StagedContentMemberAdd,
)
from uniffy.domains.tags.context import ContentTagMutations, StagedManualTagReplacement
from uniffy.domains.tags.sync import (
    StagedInlineTagSync,
    finish_inline_tags_after_commit,
    stage_inline_tags,
)

if TYPE_CHECKING:
    from uniffy.domains.notes.operations import NoteOperations

logger = logger.bind(component="notes.content.creation")


@dataclass(frozen=True)
class StagedNoteCreate:
    note: Note
    members: tuple[StagedContentMemberAdd, ...]
    manual_tags: StagedManualTagReplacement | None
    inline_tags: StagedInlineTagSync


class NoteCreation:
    def __init__(self, operations: NoteOperations) -> None:
        self.operations = operations

    async def create(
        self,
        user_id: UUID,
        organization_id: UUID,
        title: str,
        content: str = "",
        canvas_content: dict[str, Any] | None = None,
        slug: str | None = None,
        access_mode: AccessMode | None = None,
        baseline_role: ContentRole | None = None,
        node_type: NodeType = NodeType.NOTE,
        parent_id: UUID | None = None,
        tag_ids: list[UUID] | None = None,
        metadata: dict[str, Any] | None = None,
        group_ids: list[UUID] | None = None,
    ) -> Note:
        access_mode, baseline_role = await self.operations._resolve_access_policy(
            organization_id,
            access_mode,
            baseline_role,
        )
        slug = await self.unique_slug(slug or queries.slugify(title), organization_id)
        fields = extract_content_fields(node_type, content, canvas_content, organization_id)

        note = Note(
            organization_id=organization_id,
            owner_id=user_id,
            title=title,
            content=fields.content,
            canvas_content=fields.canvas_content,
            slug=slug,
            access_mode=access_mode,
            baseline_role=baseline_role,
            node_type=node_type,
            parent_id=parent_id,
            note_metadata=metadata,
            outgoing_references=fields.outgoing_references,
        )
        self.operations.session.add(note)
        staged_members: list[StagedContentMemberAdd] = []
        staged_manual_tags = None
        try:
            await self.operations.session.flush()
            members = ContentMembersOperations(
                self.operations.session,
                self.operations.search_indexer,
            )
            for group_id in group_ids or []:
                staged_members.append(
                    await members.stage_member(
                        actor_user_id=user_id,
                        organization_id=organization_id,
                        content_type=ContentType.NOTE,
                        content_id=note.id,
                        subject_type=SubjectType.GROUP,
                        subject_id=group_id,
                        role=ContentRole.VIEWER,
                    )
                )

            note_urn = build_content_urn(ContentType.NOTE, note.id)
            if tag_ids is not None:
                staged_manual_tags = await ContentTagMutations(
                    self.operations.session,
                    self.operations.search_indexer,
                ).stage_manual_tags(
                    actor_id=user_id,
                    organization_id=organization_id,
                    content_urn=note_urn,
                    tag_ids=tag_ids,
                )
            staged_inline_tags = await stage_inline_tags(
                self.operations.session,
                content_urn=note_urn,
                organization_id=organization_id,
                actor_id=user_id,
                parsed_names=fields.parsed_inline_tag_names,
            )
            await self.operations.session.commit()
        except Exception:
            await self.operations.session.rollback()
            raise
        await self.operations.session.refresh(note)

        await self.finish_after_commit(
            StagedNoteCreate(
                note,
                tuple(staged_members),
                staged_manual_tags,
                staged_inline_tags,
            )
        )
        return note

    async def finish_after_commit(self, staged: StagedNoteCreate) -> None:
        note = staged.note
        members = ContentMembersOperations(
            self.operations.session,
            self.operations.search_indexer,
        )
        for member in staged.members:
            try:
                await members.finish_member_add_after_commit(member)
            except Exception:
                logger.opt(exception=True).warning(
                    "Note created with degraded initial member fanout",
                    note_id=str(note.id),
                )

        if staged.manual_tags is not None:
            try:
                await ContentTagMutations(
                    self.operations.session,
                    self.operations.search_indexer,
                ).finish_manual_tags_after_commit(staged.manual_tags)
            except Exception:
                logger.opt(exception=True).warning(
                    "Note created with degraded manual-tag projection",
                    note_id=str(note.id),
                )

        try:
            await finish_inline_tags_after_commit(staged.inline_tags)
        except Exception:
            logger.opt(exception=True).warning(
                "Note created with degraded inline-tag fanout",
                note_id=str(note.id),
            )

        try:
            await self.operations._index_for_search(
                note,
                skip_member_lookup=not staged.members,
            )
        except Exception:
            logger.opt(exception=True).warning(
                "Note created with stale search projection",
                note_id=str(note.id),
            )

        try:
            effective_mode, _ = await self.operations._effective_policy(
                note.organization_id,
                note,
            )
        except Exception:
            logger.opt(exception=True).warning(
                "Note created without resolved access fanout",
                note_id=str(note.id),
            )
        else:
            if effective_mode != AccessMode.OWNER_ONLY or staged.members:
                try:
                    await self.operations._emit_shared_notification(
                        note.owner_id,
                        note.organization_id,
                        note,
                    )
                except Exception:
                    logger.opt(exception=True).warning(
                        "Note created with degraded share notification",
                        note_id=str(note.id),
                    )
            try:
                await self.operations._broadcast_open_to_org_create(
                    note.organization_id,
                    note.id,
                    effective_mode,
                )
            except Exception:
                logger.opt(exception=True).warning(
                    "Note created with degraded access fanout",
                    note_id=str(note.id),
                )

        try:
            await self.operations._notify_new_mentions(
                note.owner_id,
                note.organization_id,
                note,
                old_refs=None,
                writer_id=note.owner_id,
            )
        except Exception:
            logger.opt(exception=True).warning(
                "Note created with degraded mention notifications",
                note_id=str(note.id),
            )

        try:
            await self.operations._refresh_parent_folder(
                note.parent_id,
                note.organization_id,
            )
        except Exception:
            logger.opt(exception=True).warning(
                "Note created with stale parent-folder projection",
                note_id=str(note.id),
            )

    async def unique_slug(self, base: str, organization_id: UUID) -> str:
        existing = await queries.get_by_slug(self.operations.session, base, organization_id)
        if not existing:
            return base
        return f"{base}-{int(datetime.now(UTC).timestamp())}"
