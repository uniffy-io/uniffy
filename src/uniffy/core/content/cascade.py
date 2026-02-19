"""Generic cascading sharing for content with references.

When content is shared (via permission grant or visibility change),
this module propagates VIEW access to referenced content -- URN mentions
and attached files. The cascade is single-level only (non-recursive)
to avoid unbounded propagation.

Cascade rules:
- Permission grants: grant VIEW to same subject on each referenced item
  the granting user can share; silently skip if no SHARE rights.
- Visibility changes to GROUP: grant VIEW to target groups on each
  referenced item the user can share (both owned and non-owned).
  Referenced content visibility is never changed.
- Visibility changes to ORGANIZATION: change visibility of owned
  referenced content to ORGANIZATION; skip non-owned (no mechanism for
  org-wide grant on foreign content). The frontend MUST show a
  confirmation warning before ORGANIZATION moves.
- Visibility changes to PRIVATE: no cascade (reducing access does not
  propagate).

Security notes:
- References are collected from ``outgoing_references`` (JSONB) and the
  attachments table only. Free-form text content is NOT re-parsed to
  prevent injection of arbitrary URNs or file URLs by editors who have
  EDIT but not SHARE rights on referenced content.
- All content queries are scoped to the current ``organization_id`` to
  enforce tenant isolation.
- The number of references processed is capped at MAX_CASCADE_REFERENCES
  to prevent denial-of-service via content with many references.
- Each reference grant is wrapped in a savepoint so partial failures
  do not corrupt the overall transaction.
"""

from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.content.references import (
    parse_urn,
    replace_mention_label,
    replace_mention_label_in_canvas,
)
from uniffy.core.search.indexer import SearchIndexer, build_content_urn
from uniffy.core.types import ContentType, PermissionLevel, SubjectType, VisibilityScope

# Maximum number of references to cascade per operation.
# Prevents unbounded DB queries when content has many references.
MAX_CASCADE_REFERENCES = 50


async def collect_referenced_content(
    session: AsyncSession,
    content_type: ContentType,
    content_id: UUID,
    organization_id: UUID,
) -> list[tuple[ContentType, UUID]]:
    """Collect content referenced by a given content item.

    Gathers references from two authoritative sources:
    1. ``outgoing_references`` JSONB field (URN list, set at save time)
    2. Attachments table (file links)

    Free-form text is NOT re-parsed to avoid injection vectors.
    USER-type URNs are excluded (users do not need permission cascade).
    Results are capped at ``MAX_CASCADE_REFERENCES``.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    content_type : ContentType
        Type of the source content.
    content_id : UUID
        ID of the source content.
    organization_id : UUID
        Organization context (enforces tenant isolation).

    Returns
    -------
    list[tuple[ContentType, UUID]]
        Deduplicated list of (content_type, content_id) pairs.

    """
    refs: set[tuple[ContentType, UUID]] = set()

    # 1. Parse URNs from outgoing_references JSONB field
    outgoing_refs = await _fetch_outgoing_references(
        session, content_type, content_id, organization_id
    )
    if outgoing_refs:
        for urn in outgoing_refs:
            parsed = parse_urn(urn)
            if parsed and parsed[0] != ContentType.USER:
                refs.add(parsed)

    # 2. Query attachments table (org-scoped)
    from uniffy.core.models.attachments.attachment import Attachment

    result = await session.execute(
        select(Attachment.file_id).where(
            Attachment.content_type == content_type,
            Attachment.content_id == content_id,
            Attachment.organization_id == organization_id,
        )
    )
    for (file_id,) in result.all():
        refs.add((ContentType.FILE, file_id))

    # Cap to prevent unbounded processing
    ref_list = list(refs)
    if len(ref_list) > MAX_CASCADE_REFERENCES:
        logger.warning(
            "Cascade reference count exceeds limit, truncating",
            content_type=content_type.value,
            content_id=str(content_id),
            total=len(ref_list),
            limit=MAX_CASCADE_REFERENCES,
        )
        ref_list = ref_list[:MAX_CASCADE_REFERENCES]

    if ref_list:
        logger.info(
            "Collected referenced content for cascade",
            source_type=content_type.value,
            source_id=str(content_id),
            ref_count=len(ref_list),
            refs=[
                f"{rt.value}:{rid}" for rt, rid in ref_list
            ],
        )

    return ref_list


