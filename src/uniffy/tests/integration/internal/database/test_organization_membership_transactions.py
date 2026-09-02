"""Organization membership transactions against PostgreSQL."""

import asyncio
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from sqlalchemy import delete, func, select, text

from uniffy.core.audit.actions import Action
from uniffy.core.errors import ValidationError
from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.chat.channel import ChannelType, ChatChannel, ChatChannelStats
from uniffy.core.models.chat.channel_member import ChatChannelMember
from uniffy.core.models.files.folder import Folder
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.login.user import User
from uniffy.core.types import SubjectType, generate_id
from uniffy.infrastructure.database import open_session
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.domains.directory.projection import UserDirectoryProjection

pytestmark = pytest.mark.asyncio(loop_scope="session")


@pytest_asyncio.fixture(loop_scope="session")
async def membership_env(session):
    suffix = generate_id().hex[:12]
    admin = User(
        email=f"membership-admin-{suffix}@test.local",
        username=f"membership-admin-{suffix}",
        hashed_password="x",
    )
    targets = [
        User(
            email=f"membership-target-{index}-{suffix}@test.local",
            username=f"membership-target-{index}-{suffix}",
            hashed_password="x",
        )
        for index in range(4)
    ]
    org = Organization(
        name=f"membership {suffix}",
        slug=f"membership-{suffix}",
    )
    session.add_all([admin, *targets, org])
    await session.flush()
    session.add(
        OrganizationMember(
            user_id=admin.id,
            organization_id=org.id,
            role=OrganizationRole.ADMIN,
        )
    )
    await session.commit()
    env = NS(
        org_id=org.id,
        admin_id=admin.id,
        target_ids=[target.id for target in targets],
        user_ids=[admin.id, *(target.id for target in targets)],
    )

    try:
        yield env
    finally:
        await session.rollback()
        channel_ids = list(
            (
                await session.execute(
                    select(ChatChannel.id).where(ChatChannel.organization_id == env.org_id)
                )
            ).scalars()
        )
        if channel_ids:
            await session.execute(
                delete(ChatChannelMember).where(ChatChannelMember.channel_id.in_(channel_ids))
            )
            await session.execute(delete(ChatChannel).where(ChatChannel.id.in_(channel_ids)))
        await session.execute(delete(Folder).where(Folder.organization_id == env.org_id))
        await session.execute(text("SET LOCAL uniffy.audit_maintenance = 'on'"))
        await session.execute(delete(AuditEvent).where(AuditEvent.organization_id == env.org_id))
        await session.execute(
            delete(OrganizationMember).where(OrganizationMember.organization_id == env.org_id)
        )
        await session.execute(delete(Organization).where(Organization.id == env.org_id))
        await session.execute(delete(User).where(User.id.in_(env.user_ids)))
        await session.commit()


async def _member_added_audits(session, org_id):
    return list(
        (
            await session.execute(
                select(AuditEvent).where(
                    AuditEvent.organization_id == org_id,
                    AuditEvent.action == Action.ORGANIZATION_MEMBER_ADDED,
                )
            )
        ).scalars()
    )


async def test_staged_membership_and_audit_roll_back_together(session, membership_env) -> None:
    target_id = membership_env.target_ids[0]
    async with open_session() as transaction:
        await OrganizationOperations(transaction).stage_member(
            target_id,
            membership_env.org_id,
            actor_user_id=membership_env.admin_id,
        )
        await transaction.rollback()

    await session.rollback()
    membership = (
        await session.execute(
            select(OrganizationMember).where(
                OrganizationMember.organization_id == membership_env.org_id,
                OrganizationMember.user_id == target_id,
            )
        )
    ).scalar_one_or_none()
    folder_count = (
        await session.execute(
            select(func.count())
            .select_from(Folder)
            .where(Folder.organization_id == membership_env.org_id, Folder.owner_id == target_id)
        )
    ).scalar_one()
    assert membership is None
    assert folder_count == 0
    assert await _member_added_audits(session, membership_env.org_id) == []


