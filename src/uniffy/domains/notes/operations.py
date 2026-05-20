"""Note operations."""

import copy
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import String, cast, func, or_, select
from sqlalchemy import update as sql_update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.content.base_operations import BaseContentOperations
from uniffy.core.content.cascade import propagate_rename
from uniffy.core.content.members import (
    ContentMembersOperations,
    register_attachment_cascade_loader,
    register_content_loader,
)
from uniffy.core.content.references import (
    extract_all_outgoing_references,
    extract_all_outgoing_references_from_canvas,
)
from uniffy.core.errors import NotFoundError
from uniffy.core.events import (
    NotificationEvent,
    emit_notification,
    extract_mentioned_user_ids,
)
from uniffy.core.models.login.group import Group
from uniffy.core.models.login.group_member import GroupMember
from uniffy.core.models.login.user import User
from uniffy.core.models.notes.note import Note
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import (
    AccessMode,
    ContentRole,
    ContentType,
    NodeType,
    NotificationType,
    SubjectType,
)
from uniffy.domains.notes import queries
from uniffy.domains.tags import (
    TagAssignment,
    TagOperations,
    sync_inline_tags,
)

_MENTION_ESCAPED_RE = re.compile(r"\\?\[\\?\[\\?\[([^|\]]+)\|[^\]]+\\?\]\\?\]\\?\]")
_MENTION_RE = re.compile(r"\[\[\[([^|]+)\|[^\]]+\]\]\]")
_IMAGE_RE = re.compile(r"!\[([^\]]*)\]\([^)]+\)")
_LINK_RE = re.compile(r"\[([^\]]+)\]\([^)]+\)")
_HTML_TAG_RE = re.compile(r"<[^>]+>")
_FENCED_CODE_RE = re.compile(r"```[\s\S]*?```")
_INLINE_CODE_RE = re.compile(r"`([^`]+)`")
_HEADER_RE = re.compile(r"^#{1,6}\s+", re.MULTILINE)
_BOLD_STAR_RE = re.compile(r"\*\*([^*]+)\*\*")
_ITALIC_STAR_RE = re.compile(r"\*([^*]+)\*")
_BOLD_UNDER_RE = re.compile(r"__([^_]+)__")
_ITALIC_UNDER_RE = re.compile(r"_([^_]+)_")
_STRIKE_RE = re.compile(r"~~([^~]+)~~")
_BLOCKQUOTE_RE = re.compile(r"^>\s+", re.MULTILINE)
_UL_MARKER_RE = re.compile(r"^[\s]*[-*+]\s+", re.MULTILINE)
_OL_MARKER_RE = re.compile(r"^[\s]*\d+\.\s+", re.MULTILINE)
_TABLE_SEP_RE = re.compile(r"^\|?[\s:]*[-]{2,}[\s:]*(\|[\s:]*[-]{2,}[\s:]*)*\|?\s*$", re.MULTILINE)
_HR_RE = re.compile(r"^[-*_]{3,}\s*$", re.MULTILINE)
_WS_RE = re.compile(r"\s+")


def _strip_markdown(text: str) -> str:
    """Strip markdown + URN mention syntax to plain text. Mirrors
    the frontend ``stripMarkdown`` so search snippets match what
    a mention chip would render.
    """
    if not text:
        return ""
    s = _MENTION_ESCAPED_RE.sub(r"\1", text)
    s = _MENTION_RE.sub(r"\1", s)
    s = _IMAGE_RE.sub(r"\1", s)
    s = _LINK_RE.sub(r"\1", s)
    s = _HTML_TAG_RE.sub(" ", s)
    s = _FENCED_CODE_RE.sub(" ", s)
    s = _INLINE_CODE_RE.sub(r"\1", s)
    s = _HEADER_RE.sub("", s)
    s = _BOLD_STAR_RE.sub(r"\1", s)
    s = _ITALIC_STAR_RE.sub(r"\1", s)
    s = _BOLD_UNDER_RE.sub(r"\1", s)
    s = _ITALIC_UNDER_RE.sub(r"\1", s)
    s = _STRIKE_RE.sub(r"\1", s)
    s = _BLOCKQUOTE_RE.sub("", s)
    s = _UL_MARKER_RE.sub("", s)
    s = _OL_MARKER_RE.sub("", s)
    s = _TABLE_SEP_RE.sub("", s)
    s = s.replace("|", " ")
    s = _HR_RE.sub("", s)
    s = _WS_RE.sub(" ", s)
    return s.strip()


