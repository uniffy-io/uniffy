"""The demo persona, the org's people, their teams and access groups."""

from __future__ import annotations

from datetime import timedelta
from uuid import UUID

from loguru import logger
from sqlalchemy import select

from uniffy.core.auth.passwords.crypto import hash_password
from uniffy.core.models.login.group import Group, GroupKind
from uniffy.core.models.login.group_member import GroupMember, GroupRole
from uniffy.core.models.login.organization_member import (
    OrganizationMember,
    OrganizationRole,
)
from uniffy.core.models.login.user import User
from uniffy.domains.directory.groups.lifecycle import GroupOperations
from uniffy.domains.directory.groups.members import GroupMemberOperations
from uniffy.domains.directory.groups.naming import slugify
from uniffy.domains.directory.people.operations import PeopleOperations
from uniffy.domains.directory.projection import sync_people_search
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.scripts.demo_company.context import DemoContext, DomainResult, SeedReport
from uniffy.scripts.demo_company.loader import (
    DemoUser,
    GroupSpec,
    PeopleContent,
    PersonSpec,
    TeamSpec,
)
from uniffy.scripts.demo_company.mentions import USER, MentionRegistry

logger = logger.bind(component="scripts.demo_company.people")


async def seed_people(ctx: DemoContext, content: PeopleContent, report: SeedReport) -> None:
    """People first: notes, events, projects and chat all point at them.

    The four stages are ordered by what they depend on. Manager edges need
    every login to exist, team leads need the profiles they are read next to,
    and the search documents denormalize both, so the re-index closes the run.
    """
    users = report.domain("users")
    user_ids: dict[str, UUID] = {}
    for spec in content.people:
        user_id = await _ensure_person(ctx, spec, users)
        if user_id is not None:
            user_ids[spec.email] = user_id

    profiles = report.domain("profiles")
    for spec in content.people:
        await _apply_profile(ctx, spec, user_ids, profiles)

    teams = report.domain("teams")
    team_ids: dict[str, UUID] = {}
    for spec in content.teams:
        team_id = await _ensure_team(ctx, spec, user_ids, team_ids, teams)
        if team_id is not None:
            team_ids[spec.name] = team_id

    groups = report.domain("groups")
    for spec in content.access_groups:
        await _ensure_access_group(ctx, spec, user_ids, groups)

    if not ctx.dry_run:
        # Job title, department and team name are denormalized into every
        # member's search document and mention chip.
        await sync_people_search(
            ctx.session,
            ctx.search_indexer,
            ctx.organization_id,
            list(user_ids.values()),
        )


async def _ensure_person(ctx: DemoContext, spec: PersonSpec, result: DomainResult) -> UUID | None:
    existing = (
        await ctx.session.execute(select(User).where(User.email == spec.email))
    ).scalar_one_or_none()

    if ctx.dry_run:
        logger.info(f"[dry-run] person {spec.email}")
        if existing:
            result.skipped += 1
        else:
            result.created += 1
        return existing.id if existing else None

    user = existing
    if user is None:
        if not spec.username:
            # A profile-only entry decorates an identity created elsewhere.
            logger.warning(f"No user {spec.email} to attach a profile to, skipping")
            return None
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
        logger.info(f"Created user {spec.full_name} ({spec.email})")
    else:
        result.skipped += 1

    # add_member is the whole onboarding path (membership, user search index,
    # attachments folder, default channel joins, audit row) and is idempotent.
    await OrganizationOperations(ctx.session, search_indexer=ctx.search_indexer).add_member(
        user_id=user.id,
        org_id=ctx.organization_id,
        role=OrganizationRole.MEMBER,
        actor_user_id=ctx.actor_id,
    )
    return user.id


async def _apply_profile(
    ctx: DemoContext,
    spec: PersonSpec,
    user_ids: dict[str, UUID],
    result: DomainResult,
) -> None:
    if ctx.dry_run:
        logger.info(f"[dry-run] profile {spec.email}: {spec.job_title}")
        result.created += 1
        return

    user_id = user_ids.get(spec.email)
    if user_id is None:
        return

    changes: dict[str, object] = {"job_title": spec.job_title, "department": spec.department}
    if spec.office_location:
        changes["office_location"] = spec.office_location
    changes["start_date"] = (ctx.now - timedelta(days=spec.start_days_ago)).date()

    manager_id = user_ids.get(spec.manager) if spec.manager else None
    if spec.manager and manager_id is None:
        logger.warning(f"{spec.email} reports to {spec.manager}, who was not seeded")

    ops = PeopleOperations(ctx.session, ctx.search_indexer)
    current = await ops.get_profile(ctx.organization_id, user_id)
    if (
        current is not None
        and current.manager_user_id == manager_id
        and all(getattr(current, field) == value for field, value in changes.items())
    ):
        result.skipped += 1
        return

    await ops.update_person_profile(ctx.organization_id, ctx.actor_id, user_id, changes)
    if manager_id is not None:
        await ops.set_manager(ctx.organization_id, ctx.actor_id, user_id, manager_id)
    result.created += 1


