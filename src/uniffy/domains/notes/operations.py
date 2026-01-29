"""Note operations extending BaseContentOperations."""

import copy
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.content.base_operations import BaseContentOperations
from uniffy.core.errors import NotFoundError
from uniffy.core.models.login.user import User
from uniffy.core.models.notes.note import Note
from uniffy.core.models.shared import NodeType
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import ContentType, VisibilityScope
from uniffy.domains.notes import queries


@dataclass
class NoteSharingInfo:
    """Sharing info for a note."""

    owner_info: dict | None = None
    shared_with: list[dict] | None = None


class NoteOperations(BaseContentOperations[Note]):
    """
    Note CRUD operations with permissions and search.

    Extends BaseContentOperations to provide note-specific functionality
    including slug management, versioning, and hierarchical organization.
    """

    content_type = ContentType.NOTE
    model_class = Note

    def __init__(self, session: AsyncSession) -> None:
        """Initialize note operations."""
        super().__init__(session)

    # ─────────────────────────────────────────────────────────────
    # Abstract method implementations
    # ─────────────────────────────────────────────────────────────

    def _build_search_keywords(self, model: Note) -> str:
        """
        Build search keywords from note content.

        Tags are prefixed with 'tag:' to enable filtered search queries
        like 'tag:work' to match notes with that tag. Both whole-note tags
        and inline tags are indexed.

        Full content is indexed to support complete full-text search.
        """
        parts = [model.title]
        if model.tags:
            # Prefix whole-note tags with 'tag:' for filtered search support
            parts.extend(f"tag:{tag}" for tag in model.tags)
        if model.inline_tags:
            # Prefix inline tags with 'tag:' as well (deduplicated at search time)
            parts.extend(f"tag:{tag}" for tag in model.inline_tags)
        if model.content:
            parts.append(model.content)
        return " ".join(parts)

    def _get_search_title(self, model: Note) -> str:
        """Get note title for search."""
        return model.title

    def _get_url_path(self, model: Note) -> str:
        """Get URL path for note."""
        return f"/notes/{model.id}"

    def _get_search_description(self, model: Note) -> str | None:
        """Get search description from note content."""
        if model.content:
            return model.content[:200]
        return None

    def _get_search_tags(self, model: Note) -> list[str] | None:
        """Get tags for search index (both whole-note and inline tags)."""
        all_tags: set[str] = set()
        if model.tags:
            all_tags.update(model.tags)
        if model.inline_tags:
            all_tags.update(model.inline_tags)
        return sorted(all_tags) if all_tags else None

    # ─────────────────────────────────────────────────────────────
    # Note-specific operations
    # ─────────────────────────────────────────────────────────────

    async def create(
        self,
        user_id: UUID,
        organization_id: UUID,
        title: str,
        content: str = "",
        slug: str | None = None,
        visibility: VisibilityScope = VisibilityScope.PRIVATE,
        node_type: NodeType = NodeType.NOTE,
        parent_id: UUID | None = None,
        tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
        group_ids: list[UUID] | None = None,
    ) -> Note:
        """
        Create a new note.

        Parameters
        ----------
        user_id : UUID
            Owner user ID.
        organization_id : UUID
            Organization ID.
        title : str
            Note title.
        content : str
            Note content in markdown.
        slug : str | None
            URL slug (auto-generated if not provided).
        visibility : VisibilityScope
            Who can access this note.
        node_type : NodeType
            Type of node (NOTE, FOLDER, TEMPLATE).
        parent_id : UUID | None
            Parent note/folder ID.
        tags : list[str] | None
            List of tags.
        metadata : dict | None
            Additional metadata.
        group_ids : list[UUID] | None
            Groups to share with (for GROUP visibility).

        Returns
        -------
        Note
            Created note.

        """
        # Generate slug if not provided
        if not slug:
            slug = queries.slugify(title)

        # Check for slug collision
        existing = await queries.get_by_slug(self.session, slug, organization_id)
        if existing:
            slug = f"{slug}-{int(datetime.now(UTC).timestamp())}"

        # Extract URN references and inline tags from content
        outgoing_refs = queries.extract_urns_from_content(content) if content else None
        inline_tags = queries.extract_inline_tags_from_content(content) if content else None

        note = Note(
            organization_id=organization_id,
            owner_id=user_id,
            title=title,
            content=content,
            slug=slug,
            visibility=visibility,
            node_type=node_type,
            parent_id=parent_id,
            tags=tags,
            inline_tags=inline_tags,
            note_metadata=metadata,
            outgoing_references=outgoing_refs,
        )
        self.session.add(note)
        await self.session.flush()

        # Create group links if visibility is GROUP
        if visibility == VisibilityScope.GROUP and group_ids:
            await self._create_group_links(
                content_id=note.id,
                organization_id=organization_id,
                user_id=user_id,
                group_ids=group_ids,
            )

        await self.session.commit()
        await self.session.refresh(note)

        # Index for search
        await self._index_for_search(
            model=note,
            group_ids=group_ids if visibility == VisibilityScope.GROUP else None,
        )
        await self.session.commit()

        return note

    async def update(
        self,
        user_id: UUID,
        organization_id: UUID,
        note_id: UUID,
        title: str | None = None,
        content: str | None = None,
        slug: str | None = None,
        parent_id: UUID | None | str = None,  # "" means remove parent
        tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> Note:
        """
        Update an existing note.

        Parameters
        ----------
        user_id : UUID
            User performing update.
        organization_id : UUID
            Organization ID.
        note_id : UUID
            Note to update.
        title : str | None
            New title.
        content : str | None
            New content.
        slug : str | None
            New slug.
        parent_id : UUID | None | str
            New parent (empty string to remove parent).
        tags : list[str] | None
            New tags.
        metadata : dict | None
            Metadata to merge.

        Returns
        -------
        Note
            Updated note.

        """
        note = await self._fetch_by_id(note_id, organization_id)
        if not note:
            raise NotFoundError("Note", note_id)

        await self._require_edit(user_id, organization_id, note)

        # Apply updates
        if title is not None:
            note.title = title
        if content is not None:
            note.content = content
            # Update outgoing references and inline tags when content changes
            note.outgoing_references = queries.extract_urns_from_content(content) or None
            note.inline_tags = queries.extract_inline_tags_from_content(content) or None
        if slug is not None:
            note.slug = slug
        if parent_id == "":
            note.parent_id = None
        elif parent_id is not None:
            note.parent_id = parent_id
        if tags is not None:
            note.tags = tags
        if metadata is not None:
            # Create a new dict to ensure SQLAlchemy detects the change
            # (in-place .update() on JSONB fields is not tracked by SQLAlchemy)
            existing = copy.deepcopy(note.note_metadata) if note.note_metadata else {}
            existing.update(metadata)
            note.note_metadata = existing

        note.version += 1
        note.updated_at = datetime.now(UTC)

        await self.session.commit()
        await self.session.refresh(note)

        # Update search index
        group_ids = await self._get_content_group_ids(note.id)
        await self._index_for_search(model=note, group_ids=group_ids)
        await self.session.commit()

        return note

    async def delete(
        self,
        user_id: UUID,
        organization_id: UUID,
        note_id: UUID,
        permanent: bool = False,
    ) -> bool:
        """
        Delete a note (soft or permanent).

        Parameters
        ----------
        user_id : UUID
            User performing delete.
        organization_id : UUID
            Organization ID.
        note_id : UUID
            Note to delete.
        permanent : bool
            If True, permanently delete. Otherwise soft delete.

        Returns
        -------
        bool
            True if deleted successfully.

        """
        note = await self._fetch_by_id(note_id, organization_id)
        if not note:
            raise NotFoundError("Note", note_id)

        await self._require_delete(user_id, organization_id, note)

        # Collect all note IDs that will be deleted (including children)
        note_ids_to_remove = await self._collect_descendant_ids(note)

        if permanent:
            await queries.permanent_delete_recursive(self.session, note)
        else:
            await queries.soft_delete_recursive(self.session, note)

        # Remove all deleted notes from search index
        for nid in note_ids_to_remove:
            await self.search_indexer.remove(build_content_urn(self.content_type, nid))
        await self.session.commit()

        return True

    async def _collect_descendant_ids(self, note: Note) -> list[UUID]:
        """
        Collect IDs of a note and all its descendants.

        Parameters
        ----------
        note : Note
            Root note to start from.

        Returns
        -------
        list[UUID]
            List of note IDs including the root and all descendants.

        """
        ids = [note.id]
        if note.node_type == NodeType.FOLDER:
            result = await self.session.execute(
                select(Note).where(
                    Note.parent_id == note.id,
                    Note.is_deleted == False,  # noqa: E712
                )
            )
            children = result.scalars().all()
            for child in children:
                ids.extend(await self._collect_descendant_ids(child))
        return ids

    async def restore(
        self,
        user_id: UUID,
        organization_id: UUID,
        note_id: UUID,
    ) -> Note:
        """
        Restore a soft-deleted note.

        Parameters
        ----------
        user_id : UUID
            User performing restore.
        organization_id : UUID
            Organization ID.
        note_id : UUID
            Note to restore.

        Returns
        -------
        Note
            Restored note.

        """
        note = await self._fetch_by_id(note_id, organization_id)
        if not note:
            raise NotFoundError("Note", note_id)

        await self._require_edit(user_id, organization_id, note)

        note.is_deleted = False
        note.deleted_at = None
        note.updated_at = datetime.now(UTC)

        await self.session.commit()
        await self.session.refresh(note)

        # Re-index for search
        group_ids = await self._get_content_group_ids(note.id)
        await self._index_for_search(model=note, group_ids=group_ids)
        await self.session.commit()

        return note

    async def autosave(
        self,
        user_id: UUID,
        organization_id: UUID,
        note_id: UUID,
        content: str,
        title: str | None = None,
    ) -> Note:
        """
        Autosave note content (optimized for frequent updates).

        Parameters
        ----------
        user_id : UUID
            User performing save.
        organization_id : UUID
            Organization ID.
        note_id : UUID
            Note to save.
        content : str
            New content.
        title : str | None
            Optional new title.

        Returns
        -------
        Note
            Updated note.

        """
        note = await self._fetch_by_id(note_id, organization_id)
        if not note:
            raise NotFoundError("Note", note_id)

        await self._require_edit(user_id, organization_id, note)

        note.content = content
        # Update outgoing references and inline tags when content changes
        note.outgoing_references = queries.extract_urns_from_content(content) or None
        note.inline_tags = queries.extract_inline_tags_from_content(content) or None
        if title is not None:
            note.title = title
        note.version += 1
        note.updated_at = datetime.now(UTC)

        await self.session.commit()
        await self.session.refresh(note)

        # Update search index with new content
        group_ids = await self._get_content_group_ids(note.id)
        await self._index_for_search(model=note, group_ids=group_ids)
        await self.session.commit()

        return note

    async def get_backlinks(
        self,
        user_id: UUID,
        organization_id: UUID,
        note_id: UUID,
    ) -> list[Note]:
        """
        Get backlinks for a note (notes that reference it).

        Parameters
        ----------
        user_id : UUID
            User requesting backlinks.
        organization_id : UUID
            Organization ID.
        note_id : UUID
            Target note ID.

        Returns
        -------
        list[Note]
            Notes that reference the target note.

        """
        # Verify user can access target note
        note = await self._fetch_by_id(note_id, organization_id)
        if not note:
            raise NotFoundError("Note", note_id)

        await self._require_access(user_id, organization_id, note)

        # Get backlinks
        all_backlinks = await queries.get_backlinks(self.session, note_id, organization_id)

        # Filter by access permission
        accessible = []
        for backlink in all_backlinks:
            can_access = await self.permission_checker.can_access_content(
                user_id=user_id,
                organization_id=organization_id,
                content_type=self.content_type,
                content_id=backlink.id,
                content_owner_id=backlink.owner_id,
                content_visibility=backlink.visibility,
            )
            if can_access:
                accessible.append(backlink)

        return accessible

    async def empty_trash(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> int:
        """
        Permanently delete all trash notes in organization.

        Parameters
        ----------
        user_id : UUID
            User performing action.
        organization_id : UUID
            Organization ID.

        Returns
        -------
        int
            Number of notes deleted.

        """
        # Collect IDs of all soft-deleted notes before deleting
        result = await self.session.execute(
            select(Note.id).where(
                Note.organization_id == organization_id,
                Note.is_deleted == True,  # noqa: E712
            )
        )
        deleted_note_ids = list(result.scalars().all())

        # Permanently delete all trash notes
        count = await queries.empty_trash(self.session, organization_id)

        # Remove all deleted notes from search index
        for nid in deleted_note_ids:
            await self.search_indexer.remove(build_content_urn(self.content_type, nid))
        await self.session.commit()

        return count

    async def list_notes(
        self,
        user_id: UUID,
        organization_id: UUID,
        parent_id: UUID | None | str = None,
        visibility: VisibilityScope | None = None,
        group_id: UUID | None = None,
        personal_only: bool = False,
        include_deleted: bool = False,
        tags: list[str] | None = None,
        page: int = 1,
        page_size: int = 50,
        sort_by: str = "updated_at",
        sort_order: str = "desc",
    ) -> tuple[list[Note], int]:
        """
        List notes with filters and permission checking.

        Parameters
        ----------
        user_id : UUID
            User requesting list.
        organization_id : UUID
            Organization ID.
        parent_id : UUID | None | str
            Parent filter (None=all, "root"=top level, UUID=specific parent).
        visibility : VisibilityScope | None
            Filter by visibility.
        group_id : UUID | None
            Filter by group.
        personal_only : bool
            Only personal notes.
        include_deleted : bool
            Include trash.
        tags : list[str] | None
            Filter by tags.
        page : int
            Page number.
        page_size : int
            Items per page.
        sort_by : str
            Sort column.
        sort_order : str
            Sort direction (asc/desc).

        Returns
        -------
        tuple[list[Note], int]
            List of notes and total count.

        Note: Bookmark filtering is handled by the BookmarksService.

        """
        query = select(Note).where(Note.organization_id == organization_id)

        # Apply visibility/access filter
        if personal_only:
            personal_filter = self.access_query.build_personal_filter(
                user_id=user_id,
                owner_id_column=Note.owner_id,
                visibility_column=Note.visibility,
            )
            query = query.where(personal_filter)
        elif group_id:
            group_filter = self.access_query.build_group_filter(
                group_id=group_id,
                organization_id=organization_id,
                content_type=self.content_type,
                content_id_column=Note.id,
                visibility_column=Note.visibility,
            )
            query = query.where(group_filter)
        else:
            access_filter = self.access_query.build_accessible_filter(
                user_id=user_id,
                organization_id=organization_id,
                content_type=self.content_type,
                content_id_column=Note.id,
                owner_id_column=Note.owner_id,
                visibility_column=Note.visibility,
            )
            query = query.where(access_filter)

        # Additional filters
        if parent_id == "root":
            query = query.where(Note.parent_id.is_(None))
        elif parent_id:
            query = query.where(Note.parent_id == parent_id)

        if visibility:
            query = query.where(Note.visibility == visibility)

        if not include_deleted:
            query = query.where(Note.is_deleted == False)  # noqa: E712

        if tags:
            for tag in tags:
                query = query.where(Note.tags.contains([tag]))

        # Count total
        count_query = select(func.count()).select_from(query.subquery())
        total = (await self.session.execute(count_query)).scalar() or 0

        # Sort
        sort_col = getattr(Note, sort_by, Note.updated_at)
        if sort_order == "asc":
            query = query.order_by(sort_col.asc())
        else:
            query = query.order_by(sort_col.desc())

        # Paginate
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self.session.execute(query)
        notes = list(result.scalars().all())

        return notes, total

    async def get_notes_sharing_info(
        self,
        notes: list[Note],
        current_user_id: UUID,
    ) -> dict[UUID, NoteSharingInfo]:
        """
        Batch fetch sharing info for multiple notes.

        For notes not owned by current user: returns owner info.
        For notes owned by current user: returns shared_with list.

        Parameters
        ----------
        notes : list[Note]
            List of notes to fetch sharing info for.
        current_user_id : UUID
            Current user ID.

        Returns
        -------
        dict[UUID, NoteSharingInfo]
            Map of note ID to sharing info.

        """
        from datetime import UTC, datetime

        from sqlalchemy import or_

        from uniffy.core.models.login.group import Group
        from uniffy.core.models.login.group_member import GroupMember
        from uniffy.core.models.permissions.content_permission import ContentPermission
        from uniffy.core.types import SubjectType

        result: dict[UUID, NoteSharingInfo] = {}

        # Separate notes by ownership
        notes_shared_with_user: list[Note] = []  # Need owner info
        notes_owned_by_user: list[Note] = []  # Need shared_with list

        for note in notes:
            if note.owner_id != current_user_id:
                notes_shared_with_user.append(note)
            else:
                notes_owned_by_user.append(note)

        # Fetch owner info for notes shared with current user
        if notes_shared_with_user:
            owner_ids = list({note.owner_id for note in notes_shared_with_user})
            owners_result = await self.session.execute(
                select(User).where(User.id.in_(owner_ids))
            )
            owners_map: dict[UUID, User] = {u.id: u for u in owners_result.scalars().all()}

            for note in notes_shared_with_user:
                owner = owners_map.get(note.owner_id)
                result[note.id] = NoteSharingInfo(
                    owner_info={
                        "id": str(note.owner_id),
                        "name": owner.full_name or owner.username if owner else "Unknown",
                        "email": owner.email if owner else "",
                    } if owner else None
                )

        # Fetch shared_with list for notes owned by current user
        if notes_owned_by_user:
            note_ids = [note.id for note in notes_owned_by_user]

            # Fetch explicit permissions (users and groups)
            now = datetime.now(UTC)
            permissions_result = await self.session.execute(
                select(ContentPermission)
                .where(ContentPermission.content_type == self.content_type)
                .where(ContentPermission.content_id.in_(note_ids))
                .where(
                    or_(
                        ContentPermission.expires_at.is_(None),
                        ContentPermission.expires_at > now,
                    )
                )
            )
            permissions = list(permissions_result.scalars().all())

            # Group permissions by note ID
            permissions_by_note: dict[UUID, list[ContentPermission]] = {
                nid: [] for nid in note_ids
            }
            for perm in permissions:
                permissions_by_note[perm.content_id].append(perm)

            # Fetch user info for user permissions
            user_subject_ids = [
                perm.subject_id for perm in permissions
                if perm.subject_type == SubjectType.USER
            ]
            users_map: dict[UUID, User] = {}
            if user_subject_ids:
                users_result = await self.session.execute(
                    select(User).where(User.id.in_(user_subject_ids))
                )
                users_map = {u.id: u for u in users_result.scalars().all()}

            # Fetch group info for group permissions
            group_subject_ids = [
                perm.subject_id for perm in permissions
                if perm.subject_type == SubjectType.GROUP
            ]
            groups_map: dict[UUID, Group] = {}
            group_member_counts: dict[UUID, int] = {}
            if group_subject_ids:
                groups_result = await self.session.execute(
                    select(Group).where(Group.id.in_(group_subject_ids))
                )
                groups_map = {g.id: g for g in groups_result.scalars().all()}

                # Get member counts
                member_counts_result = await self.session.execute(
                    select(
                        GroupMember.group_id,
                        func.count(GroupMember.id).label("count"),
                    )
                    .where(GroupMember.group_id.in_(group_subject_ids))
                    .where(GroupMember.is_active == True)  # noqa: E712
                    .group_by(GroupMember.group_id)
                )
                for row in member_counts_result.all():
                    group_member_counts[row[0]] = row[1]

            # Build shared_with for each note
            for note in notes_owned_by_user:
                note_perms = permissions_by_note.get(note.id, [])
                shared_with: list[dict] = []

                for perm in note_perms:
                    if perm.subject_type == SubjectType.USER:
                        user = users_map.get(perm.subject_id)
                        if user:
                            shared_with.append({
                                "id": str(user.id),
                                "type": "user",
                                "name": user.full_name or user.username,
                                "email": user.email,
                                "member_count": 0,
                                "permission_level": perm.permission_level.value,
                            })
                    elif perm.subject_type == SubjectType.GROUP:
                        group = groups_map.get(perm.subject_id)
                        if group:
                            shared_with.append({
                                "id": str(group.id),
                                "type": "group",
                                "name": group.name,
                                "email": "",
                                "member_count": group_member_counts.get(group.id, 0),
                                "permission_level": perm.permission_level.value,
                            })

                result[note.id] = NoteSharingInfo(
                    shared_with=shared_with if shared_with else None
                )

        return result