async def cascade_permission_grant(
    session: AsyncSession,
    granting_user_id: UUID,
    organization_id: UUID,
    content_type: ContentType,
    content_id: UUID,
    subject_type: SubjectType,
    subject_id: UUID,
) -> None:
    """Cascade VIEW permission to content referenced by an item.

    Called after an explicit permission grant on any content type.
    For each referenced item, checks whether the granting user can
    share it, and if so upserts a VIEW permission for the same subject.

    Each reference is processed in its own savepoint to ensure that
    a failure on one reference does not roll back grants on others.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    granting_user_id : UUID
        User who granted the original permission.
    organization_id : UUID
        Organization context.
    content_type : ContentType
        Type of the shared content.
    content_id : UUID
        ID of the shared content.
    subject_type : SubjectType
        Type of the permission subject (USER or GROUP).
    subject_id : UUID
        ID of the permission subject.

    """
    refs = await collect_referenced_content(
        session, content_type, content_id, organization_id
    )
    if not refs:
        return

    logger.info(
        "Cascading permission grant to referenced content",
        source_type=content_type.value,
        source_id=str(content_id),
        subject_type=subject_type.value,
        subject_id=str(subject_id),
        ref_count=len(refs),
    )

    checker = PermissionChecker(session)
    changed_items: list[tuple[ContentType, UUID]] = []
    skipped: list[tuple[str, str, str]] = []

    for ref_type, ref_id in refs:
        try:
            async with session.begin_nested():
                owner_vis = await _fetch_content_owner_and_visibility(
                    session, ref_type, ref_id, organization_id
                )
                if owner_vis is None:
                    skipped.append((ref_type.value, str(ref_id), "not_found"))
                    continue
                ref_owner_id, _ = owner_vis

                can_share = await checker.can_share_content(
                    user_id=granting_user_id,
                    organization_id=organization_id,
                    content_type=ref_type,
                    content_id=ref_id,
                    content_owner_id=ref_owner_id,
                )
                if not can_share:
                    skipped.append((ref_type.value, str(ref_id), "no_share_rights"))
                    continue

                created = await _upsert_view_permission(
                    session,
                    organization_id,
                    ref_type,
                    ref_id,
                    subject_type,
                    subject_id,
                    granting_user_id,
                )
                if created:
                    changed_items.append((ref_type, ref_id))
                else:
                    skipped.append((ref_type.value, str(ref_id), "already_shared"))
        except Exception:
            logger.warning(
                "Failed to cascade permission for reference",
                ref_type=ref_type.value,
                ref_id=str(ref_id),
                exc_info=True,
            )

    logger.info(
        "Cascade permission grant complete",
        source_type=content_type.value,
        source_id=str(content_id),
        granted=[f"{rt.value}:{rid}" for rt, rid in changed_items],
        granted_count=len(changed_items),
        skipped=[f"{t}:{i}({r})" for t, i, r in skipped],
        skipped_count=len(skipped),
    )

    if changed_items:
        await session.commit()
        await _sync_search_sharing_batch(
            session, organization_id, changed_items
        )


