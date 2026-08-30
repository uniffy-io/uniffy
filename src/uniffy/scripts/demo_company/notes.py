"""Seed the note tree: folders, documents, and the mentions between them."""

from __future__ import annotations

from uuid import UUID

from loguru import logger
from sqlalchemy import select

from uniffy.core.models.notes.note import Note
from uniffy.core.types import AccessMode, ContentRole, NodeType
from uniffy.domains.notes.operations import NoteOperations
from uniffy.scripts.demo_company.context import DemoContext, DomainResult, tag_ids_for
from uniffy.scripts.demo_company.loader import NoteSpec
from uniffy.scripts.demo_company.mentions import NOTE, MentionRegistry

logger = logger.bind(component="scripts.demo_company.notes")


async def seed_notes(
    ctx: DemoContext,
    notes: tuple[NoteSpec, ...],
    root_folder: str,
    tag_ids: dict[str, UUID],
    registry: MentionRegistry,
) -> DomainResult:
    """Create the folder tree and the notes in it, registering each note's URN."""
    result = DomainResult()
    ops = NoteOperations(ctx.session, search_indexer=ctx.search_indexer)

    folder_ids: dict[tuple[str, ...], UUID | None] = {
        (): await _ensure_folder(ctx, ops, root_folder, None, result)
    }

    for spec in notes:
        path: tuple[str, ...] = ()
        for folder_name in spec.folder_path:
            parent_id = folder_ids[path]
            path = (*path, folder_name)
            if path not in folder_ids:
                folder_ids[path] = await _ensure_folder(ctx, ops, folder_name, parent_id, result)

        existing = await _find_note(ctx, spec.slug)
        if existing is not None:
            registry.register(NOTE, spec.source_name, existing.id)
            result.skipped += 1
            continue

        if ctx.dry_run:
            where = "/".join(spec.folder_path) or root_folder
            logger.info(f"[dry-run] note {spec.title!r} in {where}")
            result.created += 1
            continue

        note = await ops.create(
            user_id=ctx.actor_id,
            organization_id=ctx.organization_id,
            title=spec.title,
            content=spec.body,
            slug=spec.slug,
            access_mode=AccessMode.OPEN_TO_ORG,
            baseline_role=ContentRole.EDITOR,
            node_type=NodeType.NOTE,
            parent_id=folder_ids[path],
            tag_ids=tag_ids_for(tag_ids, spec.tags),
        )
        registry.register(NOTE, spec.source_name, note.id)
        result.created += 1
        logger.info(f"Created note {note.title!r}")

    return result


async def apply_note_mentions(
    ctx: DemoContext,
    notes: tuple[NoteSpec, ...],
    registry: MentionRegistry,
) -> int:
    """Rewrite note bodies into mentions once every domain has registered its URNs."""
    if ctx.dry_run:
        return 0

    ops = NoteOperations(ctx.session, search_indexer=ctx.search_indexer)
    updated = 0

    for spec in notes:
        linked = registry.rewrite(spec.body, source=spec.source_name)
        if linked == spec.body:
            continue

        note = await _find_note(ctx, spec.slug)
        if note is None or note.content == linked:
            continue

        await ops.update(
            user_id=ctx.actor_id,
            organization_id=ctx.organization_id,
            note_id=note.id,
            content=linked,
        )
        updated += 1
        logger.info(f"Linked mentions in {spec.title!r}")

    return updated


async def _ensure_folder(
    ctx: DemoContext,
    ops: NoteOperations,
    name: str,
    parent_id: UUID | None,
    result: DomainResult,
) -> UUID | None:
    query = select(Note).where(
        Note.organization_id == ctx.organization_id,
        Note.node_type == NodeType.FOLDER,
        Note.title == name,
        Note.is_deleted == False,  # noqa: E712
    )
    query = (
        query.where(Note.parent_id == parent_id)
        if parent_id
        else query.where(Note.parent_id.is_(None))
    )

    existing = (await ctx.session.execute(query)).scalars().first()
    if existing is not None:
        return existing.id

    if ctx.dry_run:
        logger.info(f"[dry-run] folder {name!r}")
        result.created += 1
        return None

    folder = await ops.create(
        user_id=ctx.actor_id,
        organization_id=ctx.organization_id,
        title=name,
        access_mode=AccessMode.OPEN_TO_ORG,
        baseline_role=ContentRole.EDITOR,
        node_type=NodeType.FOLDER,
        parent_id=parent_id,
    )
    result.created += 1
    logger.info(f"Created folder {name!r}")
    return folder.id


async def _find_note(ctx: DemoContext, slug: str) -> Note | None:
    return (
        (
            await ctx.session.execute(
                select(Note).where(
                    Note.organization_id == ctx.organization_id,
                    Note.slug == slug,
                    Note.is_deleted == False,  # noqa: E712
                )
            )
        )
        .scalars()
        .first()
    )