async def test_member_cap_is_serialized_across_concurrent_adds(
    session, membership_env, search_indexer, monkeypatch
) -> None:
    monkeypatch.setattr(UserDirectoryProjection, "index_for_organization", AsyncMock())
    org = await session.get(Organization, membership_env.org_id)
    org.max_members = 2
    await session.commit()

    async def add(target_id):
        async with open_session() as transaction:
            try:
                await OrganizationOperations(transaction).add_member(
                    target_id,
                    membership_env.org_id,
                    actor_user_id=membership_env.admin_id,
                    search_indexer=search_indexer,
                )
            except ValidationError:
                await transaction.rollback()
                return False
            return True

    results = await asyncio.gather(*(add(target_id) for target_id in membership_env.target_ids[1:3]))
    assert sorted(results) == [False, True]

    await session.rollback()
    active_count = (
        await session.execute(
            select(func.count())
            .select_from(OrganizationMember)
            .where(
                OrganizationMember.organization_id == membership_env.org_id,
                OrganizationMember.is_active.is_(True),
            )
        )
    ).scalar_one()
    target_count = (
        await session.execute(
            select(func.count())
            .select_from(OrganizationMember)
            .where(
                OrganizationMember.organization_id == membership_env.org_id,
                OrganizationMember.user_id.in_(membership_env.target_ids[1:3]),
            )
        )
    ).scalar_one()
    assert active_count == 2
    assert target_count == 1
    assert len(await _member_added_audits(session, membership_env.org_id)) == 1


async def test_reactivation_provisions_defaults_idempotently(
    session, membership_env, search_indexer, monkeypatch
) -> None:
    monkeypatch.setattr(UserDirectoryProjection, "index_for_organization", AsyncMock())
    org = await session.get(Organization, membership_env.org_id)
    org.max_members = None
    target_id = membership_env.target_ids[3]
    inactive = OrganizationMember(
        user_id=target_id,
        organization_id=membership_env.org_id,
        role=OrganizationRole.MEMBER,
        is_active=False,
    )
    channel = ChatChannel(
        organization_id=membership_env.org_id,
        owner_id=membership_env.admin_id,
        name="General",
        slug=f"general-{generate_id().hex[:8]}",
        channel_type=ChannelType.PUBLIC,
        is_default=True,
    )
    session.add_all([inactive, channel])
    await session.flush()
    session.add(ChatChannelStats(channel_id=channel.id))
    await session.commit()

    operations = OrganizationOperations(session)
    first = await operations.add_member(
        target_id,
        membership_env.org_id,
        OrganizationRole.ADMIN,
        membership_env.admin_id,
        search_indexer=search_indexer,
    )
    second = await operations.add_member(
        target_id,
        membership_env.org_id,
        OrganizationRole.MEMBER,
        membership_env.admin_id,
        search_indexer=search_indexer,
    )

    member_rows = list(
        (
            await session.execute(
                select(OrganizationMember).where(
                    OrganizationMember.organization_id == membership_env.org_id,
                    OrganizationMember.user_id == target_id,
                )
            )
        ).scalars()
    )
    folder_count = (
        await session.execute(
            select(func.count())
            .select_from(Folder)
            .where(Folder.organization_id == membership_env.org_id, Folder.owner_id == target_id)
        )
    ).scalar_one()
    channel_member_count = (
        await session.execute(
            select(func.count())
            .select_from(ChatChannelMember)
            .where(
                ChatChannelMember.channel_id == channel.id,
                ChatChannelMember.subject_type == SubjectType.USER,
                ChatChannelMember.subject_id == target_id,
            )
        )
    ).scalar_one()
    stats = await session.get(ChatChannelStats, channel.id)

    assert first.id == second.id == inactive.id
    assert first.role is OrganizationRole.ADMIN
    assert len(member_rows) == 1
    assert folder_count == 1
    assert channel_member_count == 1
    assert stats.member_count == 1
    assert len(await _member_added_audits(session, membership_env.org_id)) == 1


async def test_search_failure_after_commit_keeps_authoritative_membership(
    session, membership_env, search_indexer, monkeypatch
) -> None:
    monkeypatch.setattr(
        UserDirectoryProjection,
        "index_for_organization",
        AsyncMock(side_effect=RuntimeError("search unavailable")),
    )
    target_id = membership_env.target_ids[0]

    membership = await OrganizationOperations(session).add_member(
        target_id,
        membership_env.org_id,
        actor_user_id=membership_env.admin_id,
        search_indexer=search_indexer,
    )

    assert membership.is_active is True
    assert await OrganizationOperations(session).require_org_member(
        target_id,
        membership_env.org_id,
    )
    assert len(await _member_added_audits(session, membership_env.org_id)) == 1