async def cascade_visibility_change(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
    content_type: ContentType,
    content_id: UUID,
    target_visibility: VisibilityScope,
    target_group_ids: list[UUID] | None = None,
) -> None:
    """Cascade access to content referenced by a moved item.

    Called after a move operation changes visibility:
    - PRIVATE: no cascade (reducing access does not propagate).
    - GROUP: grants VIEW to target groups on referenced content the
      user can share. Does not change referenced content visibility.
    - ORGANIZATION: for owned referenced content, changes visibility
      to ORGANIZATION. For non-owned, skips (no org-wide grant
      mechanism). The frontend MUST show a confirmation warning before
      triggering an ORGANIZATION move because this promotes referenced
      private content to org-wide visibility.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    user_id : UUID
        User performing the move.
    organization_id : UUID
        Organization context.
    content_type : ContentType
        Type of the moved content.
    content_id : UUID
        ID of the moved content.
    target_visibility : VisibilityScope
        New visibility scope.
    target_group_ids : list[UUID] | None
        Group IDs for GROUP visibility.

    """
    if target_visibility == VisibilityScope.PRIVATE:
        return

    refs = await collect_referenced_content(
        session, content_type, content_id, organization_id
    )
    if not refs:
        return

    logger.info(
        "Cascading visibility change to referenced content",
        source_type=content_type.value,
        source_id=str(content_id),
        target_visibility=target_visibility.value,
        target_group_ids=[str(g) for g in (target_group_ids or [])],
        ref_count=len(refs),
    )

    checker = PermissionChecker(session)
    changed_items: list[tuple[ContentType, UUID]] = []
    skipped: list[tuple[str, str, str]] = []

    for ref_type, ref_id in refs:
        try:
            async with session.begin_nested():
                owner_vis = await _fetch_content_owner_and_visibility(
                    session, ref_type, ref_id, organization_id
                )
                if owner_vis is None:
                    skipped.append((ref_type.value, str(ref_id), "not_found"))
                    continue
                ref_owner_id, _ = owner_vis

                can_share = await checker.can_share_content(
                    user_id=user_id,
                    organization_id=organization_id,
                    content_type=ref_type,
                    content_id=ref_id,
                    content_owner_id=ref_owner_id,
                )
                if not can_share:
                    skipped.append((ref_type.value, str(ref_id), "no_share_rights"))
                    continue

                if target_visibility == VisibilityScope.ORGANIZATION:
                    if ref_owner_id != user_id:
                        skipped.append((ref_type.value, str(ref_id), "not_owner"))
                        continue
                    await _update_content_visibility(
                        session,
                        ref_type,
                        ref_id,
                        organization_id,
                        user_id,
                        VisibilityScope.ORGANIZATION,
                    )
                    changed_items.append((ref_type, ref_id))

                elif target_visibility == VisibilityScope.GROUP:
                    for group_id in target_group_ids or []:
                        created = await _upsert_view_permission(
                            session,
                            organization_id,
                            ref_type,
                            ref_id,
                            SubjectType.GROUP,
                            group_id,
                            user_id,
                        )
                        if created:
                            changed_items.append((ref_type, ref_id))
        except Exception:
            logger.warning(
                "Failed to cascade visibility for reference",
                ref_type=ref_type.value,
                ref_id=str(ref_id),
                exc_info=True,
            )

    logger.info(
        "Cascade visibility change complete",
        source_type=content_type.value,
        source_id=str(content_id),
        target_visibility=target_visibility.value,
        cascaded=[f"{rt.value}:{rid}" for rt, rid in changed_items],
        cascaded_count=len(changed_items),
        skipped=[f"{t}:{i}({r})" for t, i, r in skipped],
        skipped_count=len(skipped),
    )

    if changed_items:
        await session.commit()
        await _sync_search_sharing_batch(
            session, organization_id, changed_items
        )


async def propagate_rename(
    session: AsyncSession,
    organization_id: UUID,
    target_urn: str,
    new_label: str,
) -> int:
    """Propagate a rename to all content that mentions the target URN.

    When a file or note is renamed, this updates the label in all
    ``[[[old_label|urn]]]`` mentions across Notes, CalendarEvents,
    and Tasks that reference the renamed item.

    Only processes items whose ``outgoing_references`` JSONB column
    contains the target URN (efficient index-backed filter). Canvas
    notes have their text nodes updated via
    ``replace_mention_label_in_canvas()``.

    This is a system-initiated change: ``updated_at`` is bumped but
    ``version`` is NOT incremented to avoid conflict with user edits.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    organization_id : UUID
        Organization scope (tenant isolation).
    target_urn : str
        URN of the renamed content (e.g. ``urn:uniffy:content:FILE:uuid``).
    new_label : str
        New display label (filename or note title).

    Returns
    -------
    int
        Number of content items updated.

    """
    updated_notes = await _propagate_rename_notes(
        session, organization_id, target_urn, new_label,
        replace_mention_label, replace_mention_label_in_canvas,
    )
    updated_events = await _propagate_rename_calendar_events(
        session, organization_id, target_urn, new_label,
        replace_mention_label,
    )
    updated_tasks = await _propagate_rename_tasks(
        session, organization_id, target_urn, new_label,
        replace_mention_label,
    )

    updated_count = len(updated_notes) + len(updated_events) + len(updated_tasks)

    if updated_count:
        logger.info(
            "Propagated rename to mentioning content",
            target_urn=target_urn,
            new_label=new_label,
            updated_count=updated_count,
        )

    # Re-index updated content in search
    await _reindex_renamed_content(
        session, updated_notes, updated_events, updated_tasks,
    )

    return updated_count