async def _ensure_team(
    ctx: DemoContext,
    spec: TeamSpec,
    user_ids: dict[str, UUID],
    team_ids: dict[str, UUID],
    result: DomainResult,
) -> UUID | None:
    if ctx.dry_run:
        logger.info(f"[dry-run] team {spec.name!r} with {len(spec.members)} members")
        result.created += 1
        return None

    lead_id = user_ids.get(spec.lead) if spec.lead else None
    if spec.lead and lead_id is None:
        logger.warning(f"Team {spec.name!r} is led by {spec.lead}, who was not seeded")

    group = await _ensure_group(
        ctx,
        name=spec.name,
        description=spec.description,
        kind=GroupKind.TEAM,
        result=result,
        parent_group_id=team_ids.get(spec.parent) if spec.parent else None,
        lead_user_id=lead_id,
    )
    await _ensure_group_members(
        ctx,
        group,
        [(user_ids[email], GroupRole.MEMBER) for email in spec.members if email in user_ids],
        result,
    )
    return group.id


async def _ensure_access_group(
    ctx: DemoContext,
    spec: GroupSpec,
    user_ids: dict[str, UUID],
    result: DomainResult,
) -> None:
    if ctx.dry_run:
        logger.info(f"[dry-run] access group {spec.name!r} with {len(spec.members)} members")
        result.created += 1
        return

    group = await _ensure_group(
        ctx,
        name=spec.name,
        description=spec.description,
        kind=GroupKind.ACCESS,
        result=result,
        is_private=spec.is_private,
    )
    await _ensure_group_members(
        ctx,
        group,
        [
            (user_ids[member.email], GroupRole(member.role))
            for member in spec.members
            if member.email in user_ids
        ],
        result,
    )


async def _ensure_group(
    ctx: DemoContext,
    *,
    name: str,
    description: str,
    kind: GroupKind,
    result: DomainResult,
    is_private: bool = False,
    parent_group_id: UUID | None = None,
    lead_user_id: UUID | None = None,
) -> Group:
    slug = slugify(name)
    existing = (
        await ctx.session.execute(
            select(Group).where(
                Group.organization_id == ctx.organization_id,
                Group.slug == slug,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        result.skipped += 1
        return existing

    group = await GroupOperations(ctx.session, ctx.search_indexer).create(
        organization_id=ctx.organization_id,
        name=name,
        created_by_user_id=ctx.actor_id,
        description=description or None,
        is_private=is_private,
        kind=kind,
        parent_group_id=parent_group_id,
        lead_user_id=lead_user_id,
    )
    result.created += 1
    logger.info(f"Created {kind.value} group {name!r}")
    return group


async def _ensure_group_members(
    ctx: DemoContext,
    group: Group,
    members: list[tuple[UUID, GroupRole]],
    result: DomainResult,
) -> None:
    current = {
        row[0]
        for row in (
            await ctx.session.execute(
                select(GroupMember.user_id).where(GroupMember.group_id == group.id)
            )
        ).all()
    }
    ops = GroupMemberOperations(ctx.session, ctx.search_indexer)
    for user_id, role in members:
        if user_id in current:
            continue
        await ops.add_member(
            group_id=group.id,
            organization_id=ctx.organization_id,
            user_id=user_id,
            actor_user_id=ctx.actor_id,
            role=role,
        )
        result.created += 1


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
    await OrganizationOperations(ctx.session, search_indexer=ctx.search_indexer).add_member(
        user_id=user.id,
        org_id=ctx.organization_id,
        role=OrganizationRole.MEMBER,
        actor_user_id=ctx.actor_id,
    )

    # The password stays out of the log: --password exists so a deployment can
    # use one that is not in the repository, and logs outlive the run.
    logger.info(f"Demo login: {spec.email}")
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
