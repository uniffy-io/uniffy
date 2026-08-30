"""Orchestration for a demo-company seeding run."""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from pathlib import Path

from loguru import logger

from uniffy.core.search import SearchIndexer
from uniffy.core.storage import ObjectStorage
from uniffy.infrastructure.database.session import open_session
from uniffy.scripts.demo_company.agents import seed_agents
from uniffy.scripts.demo_company.chat import seed_chat
from uniffy.scripts.demo_company.context import (
    DemoContext,
    DomainResult,
    SeedReport,
    anchor_from_date,
    ensure_tags,
    resolve_actor,
    resolve_organization,
)
from uniffy.scripts.demo_company.events import apply_event_mentions, seed_events
from uniffy.scripts.demo_company.files import seed_files
from uniffy.scripts.demo_company.loader import DemoContent, load_demo_content
from uniffy.scripts.demo_company.mentions import MentionRegistry
from uniffy.scripts.demo_company.notes import apply_note_mentions, seed_notes
from uniffy.scripts.demo_company.people import (
    ensure_demo_user,
    register_user_mentions,
    seed_people,
)
from uniffy.scripts.demo_company.projects import seed_projects
from uniffy.scripts.demo_company.rooms import seed_rooms

logger = logger.bind(component="scripts.demo_company.seeder")


class DemoDomain(StrEnum):
    USERS = "users"
    AGENTS = "agents"
    NOTES = "notes"
    FILES = "files"
    ROOMS = "rooms"
    EVENTS = "events"
    PROJECTS = "projects"
    CHAT = "chat"


DOMAINS = tuple(DemoDomain)


async def seed_demo_company(
    *,
    storage: ObjectStorage,
    search_indexer: SearchIndexer,
    content_dir: Path | None = None,
    org_slug: str | None = None,
    actor_email: str | None = None,
    anchor_date: datetime | None = None,
    only: tuple[DemoDomain, ...] = DOMAINS,
    dry_run: bool = False,
    password: str | None = None,
) -> SeedReport:
    """Seed one org with a demo knowledge base; safe to re-run, existing rows are left alone."""
    content = load_demo_content(content_dir, password=password)
    report = SeedReport()

    async with open_session() as session:
        organization = await resolve_organization(session, org_slug)
        actor = await resolve_actor(session, organization.id, actor_email)
        logger.info(
            f"Seeding {content.manifest.company} into {organization.name} "
            f"({organization.slug}) as {actor.email}"
        )

        ctx = DemoContext(
            session=session,
            storage=storage,
            search_indexer=search_indexer,
            organization_id=organization.id,
            actor_id=actor.id,
            timezone=content.manifest.timezone,
            anchor=anchor_from_date(anchor_date, content.manifest.timezone),
            now=datetime.now(UTC),
            dry_run=dry_run,
        )

        tag_ids = await ensure_tags(ctx, content.manifest.tags)
        await _run_domains(ctx, content, tag_ids, only, report)

    _log_report(report, dry_run=dry_run)
    return report


async def _run_domains(
    ctx: DemoContext,
    content: DemoContent,
    tag_ids: dict,
    only: tuple[DemoDomain, ...],
    report: SeedReport,
) -> None:
    root_folder = content.manifest.root_folder
    registry = MentionRegistry()

    # People come first: notes, events, projects and chat all point at them,
    # and chat adds the persona to every open channel.
    persona = DomainResult()
    demo_user_id = await ensure_demo_user(ctx, content.manifest.demo_user, persona)
    report.results["persona"] = persona

    if DemoDomain.USERS in only:
        await seed_people(ctx, content.people, report)

    await register_user_mentions(ctx, registry)

    if DemoDomain.AGENTS in only:
        report.results["agents"] = await seed_agents(ctx, content.agents)

    if DemoDomain.NOTES in only:
        report.results["notes"] = await seed_notes(
            ctx, content.notes, root_folder, tag_ids, registry
        )

    if DemoDomain.FILES in only:
        report.results["files"] = await seed_files(
            ctx, content.files, root_folder, tag_ids, registry
        )

    # Rooms come before events: an event that books a room needs the row.
    if DemoDomain.ROOMS in only:
        report.results["rooms"] = await seed_rooms(ctx, content.rooms, registry)

    if DemoDomain.EVENTS in only:
        report.results["events"] = await seed_events(
            ctx,
            content.events,
            tag_ids,
            registry,
            known_rooms=frozenset(room.name for room in content.rooms),
        )

    if DemoDomain.PROJECTS in only:
        report.results["projects"] = await seed_projects(ctx, content.projects, tag_ids)

    # Mentions resolve once every id exists: a note can point at a room, file or
    # event created in this same run. Ahead of chat, which is the long stretch -
    # a failure there must not cost the relationships.
    mentions = DomainResult()
    if DemoDomain.NOTES in only:
        mentions.created += await apply_note_mentions(ctx, content.notes, registry)
    if DemoDomain.EVENTS in only:
        mentions.created += await apply_event_mentions(ctx, content.events, registry)
    report.results["mentions"] = mentions

    # Chat last: a message can mention anything above, resolved as it is sent.
    if DemoDomain.CHAT in only:
        report.results["chat"] = await seed_chat(
            ctx, content.chat, registry, demo_user_id=demo_user_id
        )


def _log_report(report: SeedReport, *, dry_run: bool) -> None:
    prefix = "[dry-run] " if dry_run else ""
    logger.info(f"{prefix}Demo seeding finished")
    for domain, result in report.results.items():
        logger.info(f"{prefix}  {domain}: {result}")