# ─────────────────────────────────────────────────────────────────
# Private helpers
# ─────────────────────────────────────────────────────────────────


async def _fetch_outgoing_references(
    session: AsyncSession,
    content_type: ContentType,
    content_id: UUID,
    organization_id: UUID,
) -> list[str] | None:
    """Fetch the outgoing_references JSONB field for a content item.

    Queries are scoped to ``organization_id`` for tenant isolation.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    content_type : ContentType
        Type of content.
    content_id : UUID
        ID of content.
    organization_id : UUID
        Organization context.

    Returns
    -------
    list[str] | None
        List of URN strings, or None if not found / not applicable.

    """
    if content_type == ContentType.NOTE:
        from uniffy.core.models.notes.note import Note

        result = await session.execute(
            select(Note.outgoing_references).where(
                Note.id == content_id,
                Note.organization_id == organization_id,
            )
        )
        return result.scalar_one_or_none()

    if content_type == ContentType.CALENDAR_EVENT:
        from uniffy.core.models.calendar.event import CalendarEvent

        result = await session.execute(
            select(CalendarEvent.outgoing_references).where(
                CalendarEvent.id == content_id,
                CalendarEvent.organization_id == organization_id,
            )
        )
        return result.scalar_one_or_none()

    return None


async def _fetch_content_owner_and_visibility(
    session: AsyncSession,
    content_type: ContentType,
    content_id: UUID,
    organization_id: UUID,
) -> tuple[UUID, VisibilityScope] | None:
    """Fetch owner_id and visibility for a content item.

    Queries are scoped to ``organization_id`` for tenant isolation.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    content_type : ContentType
        Type of content.
    content_id : UUID
        ID of content.
    organization_id : UUID
        Organization context.

    Returns
    -------
    tuple[UUID, VisibilityScope] | None
        (owner_id, visibility) or None if content not found in org.

    """
    if content_type == ContentType.NOTE:
        from uniffy.core.models.notes.note import Note

        result = await session.execute(
            select(Note.owner_id, Note.visibility).where(
                Note.id == content_id,
                Note.organization_id == organization_id,
            )
        )
        row = result.one_or_none()
        if row:
            return row[0], row[1]
        return None

    if content_type == ContentType.FILE:
        from uniffy.core.models.files.file import File

        result = await session.execute(
            select(File.owner_id, File.visibility).where(
                File.id == content_id,
                File.organization_id == organization_id,
            )
        )
        row = result.one_or_none()
        if row:
            return row[0], row[1]
        return None

    if content_type == ContentType.CALENDAR_EVENT:
        from uniffy.core.models.calendar.event import CalendarEvent

        result = await session.execute(
            select(
                CalendarEvent.organizer_id, CalendarEvent.visibility
            ).where(
                CalendarEvent.id == content_id,
                CalendarEvent.organization_id == organization_id,
            )
        )
        row = result.one_or_none()
        if row:
            return row[0], row[1]
        return None

    return None


async def _update_content_visibility(
    session: AsyncSession,
    content_type: ContentType,
    content_id: UUID,
    organization_id: UUID,
    owner_id: UUID,
    new_visibility: VisibilityScope,
) -> None:
    """Update visibility on content the user owns within an organization.

    Scoped to ``organization_id`` and ``owner_id`` for defense-in-depth:
    even if the caller already verified ownership, the UPDATE itself
    will be a no-op if those conditions are not met.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    content_type : ContentType
        Type of content.
    content_id : UUID
        ID of content.
    organization_id : UUID
        Organization context (tenant isolation).
    owner_id : UUID
        Expected owner (defense-in-depth).
    new_visibility : VisibilityScope
        New visibility scope to set.

    """
    from sqlalchemy import update

    if content_type == ContentType.NOTE:
        from uniffy.core.models.notes.note import Note

        await session.execute(
            update(Note)
            .where(
                Note.id == content_id,
                Note.organization_id == organization_id,
                Note.owner_id == owner_id,
            )
            .values(visibility=new_visibility)
        )

    elif content_type == ContentType.FILE:
        from uniffy.core.models.files.file import File

        # When promoting to ORGANIZATION, also move the file to root
        # so it is not trapped inside a private folder invisible to
        # other organization members.
        values: dict = {"visibility": new_visibility}
        if new_visibility == VisibilityScope.ORGANIZATION:
            values["folder_id"] = None

        await session.execute(
            update(File)
            .where(
                File.id == content_id,
                File.organization_id == organization_id,
                File.owner_id == owner_id,
            )
            .values(**values)
        )

    elif content_type == ContentType.CALENDAR_EVENT:
        from uniffy.core.models.calendar.event import CalendarEvent

        await session.execute(
            update(CalendarEvent)
            .where(
                CalendarEvent.id == content_id,
                CalendarEvent.organization_id == organization_id,
                CalendarEvent.organizer_id == owner_id,
            )
            .values(visibility=new_visibility)
        )


