"""Seed a dense, permission-valid bookmark collection for the run actor."""

from uuid import UUID

from sqlalchemy import select

from uniffy.core.models import (
    Bookmark,
    CalendarEvent,
    ChatChannel,
    ChatMessage,
    File,
    Folder,
    Note,
    Project,
    Task,
)
from uniffy.core.models.rooms.room import Room
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import ContentType, NodeType
from uniffy.domains.bookmarks.operations import BookmarksOperations
from uniffy.domains.permissions.access import (
    ResourceAccessPurpose,
    ResourceAccessResolver,
    ResourceKey,
    ResourceRowState,
)
from uniffy.scripts.demo_company.context import DemoContext, DomainResult

BOOKMARK_TARGET_COUNT = 80


async def seed_bookmarks(ctx: DemoContext) -> DomainResult:
    candidates = await _bookmark_candidates(ctx)
    if not candidates:
        return DomainResult()

    decisions = await ResourceAccessResolver(ctx.session).resolve(
        actor_id=ctx.actor_id,
        organization_id=ctx.organization_id,
        keys=candidates,
        purpose=ResourceAccessPurpose.REFERENCE,
    )
    allowed = [
        key
        for key in candidates
        if decisions[key].row_state is ResourceRowState.LIVE and decisions[key].can_view
    ][:BOOKMARK_TARGET_COUNT]

    urns = [build_content_urn(key.content_type, key.content_id) for key in allowed]
    operations = BookmarksOperations(ctx.session, ctx.search)
    existing = await operations.bulk_check(ctx.actor_id, ctx.organization_id, urns)
    missing = [urn for urn in urns if not existing[urn]]
    result = DomainResult(skipped=len(urns) - len(missing))
    if ctx.dry_run:
        result.created = len(missing)
        return result

    for urn in missing:
        is_bookmarked, _ = await operations.toggle(
            ctx.actor_id,
            ctx.organization_id,
            urn,
        )
        if is_bookmarked:
            result.created += 1
        else:
            result.skipped += 1

    rows = list(
        (
            await ctx.session.execute(
                select(Bookmark).where(
                    Bookmark.user_id == ctx.actor_id,
                    Bookmark.organization_id == ctx.organization_id,
                    Bookmark.urn.in_(urns),
                )
            )
        )
        .scalars()
        .all()
    )
    by_urn = {row.urn: row for row in rows}
    for position, urn in enumerate(urns):
        bookmark = by_urn.get(urn)
        if bookmark is not None:
            bookmark.created_at = ctx.historical_datetime(position, len(urns))
    await ctx.session.commit()
    return result


async def _bookmark_candidates(ctx: DemoContext) -> list[ResourceKey]:
    queries = (
        (
            ContentType.NOTE,
            select(Note.id)
            .where(
                Note.organization_id == ctx.organization_id,
                Note.node_type == NodeType.NOTE,
                Note.is_deleted.is_(False),
            )
            .order_by(Note.created_at, Note.id)
            .limit(10),
        ),
        (
            ContentType.FILE,
            select(File.id)
            .where(
                File.organization_id == ctx.organization_id,
                File.is_deleted.is_(False),
            )
            .order_by(File.created_at, File.id)
            .limit(20),
        ),
        (
            ContentType.FOLDER,
            select(Folder.id)
            .where(
                Folder.organization_id == ctx.organization_id,
                Folder.is_system.is_(False),
                Folder.is_deleted.is_(False),
            )
            .order_by(Folder.created_at, Folder.id)
            .limit(5),
        ),
        (
            ContentType.CALENDAR_EVENT,
            select(CalendarEvent.id)
            .where(
                CalendarEvent.organization_id == ctx.organization_id,
                CalendarEvent.is_deleted.is_(False),
            )
            .order_by(CalendarEvent.created_at, CalendarEvent.id)
            .limit(8),
        ),
        (
            ContentType.PROJECT,
            select(Project.id)
            .where(
                Project.organization_id == ctx.organization_id,
                Project.is_deleted.is_(False),
            )
            .order_by(Project.created_at, Project.id)
            .limit(3),
        ),
        (
            ContentType.TASK,
            select(Task.id)
            .where(
                Task.organization_id == ctx.organization_id,
                Task.is_deleted.is_(False),
            )
            .order_by(Task.created_at, Task.id)
            .limit(10),
        ),
        (
            ContentType.ROOM,
            select(Room.id)
            .where(
                Room.organization_id == ctx.organization_id,
                Room.is_deleted.is_(False),
            )
            .order_by(Room.created_at, Room.id)
            .limit(5),
        ),
        (
            ContentType.CHAT,
            select(ChatChannel.id)
            .where(
                ChatChannel.organization_id == ctx.organization_id,
                ChatChannel.is_deleted.is_(False),
            )
            .order_by(ChatChannel.created_at, ChatChannel.id)
            .limit(5),
        ),
        (
            ContentType.CHAT_MESSAGE,
            select(ChatMessage.id)
            .join(ChatChannel, ChatChannel.id == ChatMessage.channel_id)
            .where(
                ChatChannel.organization_id == ctx.organization_id,
                ChatChannel.is_deleted.is_(False),
                ChatMessage.is_deleted.is_(False),
                ChatMessage.root_id.is_(None),
            )
            .order_by(ChatMessage.created_at, ChatMessage.id)
            .limit(14),
        ),
    )
    candidates: list[ResourceKey] = []
    for content_type, query in queries:
        ids: list[UUID] = list((await ctx.session.execute(query)).scalars().all())
        candidates.extend(ResourceKey(content_type, content_id) for content_id in ids)
    return candidates
