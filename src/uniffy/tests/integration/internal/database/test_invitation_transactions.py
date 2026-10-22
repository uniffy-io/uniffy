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
from uniffy.core.errors import (
    ConflictError,
    InvitationSignInRequiredError,
    PermissionDeniedError,
)
from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.files.folder import Folder
from uniffy.core.models.login.invitation import Invitation
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.login.user import User
from uniffy.core.models.login.user_session import UserSession
from uniffy.core.types import generate_id
from uniffy.domains.auth.types import AuthResult
from uniffy.domains.directory.projection import UserDirectoryProjection
from uniffy.domains.organizations.invitations.errors import (
    InvitationAlreadyUsedError,
    InvitationNotFoundError,
)
from uniffy.domains.organizations.invitations.operations import InvitationOperations
from uniffy.domains.organizations.invitations.reader import hash_token
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.infrastructure.database import open_session

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
        token_hash=hash_token(raw_token),
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
    invitation = await InvitationOperations(session).invite(
        invitation_env.org_id,
        email,
        OrganizationRole.MEMBER,
        invitation_env.admin_id,
    )

    assert invitation.email == email
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
    session, invitation_env, search_indexer, monkeypatch, failure_point
) -> None:
    monkeypatch.setattr(
        "uniffy.domains.organizations.invitations.operations.check_rate_limit",
        AsyncMock(),
    )
    monkeypatch.setattr(UserDirectoryProjection, "index_for_organization", AsyncMock())
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
            search_indexer=search_indexer,
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
    assert await _action_count(session, invitation_env.org_id, Action.ORGANIZATION_MEMBER_ADDED) == 0
    assert await _action_count(session, invitation_env.org_id, Action.AUTH_INVITATION_ACCEPTED) == 0
    assert await InvitationOperations(session)._load_by_token(invitation_env.raw_token)


async def test_the_account_an_anonymous_accept_creates_has_a_verified_email(
    session, invitation_env, search_indexer, monkeypatch
) -> None:
    monkeypatch.setattr(
        "uniffy.domains.organizations.invitations.operations.check_rate_limit",
        AsyncMock(),
    )
    monkeypatch.setattr(UserDirectoryProjection, "index_for_organization", AsyncMock())

    await InvitationOperations(session).accept(
        raw_token=invitation_env.raw_token,
        username=f"verified-{invitation_env.suffix}",
        password="Strong invitation password",
        full_name="Invited User",
        user_agent="pytest",
        search_indexer=search_indexer,
    )

    await session.rollback()
    account = (
        await session.execute(select(User).where(User.email == invitation_env.invite_email))
    ).scalar_one()
    assert account.email_verified is True


async def _blocked_behind(pid: int, waiter: asyncio.Task) -> None:
    """Wait until a statement waits for a lock the backend ``pid`` holds."""
    async with asyncio.timeout(10):
        while not waiter.done():
            async with open_session() as observer:
                waiting = await observer.scalar(
                    text(
                        "SELECT count(*) FROM pg_stat_activity"
                        " WHERE :pid = ANY(pg_blocking_pids(pid))"
                    ),
                    {"pid": pid},
                )
            if waiting:
                return
            await asyncio.sleep(0.02)
    await waiter


async def test_a_reinvite_waits_for_an_accept_in_flight_and_leaves_it_accepted(
    session, invitation_env, monkeypatch
) -> None:
    monkeypatch.setattr(
        "uniffy.domains.organizations.invitations.operations.enqueue_job", AsyncMock()
    )

    async def reinvite() -> Invitation:
        async with open_session() as inviting:
            return await InvitationOperations(inviting).invite(
                invitation_env.org_id,
                invitation_env.invite_email,
                OrganizationRole.MEMBER,
                invitation_env.admin_id,
            )

    async with open_session() as accepting:
        held = (
            await accepting.execute(
                select(Invitation).where(Invitation.id == invitation_env.invite_id).with_for_update()
            )
        ).scalar_one()
        held.accepted_at = datetime.now(UTC)
        await accepting.flush()
        pid = await accepting.scalar(text("SELECT pg_backend_pid()"))
        reinviting = asyncio.create_task(reinvite())
        await _blocked_behind(pid, reinviting)
        await accepting.commit()
    fresh = await reinviting

    original = await session.get(Invitation, invitation_env.invite_id)
    await session.refresh(original)
    assert original.accepted_at is not None
    assert original.revoked_at is None
    assert original.revoked_by_user_id is None
    assert fresh.id != invitation_env.invite_id
    assert fresh.revoked_at is None


