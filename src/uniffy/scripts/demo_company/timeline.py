"""Keep the seeded workspace's stored timestamps relative to each run."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from loguru import logger
from sqlalchemy import func, select

from uniffy.core.models import (
    Agent,
    CalendarEvent,
    ChatChannel,
    ChatChannelCategory,
    ChatMessage,
    EventAttendee,
    File,
    FileVersion,
    Folder,
    Group,
    Note,
    OrganizationMember,
    Project,
    ProviderKey,
    Tag,
    Task,
    User,
)
from uniffy.core.models.rooms.room import Room
from uniffy.core.types import NodeType
from uniffy.scripts.demo_company.context import DemoContext
from uniffy.scripts.demo_company.loader import DEMO_MESSAGE_KEY, DemoContent

logger = logger.bind(component="scripts.demo_company.timeline")

USERS_DOMAIN = "users"
AGENTS_DOMAIN = "agents"
NOTES_DOMAIN = "notes"
FILES_DOMAIN = "files"
ROOMS_DOMAIN = "rooms"
EVENTS_DOMAIN = "events"
PROJECTS_DOMAIN = "projects"
CHAT_DOMAIN = "chat"


async def apply_demo_timeline(
    ctx: DemoContext,
    content: DemoContent,
    domains: set[str],
) -> None:
    touched = await _spread_tags(ctx, content)
    if USERS_DOMAIN in domains:
        touched += await _spread_users(ctx, content)
        touched += await _spread_groups(ctx, content)
    if NOTES_DOMAIN in domains:
        touched += await _spread_notes(ctx, content)
    if FILES_DOMAIN in domains:
        touched += await _spread_files(ctx, content)
    if ROOMS_DOMAIN in domains:
        touched += await _spread_rooms(ctx, content)
    if EVENTS_DOMAIN in domains:
        touched += await _spread_events(ctx, content)
    if PROJECTS_DOMAIN in domains:
        touched += await _spread_projects(ctx, content)
    if AGENTS_DOMAIN in domains:
        touched += await _spread_agents(ctx, content)
    if CHAT_DOMAIN in domains:
        touched += await _align_chat(ctx, content)

    await ctx.session.commit()
    logger.info(f"Applied the {ctx.history_days}-day demo timeline to {touched} rows")


def _stamp_rows(ctx: DemoContext, rows: list[Any]) -> int:
    for position, row in enumerate(rows):
        stamp = ctx.historical_datetime(position, len(rows))
        row.created_at = stamp
        if hasattr(row, "updated_at"):
            row.updated_at = stamp
    return len(rows)


async def _spread_tags(ctx: DemoContext, content: DemoContent) -> int:
    names = [spec.name for spec in content.manifest.tags]
    rows = list(
        (
            await ctx.session.execute(
                select(Tag).where(
                    Tag.organization_id == ctx.organization_id,
                    Tag.name.in_(names),
                )
            )
        )
        .scalars()
        .all()
    )
    by_name = {row.name: row for row in rows}
    return _stamp_rows(ctx, [by_name[name] for name in names if name in by_name])


async def _spread_users(ctx: DemoContext, content: DemoContent) -> int:
    specs = content.people.people
    emails = [spec.email for spec in specs]
    users = list(
        (await ctx.session.execute(select(User).where(User.email.in_(emails)))).scalars().all()
    )
    by_email = {user.email: user for user in users}
    ordered = [by_email[spec.email] for spec in specs if spec.email in by_email]

    user_stamps = {
        by_email[spec.email].id: ctx.now - timedelta(days=spec.start_days_ago)
        for spec in specs
        if spec.email in by_email
    }
    for user in ordered:
        stamp = user_stamps[user.id]
        user.created_at = stamp
        user.updated_at = stamp

    memberships = list(
        (
            await ctx.session.execute(
                select(OrganizationMember).where(
                    OrganizationMember.organization_id == ctx.organization_id,
                    OrganizationMember.user_id.in_(user_stamps),
                )
            )
        )
        .scalars()
        .all()
    )
    for membership in memberships:
        stamp = user_stamps[membership.user_id]
        membership.joined_at = stamp
        membership.updated_at = stamp
    return len(ordered) + len(memberships)


async def _spread_groups(ctx: DemoContext, content: DemoContent) -> int:
    names = [spec.name for spec in content.people.teams]
    names.extend(spec.name for spec in content.people.access_groups)
    rows = list(
        (
            await ctx.session.execute(
                select(Group).where(
                    Group.organization_id == ctx.organization_id,
                    Group.name.in_(names),
                )
            )
        )
        .scalars()
        .all()
    )
    by_name = {row.name: row for row in rows}
    return _stamp_rows(ctx, [by_name[name] for name in names if name in by_name])


async def _spread_notes(ctx: DemoContext, content: DemoContent) -> int:
    slugs = [spec.slug for spec in content.notes]
    notes = list(
        (
            await ctx.session.execute(
                select(Note).where(
                    Note.organization_id == ctx.organization_id,
                    Note.slug.in_(slugs),
                    Note.is_deleted.is_(False),
                )
            )
        )
        .scalars()
        .all()
    )
    by_slug = {row.slug: row for row in notes}
    ordered = [by_slug[slug] for slug in slugs if slug in by_slug]

    folder_names = list(
        dict.fromkeys(
            [content.manifest.root_folder]
            + [name for spec in content.notes for name in spec.folder_path]
        )
    )
    folders = list(
        (
            await ctx.session.execute(
                select(Note).where(
                    Note.organization_id == ctx.organization_id,
                    Note.node_type == NodeType.FOLDER,
                    Note.title.in_(folder_names),
                    Note.is_deleted.is_(False),
                )
            )
        )
        .scalars()
        .all()
    )
    by_title = {row.title: row for row in folders}
    ordered = [by_title[name] for name in folder_names if name in by_title] + ordered
    return _stamp_rows(ctx, ordered)


async def _spread_files(ctx: DemoContext, content: DemoContent) -> int:
    filenames = [spec.filename for spec in content.files]
    files = list(
        (
            await ctx.session.execute(
                select(File).where(
                    File.organization_id == ctx.organization_id,
                    File.filename.in_(filenames),
                    File.is_deleted.is_(False),
                )
            )
        )
        .scalars()
        .all()
    )
    by_filename = {row.filename: row for row in files}
    ordered_files = [by_filename[name] for name in filenames if name in by_filename]

    folder_names = list(
        dict.fromkeys([content.manifest.root_folder] + [spec.folder for spec in content.files])
    )
    folders = list(
        (
            await ctx.session.execute(
                select(Folder).where(
                    Folder.organization_id == ctx.organization_id,
                    Folder.name.in_(folder_names),
                    Folder.is_deleted.is_(False),
                )
            )
        )
        .scalars()
        .all()
    )
    by_name = {row.name: row for row in folders}
    ordered: list[Any] = [by_name[name] for name in folder_names if name in by_name]
    ordered.extend(ordered_files)
    touched = _stamp_rows(ctx, ordered)

    versions = list(
        (
            await ctx.session.execute(
                select(FileVersion).where(FileVersion.file_id.in_([row.id for row in ordered_files]))
            )
        )
        .scalars()
        .all()
    )
    stamps = {row.id: row.created_at for row in ordered_files}
    for version in versions:
        version.created_at = stamps[version.file_id]
    return touched + len(versions)


async def _spread_rooms(ctx: DemoContext, content: DemoContent) -> int:
    names = [spec.name for spec in content.rooms]
    rows = list(
        (
            await ctx.session.execute(
                select(Room).where(
                    Room.organization_id == ctx.organization_id,
                    Room.name.in_(names),
                    Room.is_deleted.is_(False),
                )
            )
        )
        .scalars()
        .all()
    )
    by_name = {row.name: row for row in rows}
    return _stamp_rows(ctx, [by_name[name] for name in names if name in by_name])


async def _spread_events(ctx: DemoContext, content: DemoContent) -> int:
    titles = [spec.title for spec in content.events]
    events = list(
        (
            await ctx.session.execute(
                select(CalendarEvent).where(
                    CalendarEvent.organization_id == ctx.organization_id,
                    CalendarEvent.title.in_(titles),
                    CalendarEvent.is_deleted.is_(False),
                )
            )
        )
        .scalars()
        .all()
    )
    by_title = {row.title: row for row in events}
    ordered = [by_title[title] for title in titles if title in by_title]
    touched = _stamp_rows(ctx, ordered)
    stamps = {row.id: row.created_at for row in ordered}

    attendees = list(
        (await ctx.session.execute(select(EventAttendee).where(EventAttendee.event_id.in_(stamps))))
        .scalars()
        .all()
    )
    for attendee in attendees:
        attendee.created_at = stamps[attendee.event_id]
        attendee.updated_at = stamps[attendee.event_id]
    return touched + len(attendees)


async def _spread_projects(ctx: DemoContext, content: DemoContent) -> int:
    slugs = [spec.slug for spec in content.projects]
    projects = list(
        (
            await ctx.session.execute(
                select(Project).where(
                    Project.organization_id == ctx.organization_id,
                    Project.slug.in_(slugs),
                    Project.is_deleted.is_(False),
                )
            )
        )
        .scalars()
        .all()
    )
    by_slug = {row.slug: row for row in projects}
    ordered_projects = [by_slug[slug] for slug in slugs if slug in by_slug]

    tasks = list(
        (
            await ctx.session.execute(
                select(Task).where(
                    Task.project_id.in_([row.id for row in ordered_projects]),
                    Task.is_deleted.is_(False),
                )
            )
        )
        .scalars()
        .all()
    )
    task_map = {(row.project_id, row.title): row for row in tasks}
    ordered_tasks = [
        task_map[(project.id, task.title)]
        for spec in content.projects
        if (project := by_slug.get(spec.slug)) is not None
        for task in spec.tasks
        if (project.id, task.title) in task_map
    ]
    return _stamp_rows(ctx, [*ordered_projects, *ordered_tasks])


async def _spread_agents(ctx: DemoContext, content: DemoContent) -> int:
    names = [spec.name for spec in content.agents.agents]
    agents = list(
        (
            await ctx.session.execute(
                select(Agent).where(
                    Agent.organization_id == ctx.organization_id,
                    Agent.name.in_(names),
                    Agent.is_deleted.is_(False),
                )
            )
        )
        .scalars()
        .all()
    )
    by_name = {row.name: row for row in agents}
    ordered: list[Any] = [by_name[name] for name in names if name in by_name]

    labels = [spec.key_label for spec in content.agents.agents]
    keys = list(
        (
            await ctx.session.execute(
                select(ProviderKey).where(
                    ProviderKey.organization_id == ctx.organization_id,
                    ProviderKey.label.in_(labels),
                )
            )
        )
        .scalars()
        .all()
    )
    by_label = {row.label: row for row in keys}
    ordered.extend(by_label[label] for label in labels if label in by_label)
    return _stamp_rows(ctx, ordered)


async def _align_chat(ctx: DemoContext, content: DemoContent) -> int:
    names = [spec.name for spec in content.chat.channels]
    channels = list(
        (
            await ctx.session.execute(
                select(ChatChannel).where(
                    ChatChannel.organization_id == ctx.organization_id,
                    ChatChannel.name.in_(names),
                    ChatChannel.is_deleted.is_(False),
                )
            )
        )
        .scalars()
        .all()
    )
    if not channels:
        return 0

    activity = (
        await ctx.session.execute(
            select(
                ChatMessage.channel_id,
                func.min(ChatMessage.created_at),
                func.max(ChatMessage.created_at),
            )
            .where(
                ChatMessage.channel_id.in_([row.id for row in channels]),
                ChatMessage.message_metadata[DEMO_MESSAGE_KEY].as_string().is_not(None),
                ChatMessage.is_deleted.is_(False),
            )
            .group_by(ChatMessage.channel_id)
        )
    ).all()
    by_channel = {row[0]: (row[1], row[2]) for row in activity}
    for channel in channels:
        if stamps := by_channel.get(channel.id):
            channel.created_at, channel.updated_at = stamps

    category_names = list(dict.fromkeys(content.chat.categories))
    categories = list(
        (
            await ctx.session.execute(
                select(ChatChannelCategory).where(
                    ChatChannelCategory.organization_id == ctx.organization_id,
                    ChatChannelCategory.name.in_(category_names),
                )
            )
        )
        .scalars()
        .all()
    )
    category_activity: dict[Any, list[Any]] = {}
    for channel in channels:
        if channel.category_id is not None and channel.id in by_channel:
            category_activity.setdefault(channel.category_id, []).append(by_channel[channel.id])
    for category in categories:
        if stamps := category_activity.get(category.id):
            category.created_at = min(item[0] for item in stamps)
            category.updated_at = max(item[1] for item in stamps)
    return len(channels) + len(categories)
