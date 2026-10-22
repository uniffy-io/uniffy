"""Organization name and slug validation shared by the tenant and platform surfaces."""

from __future__ import annotations

import re
import unicodedata
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import ValidationError
from uniffy.core.models.login.organization import Organization

MAX_ORG_NAME_LENGTH = 255
MIN_SLUG_LENGTH = 2
MAX_SLUG_LENGTH = 255

_SLUG_PATTERN = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
_SLUG_SEPARATOR = re.compile(r"[^a-z0-9]+")
_SLUG_UNIQUE_INDEX = "ix_login_organizations_slug"


def normalize_org_name(name: str) -> str:
    name = name.strip()
    if not name:
        raise ValidationError("name", "name is required")
    if len(name) > MAX_ORG_NAME_LENGTH:
        raise ValidationError("name", f"name must be {MAX_ORG_NAME_LENGTH} characters or fewer")
    return name


def _slug_from_name(name: str) -> str:
    """Derives the slug the clients show: NFKD keeps the base letter of an accented one."""
    folded = "".join(
        ch
        for ch in unicodedata.normalize("NFKD", name)
        if not unicodedata.category(ch).startswith("M")
    )
    return _SLUG_SEPARATOR.sub("-", folded.lower()).strip("-")[:MAX_SLUG_LENGTH].rstrip("-")


def normalize_slug(slug: str, *, fallback_name: str = "") -> str:
    slug = slug.strip().lower()
    if not slug and fallback_name:
        slug = _slug_from_name(fallback_name)
    if (
        not slug
        or len(slug) < MIN_SLUG_LENGTH
        or len(slug) > MAX_SLUG_LENGTH
        or _SLUG_PATTERN.fullmatch(slug) is None
    ):
        raise ValidationError(
            "slug",
            "slug must be 2-255 characters of lowercase letters, digits and hyphens",
        )
    return slug


async def ensure_slug_available(
    session: AsyncSession, slug: str, *, exclude_org_id: UUID | None = None
) -> None:
    """Deleted organizations keep their slug until purge, so they count as taken."""
    query = select(Organization.id).where(Organization.slug == slug)
    if exclude_org_id is not None:
        query = query.where(Organization.id != exclude_org_id)
    taken = (await session.execute(query)).scalar_one_or_none()
    if taken is not None:
        raise ValidationError("slug", "Slug is already in use")


def is_slug_conflict(exc: IntegrityError) -> bool:
    """A create or rename that raced ``ensure_slug_available`` loses at the unique index."""
    return _SLUG_UNIQUE_INDEX in str(exc.orig)
