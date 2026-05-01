"""Note operations."""

import copy
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.content.base_operations import BaseContentOperations
from uniffy.core.content.cascade import propagate_rename
from uniffy.core.content.members import (
    ContentMembersOperations,
    register_content_loader,
)
from uniffy.core.content.references import (
    extract_all_outgoing_references,
    extract_all_outgoing_references_from_canvas,
)
from uniffy.core.errors import ConflictError, NotFoundError
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


@dataclass
class NoteSharingInfo:
    """Sharing info attached to a note for UI rendering.

    For notes the requesting user owns: ``shared_with`` lists the
    explicit ``ContentMember`` rows. For notes shared with the user:
    ``owner_info`` carries the owner's display details.
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
    inline_tags: list[str] | None


class NoteOperations(BaseContentOperations[Note]):
    """Note CRUD with permissions, search indexing, and notifications."""

    content_type = ContentType.NOTE
    model_class = Note

    def __init__(self, session: AsyncSession) -> None:
        """Initialize note operations."""
        super().__init__(session)

    def _build_search_keywords(self, model: Note) -> str:
        """Aggregate searchable text from a note.

        Tags are prefixed with ``tag:`` so search queries can filter by
        tag (``tag:work``). Both whole-note tags and inline ``[[[tag|...]]]``
        markers are indexed. For canvas notes, text-node content and
        shape labels are concatenated.
        """
        parts = [model.title]
        if model.tags:
            parts.extend(f"tag:{tag}" for tag in model.tags)
        if model.inline_tags:
            parts.extend(f"tag:{tag}" for tag in model.inline_tags)
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
        """Return a snippet for search result previews."""
        if model.node_type == NodeType.CANVAS:
            return None
        if model.content:
            return model.content[:200]
        return None

    def _get_search_tags(self, model: Note) -> list[str] | None:
        """Return the union of whole-note and inline tags for the index."""
        all_tags: set[str] = set()
        if model.tags:
            all_tags.update(model.tags)
        if model.inline_tags:
            all_tags.update(model.inline_tags)
        return sorted(all_tags) if all_tags else None

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
        tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
        group_ids: list[UUID] | None = None,
    ) -> Note:
        """Create a new note.

        ``access_mode`` and ``baseline_role`` default to the org's
        configured defaults for ``ContentType.NOTE``. ``group_ids`` is a
        convenience for adding initial VIEWER group members atomically;
        each entry is added through :class:`ContentMembersOperations` so
        the audit log captures the additions.
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
            tags=tags,
            inline_tags=fields.inline_tags,
            note_metadata=metadata,
            outgoing_references=fields.outgoing_references,
        )
        self.session.add(note)
        await self.session.commit()
        await self.session.refresh(note)

        # Add initial group members through the canonical members API so
        # the audit log records the additions.
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

        await self._index_for_search(note, skip_member_lookup=not group_ids)
        await self.session.commit()

        if access_mode != AccessMode.OWNER_ONLY or group_ids:
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
        tags: list[str] | None = None,
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

        if title is not None:
            note.title = title
        if content_changed:
            fields = self._extract_content_fields(
                note.node_type, content or "", canvas_content, organization_id
            )
            note.content = fields.content
            note.canvas_content = fields.canvas_content
            note.outgoing_references = fields.outgoing_references
            note.inline_tags = fields.inline_tags
        if slug is not None:
            note.slug = slug
        if parent_id == "":
            note.parent_id = None
        elif parent_id is not None:
            note.parent_id = parent_id
        if tags is not None:
            note.tags = tags
        if metadata is not None:
            # Reassign a new dict so SQLAlchemy detects the JSONB change.
            merged = copy.deepcopy(note.note_metadata) if note.note_metadata else {}
            merged.update(metadata)
            note.note_metadata = merged

        note.version += 1
        note.updated_at = datetime.now(UTC)

        await self.session.commit()
        await self.session.refresh(note)

        await self._index_for_search(note)
        await self.session.commit()

        if title_changed:
            await self._propagate_title_to_mentions(organization_id, note)

        if note.access_mode != AccessMode.OWNER_ONLY:
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

    async def autosave(
        self,
        user_id: UUID,
        organization_id: UUID,
        note_id: UUID,
        content: str = "",
        canvas_content: dict[str, Any] | None = None,
        title: str | None = None,
        expected_version: int | None = None,
    ) -> Note:
        """Fast-path content save used by the editor.

        Skips the heavier ``update()`` machinery (no rename propagation,
        no shared-note edit notifications); only the new mentions are
        diffed and notified.

        When ``expected_version`` is provided, the save is rejected with
        :class:`ConflictError` if the stored note has advanced past it.
        This is the optimistic-concurrency check that prevents a stale
        client draft from clobbering edits made by another user while
        the editor was in the background.
        """
        note = await self._fetch_by_id(note_id, organization_id)
        if not note:
            raise NotFoundError("Note", note_id)

        await self._require_edit(user_id, organization_id, note)

        if expected_version is not None and note.version != expected_version:
            raise ConflictError(
                "Note",
                f"version mismatch (client={expected_version}, server={note.version})",
            )

        old_refs = note.outgoing_references

        fields = self._extract_content_fields(
            note.node_type, content, canvas_content, organization_id
        )
        note.content = fields.content
        note.canvas_content = fields.canvas_content
        note.outgoing_references = fields.outgoing_references
        note.inline_tags = fields.inline_tags
        if title is not None:
            note.title = title
        note.version += 1
        note.updated_at = datetime.now(UTC)

        await self.session.commit()
        await self.session.refresh(note)

        await self._index_for_search(note)
        await self.session.commit()

        await self._notify_new_mentions(user_id, organization_id, note, old_refs=old_refs)

        return note

    async def move(
        self,
        user_id: UUID,
        organization_id: UUID,
        note_id: UUID,
        target_access_mode: AccessMode,
        target_baseline_role: ContentRole | None = None,
        target_group_ids: list[UUID] | None = None,
    ) -> Note:
        """Change a note's access mode (formerly the visibility scope).

        Thin wrapper that delegates to
        :class:`ContentMembersOperations.set_access_mode` for the policy
        change, then optionally adds group VIEWER members. The members
        operation handles permission checks, validation, audit logging,
        and search-index sync.
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

        if target_access_mode != AccessMode.OWNER_ONLY:
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
        # Snapshot trash ids before deletion so we can update the search
        # index after the rows are gone.
        trash_ids_result = await self.session.execute(
            select(Note.id).where(
                Note.organization_id == organization_id,
                Note.is_deleted == True,  # noqa: E712
            )
        )
        trash_ids = list(trash_ids_result.scalars().all())

        count = await queries.empty_trash(self.session, organization_id)

        for nid in trash_ids:
            await self.search_indexer.remove(build_content_urn(self.content_type, nid))
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
        tags: list[str] | None = None,
        page: int = 1,
        page_size: int = 50,
        sort_by: str = "updated_at",
        sort_order: str = "desc",
    ) -> tuple[list[Note], int]:
        """List notes the user can access, with the usual filters.

        Bookmark filtering is intentionally not supported here; the
        BookmarksService is the canonical surface for that.
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
        if tags:
            for tag in tags:
                query = query.where(Note.tags.contains([tag]))

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
        """Batch-fetch the per-note sharing info for the UI.

        Owned notes get a ``shared_with`` list (one entry per explicit
        non-blocked ContentMember). Notes the user does not own get an
        ``owner_info`` dict instead.
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
        """Compute the body-derived fields of a note from raw inputs.

        For canvas notes the JSONB ``canvas_content`` is the source of
        truth and ``content`` is forced empty. For markdown notes the
        opposite holds. Both paths derive ``outgoing_references`` and
        ``inline_tags`` so search indexing and mention notifications
        stay consistent.
        """
        if node_type == NodeType.CANVAS:
            outgoing = (
                extract_all_outgoing_references_from_canvas(canvas_content, organization_id)
                if canvas_content
                else None
            ) or None
            inline = (
                queries.extract_inline_tags_from_canvas(canvas_content) if canvas_content else None
            ) or None
            return _NoteContentFields(
                content="",
                canvas_content=canvas_content,
                outgoing_references=outgoing,
                inline_tags=inline,
            )

        outgoing = (
            extract_all_outgoing_references(content, organization_id) if content else None
        ) or None
        inline = (queries.extract_inline_tags_from_content(content) if content else None) or None
        return _NoteContentFields(
            content=content,
            canvas_content=None,
            outgoing_references=outgoing,
            inline_tags=inline,
        )

    async def _notify_new_mentions(
        self,
        user_id: UUID,
        organization_id: UUID,
        note: Note,
        old_refs: list[str] | None,
    ) -> None:
        """Emit ``CONTENT_MENTIONED`` to users newly mentioned in the note.

        ``old_refs`` is the previous outgoing-references list. Pass
        ``None`` on initial create (so every mention is "new"). Self-
        mentions are filtered out.
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
        """Apply the right ``WHERE`` clause to a list query.

        - ``personal_only`` short-circuits to ``owner_id == user``.
        - Org admins and domain admins bypass the access filter entirely.
        - Everyone else gets the canonical
          ``ContentAccessQuery.build_accessible_filter`` clause.
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
