"""Target resolution and shared state for a demo seeding run."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import (
    OrganizationMember,
    OrganizationRole,
)
from uniffy.core.models.login.user import User
from uniffy.core.search import SearchIndexer, WorkspaceSearch
from uniffy.core.storage import ObjectStorage
from uniffy.domains.tags.operations import TagOperations
from uniffy.scripts.demo_company.loader import TagSpec

logger = logger.bind(component="scripts.demo_company.context")


class ResolutionError(RuntimeError):
    """The run cannot start: no matching org, actor, or membership."""


@dataclass
class DomainResult:
    created: int = 0
    skipped: int = 0

    def __str__(self) -> str:
        return f"{self.created} created, {self.skipped} skipped"


@dataclass
class SeedReport:
    results: dict[str, DomainResult] = field(default_factory=dict)

    def domain(self, name: str) -> DomainResult:
        return self.results.setdefault(name, DomainResult())


@dataclass(frozen=True)
class DemoContext:
    """Everything the per-domain seeders need, resolved once per run."""

    session: AsyncSession
    storage: ObjectStorage
    search: WorkspaceSearch
    search_indexer: SearchIndexer
    organization_id: UUID
    actor_id: UUID
    timezone: str
    history_days: int
    anchor: datetime
    now: datetime
    dry_run: bool

    def local_datetime(self, day_offset: int, clock: str) -> datetime:
        """Wall-clock time in the org timezone, returned UTC-aware for storage."""
        hour, _, minute = clock.partition(":")
        local = self.anchor + timedelta(days=day_offset)
        local = local.replace(hour=int(hour), minute=int(minute or 0), second=0, microsecond=0)
        return local.astimezone(UTC)

    def historical_datetime(self, position: int, total: int) -> datetime:
        if total <= 1:
            days_ago = self.history_days
        else:
            distance = position * (self.history_days - 1) / (total - 1)
            days_ago = self.history_days - round(distance)
        return self.now - timedelta(days=max(1, days_ago))


async def resolve_organization(session: AsyncSession, slug: str | None) -> Organization:
    if slug:
        row = (
            await session.execute(select(Organization).where(Organization.slug == slug))
        ).scalar_one_or_none()
        if row is None:
            raise ResolutionError(f"No organization with slug {slug!r}")
        return row

    rows = (
        (
            await session.execute(
                select(Organization)
                .where(Organization.deleted_at.is_(None))
                .order_by(Organization.created_at)
            )
        )
        .scalars()
        .all()
    )
    if not rows:
        raise ResolutionError("No organizations exist yet; start the backend once to bootstrap one")
    if len(rows) > 1:
        logger.warning(
            f"{len(rows)} organizations found, using the oldest ({rows[0].slug}). "
            f"Pass --org-slug to pick another."
        )
    return rows[0]


async def resolve_actor(
    session: AsyncSession,
    organization_id: UUID,
    email: str | None,
) -> User:
    """The owner of every seeded row: an explicit email, else the org owner."""
    query = (
        select(User)
        .join(OrganizationMember, OrganizationMember.user_id == User.id)
        .where(
            OrganizationMember.organization_id == organization_id,
            OrganizationMember.is_active == True,  # noqa: E712
        )
    )
    if email:
        row = (await session.execute(query.where(User.email == email))).scalar_one_or_none()
        if row is None:
            raise ResolutionError(f"{email!r} is not an active member of this organization")
        return row

    row = (
        (await session.execute(query.where(OrganizationMember.role == OrganizationRole.OWNER)))
        .scalars()
        .first()
    )
    if row is None:
        raise ResolutionError(
            "This organization has no active owner; pass --actor-email to choose an actor"
        )
    return row


async def resolve_member_ids(
    session: AsyncSession,
    organization_id: UUID,
    emails: tuple[str, ...],
) -> list[UUID]:
    """Attendee lookup that tolerates a demo dataset naming users this org lacks."""
    if not emails:
        return []

    rows = (
        await session.execute(
            select(User.id, User.email)
            .join(OrganizationMember, OrganizationMember.user_id == User.id)
            .where(
                OrganizationMember.organization_id == organization_id,
                OrganizationMember.is_active == True,  # noqa: E712
                User.email.in_(emails),
            )
        )
    ).all()

    found = {row.email for row in rows}
    for missing in sorted(set(emails) - found):
        logger.warning(f"Attendee {missing} is not a member of this organization, skipping")
    return [row.id for row in rows]


def anchor_from_date(day: datetime | None, timezone: str) -> datetime:
    """Monday 00:00 local of the anchor week; every event offsets from it."""
    tz = ZoneInfo(timezone)
    base = (day or datetime.now(tz)).astimezone(tz)
    monday = base - timedelta(days=base.weekday())
    return monday.replace(hour=0, minute=0, second=0, microsecond=0)


async def ensure_tags(
    ctx: DemoContext,
    specs: tuple[TagSpec, ...],
) -> dict[str, UUID]:
    """Tag creation folds into the existing row when the slug is taken."""
    tag_ids: dict[str, UUID] = {}
    if ctx.dry_run:
        return tag_ids

    ops = TagOperations(ctx.session, ctx.search_indexer)
    for spec in specs:
        tag = await ops.create(
            actor_id=ctx.actor_id,
            organization_id=ctx.organization_id,
            name=spec.name,
            color=spec.color,
        )
        tag_ids[spec.name] = tag.id
    logger.info(f"Resolved {len(tag_ids)} tags")
    return tag_ids


def tag_ids_for(tag_ids: dict[str, UUID], names: tuple[str, ...]) -> list[UUID]:
    resolved = []
    for name in names:
        tag_id = tag_ids.get(name)
        if tag_id is None:
            logger.warning(f"Tag {name!r} is not declared in manifest.json, skipping it")
            continue
        resolved.append(tag_id)
    return resolved