async def _upsert_view_permission(
    session: AsyncSession,
    organization_id: UUID,
    content_type: ContentType,
    content_id: UUID,
    subject_type: SubjectType,
    subject_id: UUID,
    granted_by: UUID,
) -> bool:
    """Create a VIEW permission if one does not already exist.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    organization_id : UUID
        Organization context.
    content_type : ContentType
        Type of content.
    content_id : UUID
        ID of content.
    subject_type : SubjectType
        Type of the permission subject.
    subject_id : UUID
        ID of the subject.
    granted_by : UUID
        User granting the permission.

    Returns
    -------
    bool
        True if a new permission was created, False if already existed.

    """
    from datetime import UTC, datetime

    from sqlalchemy import or_

    from uniffy.core.models.permissions.content_permission import ContentPermission

    now = datetime.now(UTC)
    result = await session.execute(
        select(ContentPermission.id).where(
            ContentPermission.organization_id == organization_id,
            ContentPermission.content_type == content_type,
            ContentPermission.content_id == content_id,
            ContentPermission.subject_type == subject_type,
            ContentPermission.subject_id == subject_id,
            or_(
                ContentPermission.expires_at.is_(None),
                ContentPermission.expires_at > now,
            ),
        )
    )
    if result.scalar_one_or_none() is not None:
        return False

    permission = ContentPermission(
        organization_id=organization_id,
        content_type=content_type,
        content_id=content_id,
        subject_type=subject_type,
        subject_id=subject_id,
        permission_level=PermissionLevel.VIEW,
        can_view=True,
        can_edit=False,
        can_delete=False,
        can_share=False,
        can_move=False,
        granted_by_user_id=granted_by,
    )
    session.add(permission)
    return True


async def _sync_search_sharing_batch(
    session: AsyncSession,
    organization_id: UUID,
    items: list[tuple[ContentType, UUID]],
) -> None:
    """Sync search sharing metadata for a batch of content items.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    organization_id : UUID
        Organization context.
    items : list[tuple[ContentType, UUID]]
        List of (content_type, content_id) pairs to sync.

    """
    from uniffy.core.models.permissions.content_permission import ContentPermission

    indexer = SearchIndexer()

    # Deduplicate
    seen: set[tuple[ContentType, UUID]] = set()
    for ct, cid in items:
        if (ct, cid) in seen:
            continue
        seen.add((ct, cid))

        try:
            result = await session.execute(
                select(
                    ContentPermission.subject_type,
                    ContentPermission.subject_id,
                ).where(
                    ContentPermission.organization_id == organization_id,
                    ContentPermission.content_type == ct,
                    ContentPermission.content_id == cid,
                )
            )
            rows = result.all()

            shared_user_ids: list[UUID] = []
            shared_group_ids: list[UUID] = []
            for subject_type, subject_id in rows:
                if subject_type == SubjectType.USER:
                    shared_user_ids.append(subject_id)
                elif subject_type == SubjectType.GROUP:
                    shared_group_ids.append(subject_id)

            urn = build_content_urn(ct, cid)
            await indexer.update_sharing(
                urn=urn,
                organization_id=organization_id,
                shared_user_ids=shared_user_ids,
                shared_group_ids=shared_group_ids,
            )
        except Exception:
            logger.warning(
                "Failed to sync search sharing for cascaded content",
                content_type=ct.value,
                content_id=str(cid),
                exc_info=True,
            )


