"""Single-level cascading VIEWER grants for content references plus rename propagation.

Rules:
- Only explicit member additions trigger a cascade; access-mode changes do not.
- Each cascaded grant is VIEWER regardless of the source role.
- The granting user must have MANAGE on each referenced item; others are skipped.
- References come from ``outgoing_references`` JSONB and the attachments table;
  free-form text is not re-parsed.
- Each reference runs in its own savepoint so partial failures stay isolated.

The rename-propagation helpers rewrite ``[[[label|urn]]]`` mentions and do not
touch access control.
"""

from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.auth.permissions.roles import role_can_manage
from uniffy.core.content.references import (
    parse_urn,
    replace_mention_label,
    replace_mention_label_in_canvas,
)
from uniffy.core.search.indexer import SearchIndexer, build_content_urn
from uniffy.core.types import AccessMode, ContentRole, ContentType, SubjectType

# Hard cap to keep cascade work bounded on heavily-referenced content.
MAX_CASCADE_REFERENCES = 50


async def collect_referenced_content(
    session: AsyncSession,
    content_type: ContentType,
    content_id: UUID,
    organization_id: UUID,
) -> list[tuple[ContentType, UUID]]:
    """Collect referenced content from ``outgoing_references`` + attachments.

    USER URNs are excluded; results are capped at ``MAX_CASCADE_REFERENCES``.
    """
    refs: set[tuple[ContentType, UUID]] = set()

    outgoing_refs = await _fetch_outgoing_references(
        session, content_type, content_id, organization_id
    )
    if outgoing_refs:
        for urn in outgoing_refs:
            parsed = parse_urn(urn)
            if parsed and parsed[0] != ContentType.USER:
                refs.add(parsed)

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
            refs=[f"{rt.value}:{rid}" for rt, rid in ref_list],
        )

    return ref_list


