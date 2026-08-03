"""Group name and slug resolution: one namespace per org across teams and groups."""

import re
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import ValidationError
from uniffy.core.models.login.group import Group

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def slugify(name: str) -> str:
    return _SLUG_RE.sub("-", name.lower()).strip("-")[:240] or "group"


async def ensure_name_available(
    session: AsyncSession,
    organization_id: UUID,
    name: str,
    exclude_group_id: UUID | None = None,
) -> None:
    """Teams and access groups share one per-org namespace: a duplicate name
    would render as two identical rows in every subject picker."""
    query = select(Group.id).where(
        Group.organization_id == organization_id,
        func.lower(Group.name) == name.lower(),
    )
    if exclude_group_id is not None:
        query = query.where(Group.id != exclude_group_id)
    existing = await session.execute(query.limit(1))
    if existing.scalar_one_or_none() is not None:
        raise ValidationError(
            "name",
            f'a team or group named "{name}" already exists in this organization',
        )


async def resolve_slug(
    session: AsyncSession,
    organization_id: UUID,
    name: str,
    exclude_group_id: UUID | None = None,
) -> str:
    base = slugify(name)
    candidate = base
    suffix = 1
    while True:
        query = select(Group.id).where(
            Group.organization_id == organization_id,
            Group.slug == candidate,
        )
        if exclude_group_id is not None:
            query = query.where(Group.id != exclude_group_id)
        existing = await session.execute(query.limit(1))
        if existing.scalar_one_or_none() is None:
            return candidate
        suffix += 1
        candidate = f"{base}-{suffix}"


async def dedupe_name(
    session: AsyncSession,
    organization_id: UUID,
    base: str,
    exclude_group_id: UUID | None = None,
) -> str:
    """A colliding sync-fed name gets a numeric suffix instead of failing the run."""
    candidate = base
    suffix = 1
    while True:
        query = select(Group.id).where(
            Group.organization_id == organization_id,
            func.lower(Group.name) == candidate.lower(),
        )
        if exclude_group_id is not None:
            query = query.where(Group.id != exclude_group_id)
        existing = await session.execute(query.limit(1))
        if existing.scalar_one_or_none() is None:
            return candidate
        suffix += 1
        candidate = f"{base[:250]} {suffix}"
