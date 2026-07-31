"""The demo persona and the user mentions that point at real people."""

from __future__ import annotations

from uuid import UUID

from loguru import logger
from sqlalchemy import select

from uniffy.core.models.login.organization_member import (
    OrganizationMember,
    OrganizationRole,
)
from uniffy.core.models.login.user import User
from uniffy.domains.auth.passwords import hash_password
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.scripts.demo_company.context import DemoContext, DomainResult
from uniffy.scripts.demo_company.loader import DemoUser
from uniffy.scripts.demo_company.mentions import USER, MentionRegistry

logger = logger.bind(component="scripts.demo_company.people")


async def ensure_demo_user(
    ctx: DemoContext,
    spec: DemoUser | None,
    result: DomainResult,
) -> UUID | None:
    """Create the browse-the-app account as an ordinary member of the organization."""
    if spec is None:
        return None

    existing = (
        await ctx.session.execute(select(User).where(User.email == spec.email))
    ).scalar_one_or_none()

    if ctx.dry_run:
        logger.info(f"[dry-run] demo user {spec.email}")
        result.created += 0 if existing else 1
        return existing.id if existing else None

    user = existing
    if user is None:
        user = User(
            email=spec.email,
            username=spec.username,
            full_name=spec.full_name,
            hashed_password=hash_password(spec.password),
            is_active=True,
            is_system_admin=False,
            email_verified=True,
        )
        ctx.session.add(user)
        await ctx.session.commit()
        await ctx.session.refresh(user)
        result.created += 1
        logger.info(f"Created demo user {spec.full_name} ({spec.email})")
    else:
        result.skipped += 1

    # add_member is the whole onboarding path: membership, user search index,
    # attachments folder, default channel joins, audit row, cache invalidation.
    await OrganizationOperations(ctx.session).add_member(
        user_id=user.id,
        org_id=ctx.organization_id,
        role=OrganizationRole.MEMBER,
        actor_user_id=ctx.actor_id,
    )

    logger.info(f"Demo login: {spec.email} / {spec.password}")
    return user.id


async def register_user_mentions(ctx: DemoContext, registry: MentionRegistry) -> None:
    """Let content point at people by email, the same way it points at rooms by name."""
    rows = (
        await ctx.session.execute(
            select(User.email, User.id)
            .join(OrganizationMember, OrganizationMember.user_id == User.id)
            .where(
                OrganizationMember.organization_id == ctx.organization_id,
                OrganizationMember.is_active == True,  # noqa: E712
            )
        )
    ).all()

    for row in rows:
        registry.register(USER, row.email, row.id)