@dataclass
class NoteSharingInfo:
    """Sharing info attached to a note for UI rendering. Owned notes
    populate ``shared_with``; notes shared with the user populate
    ``owner_info``.
    """

    owner_info: dict | None = None
    shared_with: list[dict] | None = None


@dataclass
class _NoteContentFields:
    """Output of ``_extract_content_fields``: the parts of a Note row
    that are derived from the markdown / canvas content of an update."""

    content: str
    canvas_content: dict[str, Any] | None
    outgoing_references: list[str] | None
    parsed_inline_tag_names: list[str]


class NoteOperations(BaseContentOperations[Note]):
    """Note CRUD with permissions, search indexing, and notifications."""

    content_type = ContentType.NOTE
    model_class = Note

    def __init__(self, session: AsyncSession) -> None:
        """Initialize note operations."""
        super().__init__(session)

    def _build_search_keywords(self, model: Note) -> str:
        """Aggregate searchable text from a note. Tag slugs land in
        the dedicated ``tags`` array (see ``_get_search_tags_async``)
        and are not duplicated here. Canvas notes concatenate text-node
        content and shape labels.
        """
        parts = [model.title]
        if model.node_type == NodeType.CANVAS and model.canvas_content:
            parts.extend(self._extract_canvas_text(model.canvas_content))
        elif model.content:
            parts.append(model.content)
        return " ".join(parts)

    def _get_search_title(self, model: Note) -> str:
        """Return note title for the search index document."""
        return model.title

    def _get_url_path(self, model: Note) -> str:
        """Return the frontend route for opening this note."""
        return f"/notes/{model.id}"

    def _get_search_description(self, model: Note) -> str | None:
        """Return a snippet for search previews. Markdown is stripped
        before slicing so chips render plain text instead of raw
        ``[[[label|urn]]]`` / ``# heading`` / ``**bold**`` syntax.
        """
        if model.node_type == NodeType.CANVAS:
            texts = self._extract_canvas_text(model.canvas_content or {})
            if not texts:
                return None
            joined = " ".join(texts).strip()
            return joined[:200] if joined else None
        if model.content:
            stripped = _strip_markdown(model.content)
            return stripped[:200] if stripped else None
        return None

    async def _get_search_tags_async(self, model: Note) -> list[str] | None:
        """Return the slug list assigned to this note via the unified store."""
        tag_ops = TagOperations(self.session)
        urn = build_content_urn(self.content_type, model.id)
        bulk = await tag_ops.get_for_urns(
            organization_id=model.organization_id,
            content_urns=[urn],
        )
        slugs = sorted({tag.slug for tag in bulk.get(urn, [])})
        return slugs or None

    async def _get_search_metadata_async(self, model: Note) -> dict[str, str] | None:
        """Add parent-folder title so mention chips show a breadcrumb."""
        meta = dict(self._get_search_metadata(model) or {})
        if model.parent_id:
            result = await self.session.execute(
                select(Note.title).where(Note.id == model.parent_id)
            )
            title = result.scalar_one_or_none()
            if title:
                meta["parent_label"] = title
        return meta or None

    @staticmethod
    def _extract_canvas_text(canvas_data: dict) -> list[str]:
        """Extract searchable text from canvas data for indexing."""
        texts: list[str] = []
        for node in canvas_data.get("nodes", []):
            node_data = node.get("data", {})
            kind = node_data.get("type", "")
            if kind == "text":
                content = node_data.get("content", "")
                if content:
                    texts.append(content)
            elif kind in ("shape", "mindmap"):
                label = node_data.get("label", "")
                if label:
                    texts.append(label)
        return texts

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
        """Create a new note.

        ``access_mode``/``baseline_role`` default to ``None`` so the
        row inherits live from the org defaults. ``group_ids`` adds
        initial VIEWER group members via ContentMembersOperations so
        the audit log captures them.
        """
        access_mode, baseline_role = await self._resolve_access_policy(
            organization_id, access_mode, baseline_role
        )

        slug = await self._unique_slug(slug or queries.slugify(title), organization_id)
        fields = self._extract_content_fields(node_type, content, canvas_content, organization_id)

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
        self.session.add(note)
        await self.session.commit()
        await self.session.refresh(note)

        # Initial group members go through the canonical members API
        # so the audit log records each addition.
        if group_ids:
            members_ops = ContentMembersOperations(self.session)
            for gid in group_ids:
                await members_ops.add_member(
                    actor_user_id=user_id,
                    organization_id=organization_id,
                    content_type=self.content_type,
                    content_id=note.id,
                    subject_type=SubjectType.GROUP,
                    subject_id=gid,
                    role=ContentRole.VIEWER,
                )

        await self._sync_tags_after_save(
            user_id=user_id,
            organization_id=organization_id,
            note=note,
            tag_ids=tag_ids,
            parsed_inline_names=fields.parsed_inline_tag_names,
        )

        await self._index_for_search(note, skip_member_lookup=not group_ids)
        await self.session.commit()

        effective_mode, _ = await self._effective_policy(organization_id, note)
        if effective_mode != AccessMode.OWNER_ONLY or group_ids:
            await self._emit_shared_notification(user_id, organization_id, note)
        await self._notify_new_mentions(user_id, organization_id, note, old_refs=None)

        return note

    async def update(
        self,
        user_id: UUID,
        organization_id: UUID,
        note_id: UUID,
        title: str | None = None,
        content: str | None = None,
        canvas_content: dict[str, Any] | None = None,
        slug: str | None = None,
        parent_id: UUID | None | str = None,  # "" means clear
        tag_ids: list[UUID] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> Note:
        """Update note metadata and/or body.

        Access-policy changes (access mode, baseline role, members) go
        through ``permissions.v1.MembersService``, never this method.
        """
        note = await self._fetch_by_id(note_id, organization_id)
        if not note:
            raise NotFoundError("Note", note_id)

        await self._require_edit(user_id, organization_id, note)

        title_changed = title is not None and title != note.title
        is_canvas = note.node_type == NodeType.CANVAS
        content_changed = canvas_content is not None if is_canvas else content is not None

        old_refs = note.outgoing_references if content_changed else None

        parsed_inline_names: list[str] | None = None
        if title is not None:
            note.title = title
        if content_changed:
            fields = self._extract_content_fields(
                note.node_type, content or "", canvas_content, organization_id
            )
            note.content = fields.content
            note.canvas_content = fields.canvas_content
            note.outgoing_references = fields.outgoing_references
            parsed_inline_names = fields.parsed_inline_tag_names
        if slug is not None:
            note.slug = slug
        if parent_id == "":
            note.parent_id = None
        elif parent_id is not None:
            note.parent_id = parent_id
        if metadata is not None:
            # Reassign a new dict so SQLAlchemy detects the JSONB change.
            merged = copy.deepcopy(note.note_metadata) if note.note_metadata else {}
            merged.update(metadata)
            note.note_metadata = merged

        note.version += 1
        note.updated_at = datetime.now(UTC)

        await self.session.commit()
        await self.session.refresh(note)

        await self._sync_tags_after_save(
            user_id=user_id,
            organization_id=organization_id,
            note=note,
            tag_ids=tag_ids,
            parsed_inline_names=parsed_inline_names if content_changed else None,
        )

        await self._index_for_search(note)
        await self.session.commit()

        if title_changed:
            await self._propagate_title_to_mentions(organization_id, note)
            if note.node_type == NodeType.FOLDER:
                await self._refresh_children_parent_label(note)

        effective_mode, _ = await self._effective_policy(organization_id, note)
        if effective_mode != AccessMode.OWNER_ONLY:
            await emit_notification(
                NotificationEvent(
                    notification_type=NotificationType.CONTENT_EDITED,
                    organization_id=organization_id,
                    actor_id=user_id,
                    title=f"Edited note: {note.title}",
                    source_urn=build_content_urn(self.content_type, note.id),
                    content_type=self.content_type,
                    content_id=note.id,
                )
            )

        if content_changed:
            await self._notify_new_mentions(user_id, organization_id, note, old_refs=old_refs)

        return note

    async def delete(
        self,
        user_id: UUID,
        organization_id: UUID,
        note_id: UUID,
        permanent: bool = False,
    ) -> bool:
        """Delete a note (soft by default, recursively for folders)."""
        note = await self._fetch_by_id(note_id, organization_id)
        if not note:
            raise NotFoundError("Note", note_id)

        await self._require_delete(user_id, organization_id, note)

        # Capture descendants before mutation so we know what to remove
        # from the search index.
        removed_ids = await self._collect_descendant_ids(note)

        if permanent:
            await queries.permanent_delete_recursive(self.session, note)
        else:
            await queries.soft_delete_recursive(self.session, note)

        if permanent:
            tag_ops = TagOperations(self.session)
            for nid in removed_ids:
                await tag_ops.unassign_all_for_urn(
                    organization_id=organization_id,
                    content_urn=build_content_urn(self.content_type, nid),
                )

        for nid in removed_ids:
            await self.search_indexer.remove(build_content_urn(self.content_type, nid))
        await self.session.commit()

        return True

    async def restore(
        self,
        user_id: UUID,
        organization_id: UUID,
        note_id: UUID,
    ) -> Note:
        """Restore a soft-deleted note."""
        note = await self._fetch_by_id(note_id, organization_id)
        if not note:
            raise NotFoundError("Note", note_id)

        await self._require_edit(user_id, organization_id, note)

        note.is_deleted = False
        note.deleted_at = None
        note.updated_at = datetime.now(UTC)

        await self.session.commit()
        await self.session.refresh(note)

        await self._index_for_search(note)
        await self.session.commit()

        return note

    async def realtime_save(
        self,
        organization_id: UUID,
        note_id: UUID,
        content: str,
        canvas_content: dict[str, Any] | None,
    ) -> Note | None:
        """Persist a debounced Yjs snapshot back into ``notes_notes``.

        Called from the snapshot ARQ task. Skips the permission gate
        (system actor) but enforces a CAS on ``version`` so racing
        workers cannot both succeed - the loser returns ``None`` and
        the winner drives the side effects. Soft-deleted notes return
        ``None`` so the task stays idempotent. ``owner_id`` is the
        actor for tag assignments + mention notifications because a
        snapshot accumulates writes from N concurrent editors with no
        per-edit attribution.
        """
        note = (
            await self.session.execute(
                select(Note).where(
                    Note.id == note_id,
                    Note.organization_id == organization_id,
                    Note.is_deleted == False,  # noqa: E712
                )
            )
        ).scalar_one_or_none()
        if not note:
            return None

        old_refs = note.outgoing_references
        fields = self._extract_content_fields(
            note.node_type, content, canvas_content, organization_id
        )
        existing_version = note.version
        new_version = existing_version + 1
        now = datetime.now(UTC)

        result = await self.session.execute(
            sql_update(Note)
            .where(
                Note.id == note_id,
                Note.organization_id == organization_id,
                Note.is_deleted == False,  # noqa: E712
                Note.version == existing_version,
            )
            .values(
                content=fields.content,
                canvas_content=fields.canvas_content,
                outgoing_references=fields.outgoing_references,
                version=new_version,
                updated_at=now,
            )
            .execution_options(synchronize_session=False)
        )
        await self.session.commit()

        if result.rowcount == 0:
            # Lost the CAS race or the note was soft-deleted between
            # the read and the UPDATE.
            return None

        await self.session.refresh(note)
        actor_id = note.owner_id

        await self._sync_tags_after_save(
            user_id=actor_id,
            organization_id=organization_id,
            note=note,
            tag_ids=None,
            parsed_inline_names=fields.parsed_inline_tag_names,
        )

        await self._index_for_search(note)
        await self.session.commit()

        await self._notify_new_mentions(actor_id, organization_id, note, old_refs=old_refs)

        return note

    async def move(
        self,
        user_id: UUID,
        organization_id: UUID,
        note_id: UUID,
        target_access_mode: AccessMode | None,
        target_baseline_role: ContentRole | None = None,
        target_group_ids: list[UUID] | None = None,
    ) -> Note:
        """Change a note's access mode. Thin wrapper around
        :meth:`ContentMembersOperations.set_access_mode` plus optional
        group VIEWER additions.
        """
        members_ops = ContentMembersOperations(self.session)
        await members_ops.set_access_mode(
            actor_user_id=user_id,
            organization_id=organization_id,
            content_type=self.content_type,
            content_id=note_id,
            new_access_mode=target_access_mode,
            new_baseline_role=target_baseline_role,
            remove_members_on_narrow=False,
        )

        if target_group_ids:
            for gid in target_group_ids:
                await members_ops.add_member(
                    actor_user_id=user_id,
                    organization_id=organization_id,
                    content_type=self.content_type,
                    content_id=note_id,
                    subject_type=SubjectType.GROUP,
                    subject_id=gid,
                    role=ContentRole.VIEWER,
                )

        note = await self._fetch_by_id(note_id, organization_id)
        if note is None:
            raise NotFoundError("Note", note_id)

        effective_mode, _ = await self._effective_policy(organization_id, note)
        if effective_mode != AccessMode.OWNER_ONLY:
            await self._emit_shared_notification(user_id, organization_id, note)

        return note

    async def get_backlinks(
        self,
        user_id: UUID,
        organization_id: UUID,
        note_id: UUID,
    ) -> list[Note]:
        """Return notes that reference the target note (the user can see)."""
        note = await self._fetch_by_id(note_id, organization_id)
        if not note:
            raise NotFoundError("Note", note_id)

        await self._require_view(user_id, organization_id, note)

        all_backlinks = await queries.get_backlinks(self.session, note_id, organization_id)

        accessible: list[Note] = []
        for backlink in all_backlinks:
            role = await self._resolve_role(user_id, organization_id, backlink)
            if role is not None and role != ContentRole.BLOCKED:
                accessible.append(backlink)
        return accessible

    async def empty_trash(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> int:
        """Permanently delete every soft-deleted note in the org."""
        # Snapshot ids before deletion to drive search-index cleanup
        # after the rows are gone.
        trash_ids_result = await self.session.execute(
            select(Note.id).where(
                Note.organization_id == organization_id,
                Note.is_deleted == True,  # noqa: E712
            )
        )
        trash_ids = list(trash_ids_result.scalars().all())

        count = await queries.empty_trash(self.session, organization_id)

        tag_ops = TagOperations(self.session)
        for nid in trash_ids:
            urn = build_content_urn(self.content_type, nid)
            await tag_ops.unassign_all_for_urn(
                organization_id=organization_id,
                content_urn=urn,
            )
            await self.search_indexer.remove(urn)
        await self.session.commit()

        return count

    async def list_notes(
        self,
        user_id: UUID,
        organization_id: UUID,
        parent_id: UUID | None | str = None,
        access_mode: AccessMode | None = None,
        group_id: UUID | None = None,
        personal_only: bool = False,
        include_deleted: bool = False,
        tag_ids: list[UUID] | None = None,
        page: int = 1,
        page_size: int = 50,
        sort_by: str = "updated_at",
        sort_order: str = "desc",
    ) -> tuple[list[Note], int]:
        """List notes the user can access. Bookmark filtering belongs
        to BookmarksService and is not supported here.
        """
        query = select(Note).where(Note.organization_id == organization_id)
        query = await self._apply_access_filter(
            query, user_id, organization_id, personal_only=personal_only
        )

        if group_id is not None:
            query = query.where(Note.id.in_(self._group_member_subquery(organization_id, group_id)))
        if parent_id == "root":
            query = query.where(Note.parent_id.is_(None))
        elif parent_id:
            query = query.where(Note.parent_id == parent_id)
        if access_mode is not None:
            query = query.where(Note.access_mode == access_mode)
        if not include_deleted:
            query = query.where(Note.is_deleted == False)  # noqa: E712
        if tag_ids:
            query = query.where(Note.id.in_(self._tag_filter_subquery(tag_ids)))

        total = (
            await self.session.execute(select(func.count()).select_from(query.subquery()))
        ).scalar() or 0

        sort_col = getattr(Note, sort_by, Note.updated_at)
        query = query.order_by(sort_col.asc() if sort_order == "asc" else sort_col.desc())
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self.session.execute(query)
        return list(result.scalars().all()), total

    async def get_notes_sharing_info(
        self,
        notes: list[Note],
        current_user_id: UUID,
    ) -> dict[UUID, NoteSharingInfo]:
        """Batch-fetch the per-note sharing info for the UI. Owned
        notes get ``shared_with``; non-owned notes get ``owner_info``.
        """
        result: dict[UUID, NoteSharingInfo] = {}

        owned_notes = [n for n in notes if n.owner_id == current_user_id]
        shared_notes = [n for n in notes if n.owner_id != current_user_id]

        if shared_notes:
            owners = await self._load_owners({n.owner_id for n in shared_notes})
            for note in shared_notes:
                owner = owners.get(note.owner_id)
                result[note.id] = NoteSharingInfo(
                    owner_info=self._owner_info_dict(note.owner_id, owner)
                )

        if owned_notes:
            members_by_note = await self._load_members_by_note([n.id for n in owned_notes])
            user_lookup, group_lookup, group_counts = await self._load_subject_lookups(
                members_by_note
            )
            for note in owned_notes:
                shared_with = self._build_shared_with(
                    members_by_note.get(note.id, []),
                    user_lookup,
                    group_lookup,
                    group_counts,
                )
                result[note.id] = NoteSharingInfo(shared_with=shared_with if shared_with else None)

        return result

    async def _unique_slug(self, base: str, organization_id: UUID) -> str:
        """Return ``base`` if it is free in the org; otherwise add a suffix."""
        existing = await queries.get_by_slug(self.session, base, organization_id)
        if not existing:
            return base
        return f"{base}-{int(datetime.now(UTC).timestamp())}"

    def _extract_content_fields(
        self,
        node_type: NodeType,
        content: str,
        canvas_content: dict[str, Any] | None,
        organization_id: UUID,
    ) -> _NoteContentFields:
        """Compute body-derived fields from raw inputs. Canvas notes
        use JSONB ``canvas_content`` (markdown forced empty); markdown
        notes use ``content`` (canvas forced None). Both derive
        ``outgoing_references`` and inline tag names.
        """
        if node_type == NodeType.CANVAS:
            outgoing = (
                extract_all_outgoing_references_from_canvas(canvas_content, organization_id)
                if canvas_content
                else None
            ) or None
            parsed = (
                queries.extract_inline_tags_from_canvas(canvas_content) if canvas_content else []
            )
            return _NoteContentFields(
                content="",
                canvas_content=canvas_content,
                outgoing_references=outgoing,
                parsed_inline_tag_names=parsed,
            )

        outgoing = (
            extract_all_outgoing_references(content, organization_id) if content else None
        ) or None
        parsed = queries.extract_inline_tags_from_content(content) if content else []
        return _NoteContentFields(
            content=content,
            canvas_content=None,
            outgoing_references=outgoing,
            parsed_inline_tag_names=parsed,
        )

    async def _sync_tags_after_save(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        note: Note,
        tag_ids: list[UUID] | None,
        parsed_inline_names: list[str] | None,
    ) -> None:
        """Reconcile manual + inline tag assignments after a write.
        ``None`` for either argument leaves that side untouched.
        """
        urn = build_content_urn(self.content_type, note.id)
        tag_ops = TagOperations(self.session)

        if tag_ids is not None:
            await tag_ops.replace_manual_tags(
                actor_id=user_id,
                organization_id=organization_id,
                content_urn=urn,
                tag_ids=tag_ids,
            )

        if parsed_inline_names is not None:
            await sync_inline_tags(
                self.session,
                content_urn=urn,
                organization_id=organization_id,
                actor_id=user_id,
                parsed_names=parsed_inline_names,
            )

    def _tag_filter_subquery(self, tag_ids: list[UUID]):
        """Subquery: note ids that carry every tag in ``tag_ids``.
        Logical AND via GROUP BY + HAVING COUNT(DISTINCT).
        """
        urn_prefix = "urn:uniffy:content:NOTE:"
        urn_expr = func.concat(urn_prefix, cast(Note.id, String))
        return (
            select(Note.id)
            .join(TagAssignment, TagAssignment.content_urn == urn_expr)
            .where(TagAssignment.tag_id.in_(tag_ids))
            .group_by(Note.id)
            .having(func.count(func.distinct(TagAssignment.tag_id)) == len(tag_ids))
        )

    async def _notify_new_mentions(
        self,
        user_id: UUID,
        organization_id: UUID,
        note: Note,
        old_refs: list[str] | None,
    ) -> None:
        """Emit ``CONTENT_MENTIONED`` to newly mentioned users.
        Pass ``None`` for ``old_refs`` on initial create so every
        mention counts as new. Self-mentions are skipped.
        """
        new_mentioned = extract_mentioned_user_ids(note.outgoing_references)
        new_mentioned.discard(user_id)
        if old_refs is not None:
            new_mentioned -= extract_mentioned_user_ids(old_refs)
        if not new_mentioned:
            return

        await emit_notification(
            NotificationEvent(
                notification_type=NotificationType.CONTENT_MENTIONED,
                organization_id=organization_id,
                actor_id=user_id,
                title=f"Mentioned you in: {note.title}",
                source_urn=build_content_urn(self.content_type, note.id),
                target_user_ids=list(new_mentioned),
            )
        )

    async def _emit_shared_notification(
        self,
        user_id: UUID,
        organization_id: UUID,
        note: Note,
    ) -> None:
        """Emit ``CONTENT_SHARED`` for a note that just became reachable
        beyond its owner."""
        await emit_notification(
            NotificationEvent(
                notification_type=NotificationType.CONTENT_SHARED,
                organization_id=organization_id,
                actor_id=user_id,
                title=f"Shared note: {note.title}",
                source_urn=build_content_urn(self.content_type, note.id),
                content_type=self.content_type,
                content_id=note.id,
            )
        )

    async def _refresh_children_parent_label(self, parent: Note) -> None:
        """Re-index direct child notes after a folder rename and
        broadcast the new ``parent_label`` to visible chips.
        """
        from uniffy.core.valkey.mentions import publish_mention_state

        result = await self.session.execute(
            select(Note).where(
                Note.parent_id == parent.id,
                Note.is_deleted == False,  # noqa: E712
            )
        )
        children = list(result.scalars().all())
        for child in children:
            try:
                await self._index_for_search(child)
            except Exception:
                logger.warning(f"Failed to re-index child note {child.id} after folder rename")
            try:
                await publish_mention_state(
                    organization_id=child.organization_id,
                    urn=build_content_urn(self.content_type, child.id),
                    changes={"parent_label": parent.title},
                )
            except Exception:
                logger.warning(f"Failed to publish parent_label for note {child.id}")

    async def _propagate_title_to_mentions(
        self,
        organization_id: UUID,
        note: Note,
    ) -> None:
        """Best-effort: rewrite mention labels of this note in other content."""
        try:
            await propagate_rename(
                session=self.session,
                organization_id=organization_id,
                target_urn=build_content_urn(self.content_type, note.id),
                new_label=note.title,
            )
            await self.session.commit()
        except Exception:
            logger.warning(
                "Failed to propagate note rename to mentions",
                note_id=str(note.id),
                exc_info=True,
            )

    async def _collect_descendant_ids(self, note: Note) -> list[UUID]:
        """Walk a folder note and return its id plus every descendant id."""
        ids = [note.id]
        if note.node_type != NodeType.FOLDER:
            return ids

        result = await self.session.execute(
            select(Note).where(
                Note.parent_id == note.id,
                Note.is_deleted == False,  # noqa: E712
            )
        )
        for child in result.scalars().all():
            ids.extend(await self._collect_descendant_ids(child))
        return ids

    async def _apply_access_filter(
        self,
        query: Any,
        user_id: UUID,
        organization_id: UUID,
        *,
        personal_only: bool,
    ) -> Any:
        """Apply the access ``WHERE`` clause: ``personal_only``
        short-circuits to owner; org / domain admins bypass; everyone
        else gets the canonical accessible-filter.
        """
        if personal_only:
            return query.where(Note.owner_id == user_id)

        if await self.permission_checker.is_org_admin(user_id, organization_id):
            return query
        if await self.permission_checker.is_domain_admin(
            user_id, organization_id, self.content_type
        ):
            return query

        access_filter = self.access_query.build_accessible_filter(
            user_id=user_id,
            organization_id=organization_id,
            content_type=self.content_type,
            content_id_column=Note.id,
            owner_id_column=Note.owner_id,
            access_mode_column=Note.access_mode,
            baseline_role_column=Note.baseline_role,
        )
        return query.where(access_filter)

    def _group_member_subquery(self, organization_id: UUID, group_id: UUID):
        """Subquery: ids of notes the given group is an explicit member of."""
        now = datetime.now(UTC)
        return select(ContentMember.content_id).where(
            ContentMember.organization_id == organization_id,
            ContentMember.content_type == self.content_type,
            ContentMember.subject_type == SubjectType.GROUP,
            ContentMember.subject_id == group_id,
            ContentMember.role != ContentRole.BLOCKED,
            or_(
                ContentMember.expires_at.is_(None),
                ContentMember.expires_at > now,
            ),
        )

    async def _load_owners(self, owner_ids: set[UUID]) -> dict[UUID, User]:
        """Bulk-load users by id, returning a lookup map."""
        if not owner_ids:
            return {}
        result = await self.session.execute(select(User).where(User.id.in_(owner_ids)))
        return {u.id: u for u in result.scalars().all()}

    @staticmethod
    def _owner_info_dict(owner_id: UUID, owner: User | None) -> dict | None:
        """Format a User row as the dict shape note_to_proto consumes."""
        if owner is None:
            return None
        return {
            "id": str(owner_id),
            "name": owner.full_name or owner.username,
            "email": owner.email,
        }

    async def _load_members_by_note(
        self,
        note_ids: list[UUID],
    ) -> dict[UUID, list[ContentMember]]:
        """Group non-blocked, non-expired ContentMember rows by note id."""
        if not note_ids:
            return {}
        now = datetime.now(UTC)
        result = await self.session.execute(
            select(ContentMember)
            .where(ContentMember.content_type == self.content_type)
            .where(ContentMember.content_id.in_(note_ids))
            .where(ContentMember.role != ContentRole.BLOCKED)
            .where(
                or_(
                    ContentMember.expires_at.is_(None),
                    ContentMember.expires_at > now,
                )
            )
        )
        members_by_note: dict[UUID, list[ContentMember]] = {nid: [] for nid in note_ids}
        for member in result.scalars().all():
            members_by_note[member.content_id].append(member)
        return members_by_note

    async def _load_subject_lookups(
        self,
        members_by_note: dict[UUID, list[ContentMember]],
    ) -> tuple[dict[UUID, User], dict[UUID, Group], dict[UUID, int]]:
        """Bulk-load every user / group referenced by a member set."""
        user_ids: set[UUID] = set()
        group_ids: set[UUID] = set()
        for members in members_by_note.values():
            for m in members:
                if m.subject_type == SubjectType.USER:
                    user_ids.add(m.subject_id)
                elif m.subject_type == SubjectType.GROUP:
                    group_ids.add(m.subject_id)

        user_lookup: dict[UUID, User] = {}
        if user_ids:
            users_result = await self.session.execute(select(User).where(User.id.in_(user_ids)))
            user_lookup = {u.id: u for u in users_result.scalars().all()}

        group_lookup: dict[UUID, Group] = {}
        group_counts: dict[UUID, int] = {}
        if group_ids:
            groups_result = await self.session.execute(select(Group).where(Group.id.in_(group_ids)))
            group_lookup = {g.id: g for g in groups_result.scalars().all()}

            counts_result = await self.session.execute(
                select(
                    GroupMember.group_id,
                    func.count(GroupMember.id).label("count"),
                )
                .where(GroupMember.group_id.in_(group_ids))
                .where(GroupMember.is_active == True)  # noqa: E712
                .group_by(GroupMember.group_id)
            )
            for row in counts_result.all():
                group_counts[row[0]] = row[1]

        return user_lookup, group_lookup, group_counts

    @staticmethod
    def _build_shared_with(
        members: list[ContentMember],
        user_lookup: dict[UUID, User],
        group_lookup: dict[UUID, Group],
        group_counts: dict[UUID, int],
    ) -> list[dict]:
        """Materialize a single note's ``shared_with`` list."""
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


async def _load_note(
    session: AsyncSession,
    organization_id: UUID,
    content_id: UUID,
) -> Note | None:
    """Loader used by ``ContentMembersOperations`` to fetch a note row."""
    result = await session.execute(
        select(Note).where(
            Note.id == content_id,
            Note.organization_id == organization_id,
        )
    )
    return result.scalar_one_or_none()


register_content_loader(ContentType.NOTE, _load_note)


async def _note_attachment_cascade(
    session: AsyncSession,
    organization_id: UUID,
    parent_id: UUID,
) -> list[tuple[ContentType, UUID]]:
    """Walk every descendant note (folder children + grandchildren) of a parent."""
    affected: list[tuple[ContentType, UUID]] = []
    stack: list[UUID] = [parent_id]
    seen: set[UUID] = set()
    while stack:
        current = stack.pop()
        rows = (
            await session.execute(
                select(Note.id).where(
                    Note.parent_id == current,
                    Note.organization_id == organization_id,
                    Note.is_deleted == False,  # noqa: E712
                )
            )
        ).scalars().all()
        for child_id in rows:
            if child_id in seen:
                continue
            seen.add(child_id)
            affected.append((ContentType.NOTE, child_id))
            stack.append(child_id)
    return affected


register_attachment_cascade_loader(ContentType.NOTE, _note_attachment_cascade)
