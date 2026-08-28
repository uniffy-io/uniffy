"""Invitation creation and acceptance transactions against PostgreSQL."""

import asyncio
import secrets
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from sqlalchemy import delete, func, select, text

from uniffy.core.audit.actions import Action
from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.files.folder import Folder
from uniffy.core.models.login.invitation import Invitation
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.login.user import User
from uniffy.core.models.login.user_session import UserSession
from uniffy.core.types import generate_id
from uniffy.db import open_session
from uniffy.domains.auth.types import AuthResult
from uniffy.domains.organizations.invitations.errors import InvitationAlreadyUsedError
from uniffy.domains.organizations.invitations.operations import (
    InvitationOperations,
    _hash_token,
)
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.domains.users.search import UserSearchIndexer

pytestmark = pytest.mark.asyncio(loop_scope="session")


class AcceptanceFailurePoint(StrEnum):
    AFTER_USER = "after_user"
    AFTER_MEMBERSHIP = "after_membership"
    AFTER_SESSION = "after_session"


@pytest_asyncio.fixture(loop_scope="session")
async def invitation_env(session):
    suffix = generate_id().hex[:12]
    admin = User(
        email=f"invitation-admin-{suffix}@test.local",
        username=f"invitation-admin-{suffix}",
        hashed_password="x",
    )
    org = Organization(name=f"invitation {suffix}", slug=f"invitation-{suffix}")
    session.add_all([admin, org])
    await session.flush()
    session.add(
        OrganizationMember(
            user_id=admin.id,
            organization_id=org.id,
            role=OrganizationRole.ADMIN,
        )
    )
    raw_token = secrets.token_urlsafe(32)
    invite_email = f"invited-{suffix}@test.local"
    invitation = Invitation(
        organization_id=org.id,
        email=invite_email,
        role=OrganizationRole.MEMBER,
        invited_by_user_id=admin.id,
        token_hash=_hash_token(raw_token),
        expires_at=datetime.now(UTC) + timedelta(days=1),
    )
    session.add(invitation)
    await session.commit()
    env = NS(
        suffix=suffix,
        org_id=org.id,
        admin_id=admin.id,
        admin_email=admin.email,
        invite_id=invitation.id,
        invite_email=invite_email,
        raw_token=raw_token,
    )

    try:
        yield env
    finally:
        await session.rollback()
        await session.execute(delete(UserSession).where(UserSession.organization_id == env.org_id))
        await session.execute(delete(Folder).where(Folder.organization_id == env.org_id))
        await session.execute(delete(Invitation).where(Invitation.organization_id == env.org_id))
        await session.execute(text("SET LOCAL uniffy.audit_maintenance = 'on'"))
        await session.execute(delete(AuditEvent).where(AuditEvent.organization_id == env.org_id))
        await session.execute(
            delete(OrganizationMember).where(OrganizationMember.organization_id == env.org_id)
        )
        await session.execute(delete(Organization).where(Organization.id == env.org_id))
        await session.execute(
            delete(User).where(User.email.in_([env.admin_email, env.invite_email]))
        )
        await session.commit()


async def _action_count(session, org_id, action: Action) -> int:
    return int(
        (
            await session.execute(
                select(func.count())
                .select_from(AuditEvent)
                .where(AuditEvent.organization_id == org_id, AuditEvent.action == action)
            )
        ).scalar_one()
    )


async def test_invitation_creation_is_committed_before_email_enqueue(
    session, invitation_env, monkeypatch
) -> None:
    email = f"new-{invitation_env.suffix}@test.local"
    observed: list[tuple[int, int]] = []

    async def observe_enqueue(*args, **kwargs) -> None:
        del args, kwargs
        async with open_session() as observer:
            invitation = (
                await observer.execute(
                    select(Invitation).where(
                        Invitation.organization_id == invitation_env.org_id,
                        Invitation.email == email,
                    )
                )
            ).scalar_one()
            audit_count = (
                await observer.execute(
                    select(func.count())
                    .select_from(AuditEvent)
                    .where(
                        AuditEvent.organization_id == invitation_env.org_id,
                        AuditEvent.resource_id == invitation.id,
                        AuditEvent.action == Action.ORGANIZATION_MEMBER_INVITED,
                    )
                )
            ).scalar_one()
            observed.append((1, int(audit_count)))

    monkeypatch.setattr(
        "uniffy.domains.organizations.invitations.operations.enqueue_job",
        observe_enqueue,
    )
    result = await InvitationOperations(session).invite(
        invitation_env.org_id,
        email,
        OrganizationRole.MEMBER,
        invitation_env.admin_id,
    )

    assert result.invitation is not None
    assert observed == [(1, 1)]


async def test_invitation_creation_rolls_back_when_audit_fails(
    session, invitation_env, monkeypatch
) -> None:
    email = f"rollback-{invitation_env.suffix}@test.local"
    monkeypatch.setattr(
        "uniffy.domains.organizations.invitations.operations.write_audit_event",
        AsyncMock(side_effect=RuntimeError("audit unavailable")),
    )

    with pytest.raises(RuntimeError, match="audit unavailable"):
        await InvitationOperations(session).invite(
            invitation_env.org_id,
            email,
            OrganizationRole.MEMBER,
            invitation_env.admin_id,
        )

    invitation_count = (
        await session.execute(
            select(func.count())
            .select_from(Invitation)
            .where(
                Invitation.organization_id == invitation_env.org_id,
                Invitation.email == email,
            )
        )
    ).scalar_one()
    assert invitation_count == 0