async def test_concurrent_token_consumption_has_exactly_one_success(
    session, invitation_env, search_indexer, monkeypatch
) -> None:
    monkeypatch.setattr(
        "uniffy.domains.organizations.invitations.operations.check_rate_limit",
        AsyncMock(),
    )
    monkeypatch.setattr(UserDirectoryProjection, "index_for_organization", AsyncMock())

    async def accept(index: int):
        async with open_session() as transaction:
            try:
                return await InvitationOperations(transaction).accept(
                    raw_token=invitation_env.raw_token,
                    username=f"concurrent-{index}-{invitation_env.suffix}",
                    password="Strong invitation password",
                    full_name="Invited User",
                    user_agent="pytest",
                    search_indexer=search_indexer,
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
    assert await _action_count(session, invitation_env.org_id, Action.ORGANIZATION_MEMBER_ADDED) == 1
    assert await _action_count(session, invitation_env.org_id, Action.AUTH_INVITATION_ACCEPTED) == 1


async def _member_count(session, org_id) -> int:
    return int(
        (
            await session.execute(
                select(func.count())
                .select_from(OrganizationMember)
                .where(OrganizationMember.organization_id == org_id)
            )
        ).scalar_one()
    )


async def _accept_anonymously(session, env, search_indexer):
    return await InvitationOperations(session).accept(
        raw_token=env.raw_token,
        username=f"other-{env.suffix}",
        password="Strong invitation password",
        full_name="Someone Else",
        user_agent="pytest",
        search_indexer=search_indexer,
    )


@pytest.mark.parametrize("is_active", [True, False], ids=["active", "deactivated"])
async def test_an_existing_account_is_sent_to_sign_in_and_nothing_is_written(
    session, invitation_env, search_indexer, monkeypatch, is_active
) -> None:
    monkeypatch.setattr(
        "uniffy.domains.organizations.invitations.operations.check_rate_limit",
        AsyncMock(),
    )
    account = User(
        email=invitation_env.invite_email,
        username=f"held-{invitation_env.suffix}",
        full_name="Held Name",
        hashed_password="x",
        is_active=is_active,
    )
    session.add(account)
    await session.commit()
    token_version = account.token_version

    with pytest.raises(InvitationSignInRequiredError):
        await _accept_anonymously(session, invitation_env, search_indexer)

    await session.refresh(account)
    invitation = await session.get(Invitation, invitation_env.invite_id)
    await session.refresh(invitation)
    account_sessions = (
        await session.execute(
            select(func.count()).select_from(UserSession).where(UserSession.user_id == account.id)
        )
    ).scalar_one()
    # Only a platform operator reopens a deactivated account; the invitation leaves it untouched.
    assert account.is_active is is_active
    assert account.hashed_password == "x"
    assert account.full_name == "Held Name"
    assert account.email_verified is False
    assert account.token_version == token_version
    assert account_sessions == 0
    assert invitation.accepted_at is None
    assert await _member_count(session, invitation_env.org_id) == 1
    assert await _action_count(session, invitation_env.org_id, Action.AUTH_INVITATION_ACCEPTED) == 0


class OrganizationClosure(StrEnum):
    DELETED = "deleted"
    SUSPENDED = "suspended"


_CLOSURE_ERRORS: dict[OrganizationClosure, type[Exception]] = {
    OrganizationClosure.DELETED: InvitationNotFoundError,
    OrganizationClosure.SUSPENDED: PermissionDeniedError,
}


async def _close_organization(session, org_id, closure: OrganizationClosure) -> None:
    organization = await session.get(Organization, org_id)
    if closure is OrganizationClosure.DELETED:
        organization.deleted_at = datetime.now(UTC)
    else:
        organization.is_suspended = True
    await session.commit()


@pytest.mark.parametrize("closure", list(OrganizationClosure))
async def test_a_closed_organization_refuses_preview_and_anonymous_accept(
    session, invitation_env, search_indexer, monkeypatch, closure
) -> None:
    monkeypatch.setattr(
        "uniffy.domains.organizations.invitations.operations.check_rate_limit",
        AsyncMock(),
    )
    monkeypatch.setattr(
        "uniffy.domains.organizations.invitations.reader.check_rate_limit",
        AsyncMock(),
    )
    await _close_organization(session, invitation_env.org_id, closure)
    error = _CLOSURE_ERRORS[closure]

    with pytest.raises(error):
        await InvitationOperations(session).get_for_token(invitation_env.raw_token)
    with pytest.raises(error):
        await _accept_anonymously(session, invitation_env, search_indexer)

    user_count = (
        await session.execute(
            select(func.count()).select_from(User).where(User.email == invitation_env.invite_email)
        )
    ).scalar_one()
    invitation = await session.get(Invitation, invitation_env.invite_id)
    await session.refresh(invitation)
    assert user_count == 0
    assert invitation.accepted_at is None
    assert invitation.revoked_at is None
    assert await _member_count(session, invitation_env.org_id) == 1
    assert await _action_count(session, invitation_env.org_id, Action.AUTH_INVITATION_ACCEPTED) == 0


async def test_inviting_an_active_member_conflicts_and_keeps_earlier_invitations(
    session, invitation_env, monkeypatch
) -> None:
    enqueue = AsyncMock()
    monkeypatch.setattr("uniffy.domains.organizations.invitations.operations.enqueue_job", enqueue)
    member_email = f"member-{invitation_env.suffix}@test.local"
    member = User(
        email=member_email,
        username=f"member-{invitation_env.suffix}",
        hashed_password="x",
    )
    session.add(member)
    await session.flush()
    member_id = member.id
    session.add(
        OrganizationMember(
            user_id=member_id,
            organization_id=invitation_env.org_id,
            role=OrganizationRole.MEMBER,
        )
    )
    # A pending invitation left over from before the person joined through another path.
    earlier = Invitation(
        organization_id=invitation_env.org_id,
        email=member_email,
        role=OrganizationRole.MEMBER,
        invited_by_user_id=invitation_env.admin_id,
        token_hash=hash_token(secrets.token_urlsafe(32)),
        expires_at=datetime.now(UTC) + timedelta(days=1),
    )
    session.add(earlier)
    await session.commit()

    try:
        with pytest.raises(ConflictError, match="already a member of the organization"):
            await InvitationOperations(session).invite(
                invitation_env.org_id,
                member_email.upper(),
                OrganizationRole.ADMIN,
                invitation_env.admin_id,
            )

        await session.refresh(earlier)
        invitations = (
            await session.execute(
                select(func.count())
                .select_from(Invitation)
                .where(
                    Invitation.organization_id == invitation_env.org_id,
                    Invitation.email == member_email,
                )
            )
        ).scalar_one()
        assert earlier.revoked_at is None
        assert invitations == 1
        assert (
            await _action_count(session, invitation_env.org_id, Action.ORGANIZATION_MEMBER_INVITED)
            == 0
        )
        enqueue.assert_not_awaited()
    finally:
        await session.rollback()
        await session.execute(delete(Invitation).where(Invitation.email == member_email))
        await session.execute(
            delete(OrganizationMember).where(OrganizationMember.user_id == member_id)
        )
        await session.execute(delete(User).where(User.id == member_id))
        await session.commit()
