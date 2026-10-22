"""Self service organization creation, gated by the deployment creation policy."""

from __future__ import annotations

from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import client_ip_for_rate_limit
from uniffy.core.config.org_creation import user_can_create_organization
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import (
    OrganizationMember,
    OrganizationMemberSource,
)
from uniffy.core.models.login.user import User
from uniffy.core.rate_limit import check_rate_limit
from uniffy.core.search.indexer import SearchIndexer
from uniffy.domains.organizations.naming import (
    ensure_slug_available,
    is_slug_conflict,
    normalize_org_name,
    normalize_slug,
)
from uniffy.domains.organizations.operations import OrganizationOperations

logger = logger.bind(component="organizations.creation")

ORG_CREATE_LIMIT_PER_USER = 5
ORG_CREATE_LIMIT_PER_IP = 20
ORG_CREATE_WINDOW_SECONDS = 3600


async def create_organization_for_user(
    session: AsyncSession,
    *,
    user_id: UUID,
    name: str,
    slug: str | None,
    search_indexer: SearchIndexer,
) -> tuple[Organization, OrganizationMember]:
    user = (await session.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        raise NotFoundError("User", str(user_id))
    if not user.is_active:
        raise PermissionDeniedError("This account cannot create organizations")
    if not await user_can_create_organization(session, user):
        raise PermissionDeniedError("Organization creation is not allowed for this account")

    await _enforce_create_rate_limit(user_id)

    clean_name = normalize_org_name(name)
    clean_slug = normalize_slug(slug or "", fallback_name=clean_name)
    await ensure_slug_available(session, clean_slug)

    try:
        org = await OrganizationOperations(session).create(
            name=clean_name,
            slug=clean_slug,
            owner_user_id=user_id,
            plan="free",
            actor_user_id=user_id,
            search_indexer=search_indexer,
            owner_source=OrganizationMemberSource.CREATED,
        )
    except IntegrityError as exc:
        await session.rollback()
        if is_slug_conflict(exc):
            raise ValidationError("slug", "Slug is already in use") from exc
        raise

    membership = (
        await session.execute(
            select(OrganizationMember).where(
                OrganizationMember.organization_id == org.id,
                OrganizationMember.user_id == user_id,
            )
        )
    ).scalar_one()
    logger.info(
        "Organization created by its owner",
        organization_id=str(org.id),
        user_id=str(user_id),
        slug=org.slug,
    )
    return org, membership


async def _enforce_create_rate_limit(user_id: UUID) -> None:
    """The per IP bucket applies only when the address identifies a client, not a proxy."""
    await check_rate_limit(
        key=f"rl:org:create:user:{user_id}",
        limit=ORG_CREATE_LIMIT_PER_USER,
        window_seconds=ORG_CREATE_WINDOW_SECONDS,
        resource="organization creation (per user)",
    )
    ip = client_ip_for_rate_limit()
    if ip:
        await check_rate_limit(
            key=f"rl:org:create:ip:{ip}",
            limit=ORG_CREATE_LIMIT_PER_IP,
            window_seconds=ORG_CREATE_WINDOW_SECONDS,
            resource="organization creation (per ip)",
        )