@pytest.mark.parametrize("failure_point", list(AcceptanceFailurePoint))
async def test_acceptance_failure_rolls_back_every_authoritative_fact(
    session, invitation_env, monkeypatch, failure_point
) -> None:
    monkeypatch.setattr(
        "uniffy.domains.organizations.invitations.operations.check_rate_limit",
        AsyncMock(),
    )
    monkeypatch.setattr(UserSearchIndexer, "index_for_organization", AsyncMock())
    if failure_point is AcceptanceFailurePoint.AFTER_USER:
        monkeypatch.setattr(
            OrganizationOperations,
            "stage_member",
            AsyncMock(side_effect=RuntimeError("after user")),
        )
    elif failure_point is AcceptanceFailurePoint.AFTER_MEMBERSHIP:
        monkeypatch.setattr(
            "uniffy.domains.organizations.invitations.operations.stage_invitation_authentication",
            AsyncMock(side_effect=RuntimeError("after membership")),
        )
    else:
        monkeypatch.setattr(
            "uniffy.domains.organizations.invitations.operations.write_audit_event",
            AsyncMock(side_effect=RuntimeError("after session")),
        )

    with pytest.raises(RuntimeError):
        await InvitationOperations(session).accept(
            raw_token=invitation_env.raw_token,
            username=f"accepted-{failure_point}-{invitation_env.suffix}",
            password="Strong invitation password",
            full_name="Invited User",
            user_agent="pytest",
        )

    user_count = (
        await session.execute(
            select(func.count()).select_from(User).where(User.email == invitation_env.invite_email)
        )
    ).scalar_one()
    member_count = (
        await session.execute(
            select(func.count())
            .select_from(OrganizationMember)
            .where(OrganizationMember.organization_id == invitation_env.org_id)
        )
    ).scalar_one()
    session_count = (
        await session.execute(
            select(func.count())
            .select_from(UserSession)
            .where(UserSession.organization_id == invitation_env.org_id)
        )
    ).scalar_one()
    folder_count = (
        await session.execute(
            select(func.count())
            .select_from(Folder)
            .where(Folder.organization_id == invitation_env.org_id)
        )
    ).scalar_one()
    invitation = await session.get(Invitation, invitation_env.invite_id)

    assert user_count == 0
    assert member_count == 1
    assert session_count == 0
    assert folder_count == 0
    assert invitation.accepted_at is None
    assert await _action_count(
        session, invitation_env.org_id, Action.ORGANIZATION_MEMBER_ADDED
    ) == 0
    assert await _action_count(
        session, invitation_env.org_id, Action.AUTH_INVITATION_ACCEPTED
    ) == 0
    assert await InvitationOperations(session)._load_by_token(invitation_env.raw_token)


async def test_concurrent_token_consumption_has_exactly_one_success(
    session, invitation_env, monkeypatch
) -> None:
    monkeypatch.setattr(
        "uniffy.domains.organizations.invitations.operations.check_rate_limit",
        AsyncMock(),
    )
    monkeypatch.setattr(UserSearchIndexer, "index_for_organization", AsyncMock())

    async def accept(index: int):
        async with open_session() as transaction:
            try:
                return await InvitationOperations(transaction).accept(
                    raw_token=invitation_env.raw_token,
                    username=f"concurrent-{index}-{invitation_env.suffix}",
                    password="Strong invitation password",
                    full_name="Invited User",
                    user_agent="pytest",
                )
            except InvitationAlreadyUsedError as exc:
                return exc

    outcomes = await asyncio.gather(accept(1), accept(2))
    assert sum(isinstance(outcome, AuthResult) for outcome in outcomes) == 1
    assert sum(isinstance(outcome, InvitationAlreadyUsedError) for outcome in outcomes) == 1

    await session.rollback()
    user_count = (
        await session.execute(
            select(func.count()).select_from(User).where(User.email == invitation_env.invite_email)
        )
    ).scalar_one()
    membership_count = (
        await session.execute(
            select(func.count())
            .select_from(OrganizationMember)
            .where(OrganizationMember.organization_id == invitation_env.org_id)
        )
    ).scalar_one()
    auth_session_count = (
        await session.execute(
            select(func.count())
            .select_from(UserSession)
            .where(UserSession.organization_id == invitation_env.org_id)
        )
    ).scalar_one()
    invitation = await session.get(Invitation, invitation_env.invite_id)
    await session.refresh(invitation)

    assert user_count == 1
    assert membership_count == 2
    assert auth_session_count == 1
    assert invitation.accepted_at is not None
    assert await _action_count(
        session, invitation_env.org_id, Action.ORGANIZATION_MEMBER_ADDED
    ) == 1
    assert await _action_count(
        session, invitation_env.org_id, Action.AUTH_INVITATION_ACCEPTED
    ) == 1