async def _propagate_rename_notes(
    session: AsyncSession,
    organization_id: UUID,
    target_urn: str,
    new_label: str,
    replace_fn: object,
    replace_canvas_fn: object,
) -> list:
    """Update mention labels in notes that reference target_urn.

    Returns the list of Note models that were updated.
    """
    from uniffy.core.models.notes.note import Note
    from uniffy.core.models.shared import NodeType

    result = await session.execute(
        select(Note).where(
            Note.organization_id == organization_id,
            Note.is_deleted == False,  # noqa: E712
            Note.outgoing_references.contains([target_urn]),
        )
    )
    notes = list(result.scalars().all())
    updated: list[Note] = []

    for note in notes:
        changed = False

        if note.node_type == NodeType.CANVAS and note.canvas_content:
            new_canvas, canvas_changed = replace_canvas_fn(
                note.canvas_content, target_urn, new_label,
            )
            if canvas_changed:
                note.canvas_content = new_canvas
                changed = True
        elif note.content:
            new_content = replace_fn(note.content, target_urn, new_label)
            if new_content != note.content:
                note.content = new_content
                changed = True

        if changed:
            note.updated_at = datetime.now(UTC)
            updated.append(note)

    if updated:
        await session.flush()

    return updated


async def _propagate_rename_calendar_events(
    session: AsyncSession,
    organization_id: UUID,
    target_urn: str,
    new_label: str,
    replace_fn: object,
) -> list:
    """Update mention labels in calendar events that reference target_urn.

    Returns the list of CalendarEvent models that were updated.
    """
    from uniffy.core.models.calendar.event import CalendarEvent

    result = await session.execute(
        select(CalendarEvent).where(
            CalendarEvent.organization_id == organization_id,
            CalendarEvent.outgoing_references.contains([target_urn]),
        )
    )
    events = list(result.scalars().all())
    updated: list[CalendarEvent] = []

    for event in events:
        if not event.description:
            continue
        new_desc = replace_fn(event.description, target_urn, new_label)
        if new_desc != event.description:
            event.description = new_desc
            event.updated_at = datetime.now(UTC)
            updated.append(event)

    if updated:
        await session.flush()

    return updated


async def _propagate_rename_tasks(
    session: AsyncSession,
    organization_id: UUID,
    target_urn: str,
    new_label: str,
    replace_fn: object,
) -> list:
    """Update mention labels in tasks that reference target_urn.

    Returns the list of Task models that were updated.
    """
    from uniffy.core.models.projects.task import Task

    result = await session.execute(
        select(Task).where(
            Task.organization_id == organization_id,
            Task.outgoing_references.contains([target_urn]),
        )
    )
    tasks = list(result.scalars().all())
    updated: list[Task] = []

    for task in tasks:
        if not task.description:
            continue
        new_desc = replace_fn(task.description, target_urn, new_label)
        if new_desc != task.description:
            task.description = new_desc
            task.updated_at = datetime.now(UTC)
            updated.append(task)

    if updated:
        await session.flush()

    return updated


async def _reindex_renamed_content(
    session: AsyncSession,
    notes: list,
    events: list,
    tasks: list,
) -> None:
    """Re-index updated content in search after mention label replacement.

    Uses the domain operations classes to rebuild search keywords and
    re-index each updated model. Failures are logged but non-fatal.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    notes : list
        Updated Note models.
    events : list
        Updated CalendarEvent models.
    tasks : list
        Updated Task models.

    """
    if notes:
        try:
            from uniffy.domains.notes.operations import NoteOperations

            ops = NoteOperations(session)
            for note in notes:
                group_ids = await ops._get_content_group_ids(note.id)
                await ops._index_for_search(model=note, group_ids=group_ids)
        except Exception:
            logger.warning(
                "Failed to re-index notes after rename propagation",
                exc_info=True,
            )

    if events:
        try:
            from uniffy.domains.calendar.operations import CalendarEventOperations

            ops = CalendarEventOperations(session)
            for event in events:
                group_ids = await ops._get_content_group_ids(event.id)
                await ops._index_for_search(model=event, group_ids=group_ids)
        except Exception:
            logger.warning(
                "Failed to re-index calendar events after rename propagation",
                exc_info=True,
            )

    if tasks:
        try:
            from uniffy.domains.projects.operations import TaskOperations

            ops = TaskOperations(session)
            for task in tasks:
                group_ids = await ops._get_content_group_ids(task.id)
                await ops._index_for_search(model=task, group_ids=group_ids)
        except Exception:
            logger.warning(
                "Failed to re-index tasks after rename propagation",
                exc_info=True,
            )
