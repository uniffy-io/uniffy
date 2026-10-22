"""Organization name and slug validation shared by the tenant and platform surfaces."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import ValidationError
from uniffy.core.models.login.organization import Organization
from uniffy.core.types import slugify

MAX_ORG_NAME_LENGTH = 255
MIN_SLUG_LENGTH = 2
MAX_SLUG_LENGTH = 255


def normalize_org_name(name: str) -> str:
    name = name.strip()
    if not name:
        raise ValidationError("name", "name is required")
    if len(name) > MAX_ORG_NAME_LENGTH:
        raise ValidationError("name", f"name must be {MAX_ORG_NAME_LENGTH} characters or fewer")
    return name


def normalize_slug(slug: str, *, fallback_name: str = "") -> str:
    slug = slug.strip().lower()
    if not slug and fallback_name:
        slug = slugify(fallback_name, max_length=MAX_SLUG_LENGTH)
    if (
        not slug
        or len(slug) < MIN_SLUG_LENGTH
        or len(slug) > MAX_SLUG_LENGTH
        or slug != slugify(slug)
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