async def cascade_member_grant(
    session: AsyncSession,
    granting_user_id: UUID,
    organization_id: UUID,
    content_type: ContentType,
    content_id: UUID,
    subject_type: SubjectType,
    subject_id: UUID,
) -> None:
    """Cascade a VIEWER grant to referenced content where the actor can manage."""
    refs = await collect_referenced_content(session, content_type, content_id, organization_id)
    if not refs:
        return

    logger.info(
        "Cascading member grant to referenced content",
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
                policy = await _fetch_content_access_policy(
                    session, ref_type, ref_id, organization_id
                )
                if policy is None:
                    skipped.append((ref_type.value, str(ref_id), "not_found"))
                    continue
                ref_owner_id, ref_access_mode, ref_baseline_role = policy

                actor_role = await checker.effective_role(
                    user_id=granting_user_id,
                    organization_id=organization_id,
                    content_type=ref_type,
                    content_id=ref_id,
                    owner_id=ref_owner_id,
                    access_mode=ref_access_mode,
                    baseline_role=ref_baseline_role,
                )
                if not role_can_manage(actor_role):
                    skipped.append((ref_type.value, str(ref_id), "no_manage_rights"))
                    continue

                created = await _upsert_view_member(
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
                    skipped.append((ref_type.value, str(ref_id), "already_member"))
        except Exception:
            logger.warning(
                "Failed to cascade grant for reference",
                ref_type=ref_type.value,
                ref_id=str(ref_id),
                exc_info=True,
            )

    logger.info(
        "Cascade member grant complete",
        source_type=content_type.value,
        source_id=str(content_id),
        granted=[f"{rt.value}:{rid}" for rt, rid in changed_items],
        granted_count=len(changed_items),
        skipped=[f"{t}:{i}({r})" for t, i, r in skipped],
        skipped_count=len(skipped),
    )

    if changed_items:
        await session.commit()
        await _sync_search_sharing_batch(session, organization_id, changed_items)


async def propagate_rename(
    session: AsyncSession,
    organization_id: UUID,
    target_urn: str,
    new_label: str,
) -> int:
    """Rewrite ``[[[label|urn]]]`` mention labels across notes, events and tasks.

    System-initiated: ``updated_at`` bumps but ``version`` does NOT increment,
    to avoid conflict with concurrent user edits.
    """
    updated_notes = await _propagate_rename_notes(
        session,
        organization_id,
        target_urn,
        new_label,
        replace_mention_label,
        replace_mention_label_in_canvas,
    )
    updated_events = await _propagate_rename_calendar_events(
        session,
        organization_id,
        target_urn,
        new_label,
        replace_mention_label,
    )
    updated_tasks = await _propagate_rename_tasks(
        session,
        organization_id,
        target_urn,
        new_label,
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

    await _reindex_renamed_content(
        session,
        updated_notes,
        updated_events,
        updated_tasks,
    )

    return updated_count


async def _fetch_outgoing_references(
    session: AsyncSession,
    content_type: ContentType,
    content_id: UUID,
    organization_id: UUID,
) -> list[str] | None:
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

    if content_type == ContentType.TASK:
        from uniffy.core.models.projects.task import Task

        result = await session.execute(
            select(Task.outgoing_references).where(
                Task.id == content_id,
                Task.organization_id == organization_id,
            )
        )
        return result.scalar_one_or_none()

    return None


async def _fetch_content_access_policy(
    session: AsyncSession,
    content_type: ContentType,
    content_id: UUID,
    organization_id: UUID,
) -> tuple[UUID, AccessMode, ContentRole | None] | None:
    """``(owner_id, access_mode, baseline_role)`` or ``None`` when not found."""
    if content_type == ContentType.NOTE:
        from uniffy.core.models.notes.note import Note

        result = await session.execute(
            select(Note.owner_id, Note.access_mode, Note.baseline_role).where(
                Note.id == content_id,
                Note.organization_id == organization_id,
            )
        )
        row = result.one_or_none()
        if row:
            return row[0], row[1], row[2]
        return None

    if content_type == ContentType.FILE:
        from uniffy.core.models.files.file import File

        result = await session.execute(
            select(File.owner_id, File.access_mode, File.baseline_role).where(
                File.id == content_id,
                File.organization_id == organization_id,
            )
        )
        row = result.one_or_none()
        if row:
            return row[0], row[1], row[2]
        return None

    if content_type == ContentType.CALENDAR_EVENT:
        from uniffy.core.models.calendar.event import CalendarEvent

        result = await session.execute(
            select(
                CalendarEvent.organizer_id,
                CalendarEvent.access_mode,
                CalendarEvent.baseline_role,
            ).where(
                CalendarEvent.id == content_id,
                CalendarEvent.organization_id == organization_id,
            )
        )
        row = result.one_or_none()
        if row:
            return row[0], row[1], row[2]
        return None

    if content_type == ContentType.PROJECT:
        from uniffy.core.models.projects.project import Project

        result = await session.execute(
            select(Project.owner_id, Project.access_mode, Project.baseline_role).where(
                Project.id == content_id,
                Project.organization_id == organization_id,
            )
        )
        row = result.one_or_none()
        if row:
            return row[0], row[1], row[2]
        return None

    if content_type == ContentType.TASK:
        # Tasks delegate to the parent project's access policy.
        from uniffy.core.models.projects.project import Project
        from uniffy.core.models.projects.task import Task

        result = await session.execute(
            select(
                Project.owner_id,
                Project.access_mode,
                Project.baseline_role,
            )
            .join(Project, Task.project_id == Project.id)
            .where(
                Task.id == content_id,
                Task.organization_id == organization_id,
            )
        )
        row = result.one_or_none()
        if row:
            return row[0], row[1], row[2]
        return None

    return None


async def _upsert_view_member(
    session: AsyncSession,
    organization_id: UUID,
    content_type: ContentType,
    content_id: UUID,
    subject_type: SubjectType,
    subject_id: UUID,
    granted_by: UUID,
) -> bool:
    """Create a VIEWER row if the subject has no non-expired row of any role."""
    from uniffy.core.models.permissions.content_member import ContentMember

    now = datetime.now(UTC)
    result = await session.execute(
        select(ContentMember.id).where(
            ContentMember.organization_id == organization_id,
            ContentMember.content_type == content_type,
            ContentMember.content_id == content_id,
            ContentMember.subject_type == subject_type,
            ContentMember.subject_id == subject_id,
            or_(
                ContentMember.expires_at.is_(None),
                ContentMember.expires_at > now,
            ),
        )
    )
    if result.scalar_one_or_none() is not None:
        return False

    member = ContentMember(
        organization_id=organization_id,
        content_type=content_type,
        content_id=content_id,
        subject_type=subject_type,
        subject_id=subject_id,
        role=ContentRole.VIEWER,
        added_by_user_id=granted_by,
    )
    session.add(member)
    return True


async def _sync_search_sharing_batch(
    session: AsyncSession,
    organization_id: UUID,
    items: list[tuple[ContentType, UUID]],
) -> None:
    """Refresh Meilisearch ``shared_*`` / ``blocked_*`` fields for cascaded items."""
    from uniffy.core.models.permissions.content_member import ContentMember

    indexer = SearchIndexer()

    seen: set[tuple[ContentType, UUID]] = set()
    for ct, cid in items:
        if (ct, cid) in seen:
            continue
        seen.add((ct, cid))

        try:
            result = await session.execute(
                select(
                    ContentMember.subject_type,
                    ContentMember.subject_id,
                    ContentMember.role,
                ).where(
                    ContentMember.organization_id == organization_id,
                    ContentMember.content_type == ct,
                    ContentMember.content_id == cid,
                )
            )
            rows = result.all()

            shared_user_ids: list[UUID] = []
            shared_group_ids: list[UUID] = []
            blocked_user_ids: list[UUID] = []
            blocked_group_ids: list[UUID] = []
            for subject_type, subject_id, role in rows:
                if subject_type == SubjectType.USER:
                    if role == ContentRole.BLOCKED:
                        blocked_user_ids.append(subject_id)
                    else:
                        shared_user_ids.append(subject_id)
                elif subject_type == SubjectType.GROUP:
                    if role == ContentRole.BLOCKED:
                        blocked_group_ids.append(subject_id)
                    else:
                        shared_group_ids.append(subject_id)

            urn = build_content_urn(ct, cid)
            await indexer.update_sharing(
                urn=urn,
                organization_id=organization_id,
                shared_user_ids=shared_user_ids,
                shared_group_ids=shared_group_ids,
                blocked_user_ids=blocked_user_ids,
                blocked_group_ids=blocked_group_ids,
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
                note.canvas_content,
                target_urn,
                new_label,
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
    """Re-index updated content after rename propagation; failures are non-fatal."""
    if notes:
        try:
            from uniffy.domains.notes.operations import NoteOperations

            ops = NoteOperations(session)
            for note in notes:
                await ops._index_for_search(note)
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
                await ops._index_for_search(event)
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
                await ops._index_for_search(task)
        except Exception:
            logger.warning(
                "Failed to re-index tasks after rename propagation",
                exc_info=True,
            )
