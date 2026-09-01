"""Search and mention projections for notes."""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID

from loguru import logger
from sqlalchemy import func, or_, select

from uniffy.core.auth.permissions import modes_at_least_as_open
from uniffy.core.content.mentions import publish_mention_state
from uniffy.core.models.notes.note import Note
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import AccessMode, ContentType, NodeType
from uniffy.domains.notes.content.fields import extract_canvas_text, strip_markdown
from uniffy.domains.search.rename import propagate_rename
from uniffy.domains.tags.context import ContentTagReader

if TYPE_CHECKING:
    from uniffy.domains.notes.operations import NoteOperations

logger = logger.bind(component="notes.content.projections")


class NoteProjections:
    def __init__(self, operations: NoteOperations) -> None:
        self.operations = operations

    def build_search_keywords(self, note: Note) -> str:
        parts = [note.title]
        if note.node_type == NodeType.CANVAS and note.canvas_content:
            parts.extend(extract_canvas_text(note.canvas_content))
        elif note.content:
            parts.append(note.content)
        return " ".join(parts)

    def get_search_description(self, note: Note) -> str | None:
        if note.node_type == NodeType.CANVAS:
            joined = " ".join(extract_canvas_text(note.canvas_content or {})).strip()
            return joined[:200] if joined else None
        if note.content:
            stripped = strip_markdown(note.content)
            return stripped[:200] if stripped else None
        return None

    async def get_search_tags(self, note: Note) -> list[str] | None:
        urn = build_content_urn(ContentType.NOTE, note.id)
        bulk = await ContentTagReader(self.operations.session).get_for_urns(
            organization_id=note.organization_id,
            content_urns=[urn],
        )
        slugs = sorted({tag.slug for tag in bulk.get(urn, [])})
        return slugs or None

    async def get_search_metadata(self, note: Note) -> dict[str, str] | None:
        metadata = {"node_type": note.node_type.value}
        if note.parent_id:
            title = (
                await self.operations.session.execute(
                    select(Note.title).where(Note.id == note.parent_id)
                )
            ).scalar_one_or_none()
            if title:
                metadata["parent_label"] = title
        if note.node_type == NodeType.FOLDER:
            effective_mode, _ = await self.operations._effective_policy(
                note.organization_id,
                note,
            )
            allowed = modes_at_least_as_open(effective_mode)
            default_mode, _ = await self.operations.permission_checker.get_org_defaults(
                note.organization_id,
                ContentType.NOTE,
            )
            visible = Note.access_mode.in_(allowed)
            if (default_mode or AccessMode.OWNER_ONLY) in allowed:
                visible = or_(visible, Note.access_mode.is_(None))
            count = (
                await self.operations.session.execute(
                    select(func.count(Note.id)).where(
                        Note.parent_id == note.id,
                        Note.organization_id == note.organization_id,
                        Note.is_deleted == False,  # noqa: E712
                        Note.node_type == NodeType.NOTE,
                        visible,
                    )
                )
            ).scalar_one()
            metadata["child_count"] = str(count or 0)
        return metadata or None

    async def refresh_parent_folder(
        self,
        parent_id: UUID | None,
        organization_id: UUID,
    ) -> None:
        if parent_id is None:
            return
        parent = await self.operations._fetch_by_id(parent_id, organization_id)
        if not parent or parent.is_deleted or parent.node_type != NodeType.FOLDER:
            return
        try:
            metadata = await self.operations._index_for_search(parent) or {}
            await publish_mention_state(
                organization_id=organization_id,
                urn=build_content_urn(ContentType.NOTE, parent.id),
                changes={"title": parent.title, **metadata},
            )
        except Exception:
            logger.opt(exception=True).warning(
                "Failed to refresh note folder stats",
                parent_id=str(parent_id),
            )

    async def refresh_children_parent_label(self, parent: Note) -> None:
        children = list(
            (
                await self.operations.session.execute(
                    select(Note).where(
                        Note.parent_id == parent.id,
                        Note.is_deleted == False,  # noqa: E712
                    )
                )
            )
            .scalars()
            .all()
        )
        for child in children:
            try:
                await self.operations._index_for_search(child)
            except Exception:
                logger.opt(exception=True).warning(
                    "Failed to re-index child after folder rename",
                    note_id=str(child.id),
                )
            try:
                await publish_mention_state(
                    organization_id=child.organization_id,
                    urn=build_content_urn(ContentType.NOTE, child.id),
                    changes={"parent_label": parent.title},
                )
            except Exception:
                logger.opt(exception=True).warning(
                    "Failed to publish note parent label",
                    note_id=str(child.id),
                )

    async def propagate_title(self, organization_id: UUID, note: Note) -> None:
        try:
            await propagate_rename(
                session=self.operations.session,
                organization_id=organization_id,
                target_urn=build_content_urn(ContentType.NOTE, note.id),
                new_label=note.title,
            )
        except Exception:
            logger.opt(exception=True).warning(
                "Failed to propagate note rename to mentions",
                note_id=str(note.id),
            )
