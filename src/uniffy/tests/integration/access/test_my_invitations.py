"""A recipient's pending invitations and the signed-in accept and decline, on live PostgreSQL."""

import secrets
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock
from uuid import UUID

import pytest
import pytest_asyncio
from sqlalchemy import select

from uniffy.core.audit.actions import Action
from uniffy.core.errors import NotFoundError
from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.login.invitation import Invitation
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import (
    OrganizationMember,
    OrganizationMemberSource,
    OrganizationRole,
)
from uniffy.core.models.login.user import User
from uniffy.core.types import generate_id
from uniffy.domains.organizations.invitations.errors import InvitationNotFoundError
from uniffy.domains.organizations.invitations.operations import InvitationOperations
from uniffy.domains.organizations.invitations.reader import hash_token
from uniffy.tests.integration.access.conftest import teardown_organizations
from uniffy.tests.integration.access.recording_search import recording_indexer

pytestmark = pytest.mark.asyncio(loop_scope="session")


def _invite(
    org_id: UUID,
    email: str,
    inviter_id: UUID,
    *,
    age: timedelta,
    raw_token: str | None = None,
    **fields: object,
) -> Invitation:
    now = datetime.now(UTC)
    values: dict[str, object] = {
        "expires_at": now + timedelta(days=7),
        "created_at": now - age,
        **fields,
    }
    return Invitation(
        organization_id=org_id,
        email=email,
        role=OrganizationRole.MEMBER,
        invited_by_user_id=inviter_id,
        token_hash=hash_token(raw_token or secrets.token_urlsafe(32)),
        **values,
    )


@pytest_asyncio.fixture(loop_scope="session")
async def inbox(session) -> AsyncIterator[NS]:
    suffix = generate_id().hex[-12:]

    def _user(handle: str) -> User:
        return User(
            email=f"inv-{handle}-{suffix}@test.local",
            username=f"inv-{handle}-{suffix}",
            full_name=f"{handle.title()} Tester",
            hashed_password="x",
        )

    inviter, recipient, other = _user("inviter"), _user("recipient"), _user("other")
    orgs = {
        name: Organization(name=f"inv {name} {suffix}", slug=f"inv-{name}-{suffix}")
        for name in ("first", "second", "expired", "deleted")
    }
    orgs["deleted"].deleted_at = datetime.now(UTC)
    session.add_all([inviter, recipient, other, *orgs.values()])
    await session.flush()
    session.add_all(
        OrganizationMember(user_id=inviter.id, organization_id=org.id, role=OrganizationRole.ADMIN)
        for org in orgs.values()
    )

    token = secrets.token_urlsafe(32)
    now = datetime.now(UTC)
    first = _invite(orgs["first"].id, recipient.email, inviter.id, age=timedelta(hours=2))
    second = _invite(
        orgs["second"].id, recipient.email, inviter.id, age=timedelta(hours=1), raw_token=token
    )
    deleted_token = secrets.token_urlsafe(32)
    in_deleted = _invite(
        orgs["deleted"].id,
        recipient.email,
        inviter.id,
        age=timedelta(minutes=5),
        raw_token=deleted_token,
    )
    session.add_all([
        first,
        second,
        in_deleted,
        _invite(
            orgs["first"].id,
            recipient.email,
            inviter.id,
            age=timedelta(days=3),
            accepted_at=now - timedelta(days=2),
        ),
        _invite(
            orgs["second"].id,
            recipient.email,
            inviter.id,
            age=timedelta(days=3),
            revoked_at=now - timedelta(days=2),
        ),
        _invite(
            orgs["expired"].id,
            recipient.email,
            inviter.id,
            age=timedelta(days=40),
            expires_at=now - timedelta(days=10),
        ),
        _invite(orgs["first"].id, other.email, inviter.id, age=timedelta(minutes=1)),
    ])
    await session.commit()

    seeded = NS(
        inviter_id=inviter.id,
        recipient_id=recipient.id,
        other_id=other.id,
        first_org_id=orgs["first"].id,
        second_org_id=orgs["second"].id,
        first_id=first.id,
        second_id=second.id,
        token=token,
        deleted_org_id=orgs["deleted"].id,
        in_deleted_id=in_deleted.id,
        deleted_token=deleted_token,
        org_ids=[org.id for org in orgs.values()],
        user_ids=[inviter.id, recipient.id, other.id],
    )
    try:
        yield seeded
    finally:
        # Invitations cascade with their organizations and inviters.
        await teardown_organizations(session, seeded.org_ids, seeded.user_ids)


async def _pending_ids(session, user_id: UUID) -> list[UUID]:
    rows = await InvitationOperations(session).list_for_user(user_id)
    return [row.invitation.id for row in rows]


async def test_only_live_invitations_to_the_callers_address_are_listed(session, inbox) -> None:
    rows = await InvitationOperations(session).list_for_user(inbox.recipient_id)

    assert [row.invitation.id for row in rows] == [inbox.second_id, inbox.first_id]
    assert [row.organization.id for row in rows] == [inbox.second_org_id, inbox.first_org_id]
    assert {row.inviter.id for row in rows} == {inbox.inviter_id}
    assert await _pending_ids(session, inbox.inviter_id) == []


async def test_accepting_by_id_joins_without_verifying_the_address(session, inbox) -> None:
    organization, membership = await InvitationOperations(session).accept_as_member(
        user_id=inbox.recipient_id,
        invitation_id=inbox.first_id,
        search_indexer=recording_indexer(),
    )

    assert organization.id == inbox.first_org_id
    assert membership.user_id == inbox.recipient_id
    assert membership.is_active is True
    assert membership.source is OrganizationMemberSource.INVITE
    assert membership.invited_by_user_id == inbox.inviter_id
    await session.rollback()
    invitation = await session.get(Invitation, inbox.first_id)
    await session.refresh(invitation)
    assert invitation.accepted_by_user_id == inbox.recipient_id
    recipient = await session.get(User, inbox.recipient_id)
    await session.refresh(recipient)
    assert recipient.email_verified is False
    added = (
        await session.execute(
            select(AuditEvent).where(
                AuditEvent.organization_id == inbox.first_org_id,
                AuditEvent.action == Action.ORGANIZATION_MEMBER_ADDED,
                AuditEvent.resource_id == inbox.recipient_id,
            )
        )
    ).scalar_one()
    assert added.actor_user_id == inbox.recipient_id
    assert await _pending_ids(session, inbox.recipient_id) == [inbox.second_id]


async def test_accepting_by_token_verifies_the_address(session, inbox) -> None:
    await InvitationOperations(session).accept_as_member(
        user_id=inbox.recipient_id,
        token=inbox.token,
        search_indexer=recording_indexer(),
    )

    await session.rollback()
    recipient = await session.get(User, inbox.recipient_id)
    await session.refresh(recipient)
    assert recipient.email_verified is True
    audit = (
        await session.execute(
            select(AuditEvent).where(
                AuditEvent.organization_id == inbox.second_org_id,
                AuditEvent.action == Action.AUTH_INVITATION_ACCEPTED,
            )
        )
    ).scalar_one()
    assert audit.details["via"] == "token"
    assert audit.details["signed_in"] is True


async def test_another_account_cannot_accept_or_decline(session, inbox) -> None:
    operations = InvitationOperations(session)

    with pytest.raises(NotFoundError):
        await operations.accept_as_member(
            user_id=inbox.other_id,
            invitation_id=inbox.first_id,
            search_indexer=recording_indexer(),
        )
    with pytest.raises(NotFoundError):
        await operations.decline(user_id=inbox.other_id, invitation_id=inbox.first_id)

    assert await _pending_ids(session, inbox.recipient_id) == [inbox.second_id, inbox.first_id]


async def test_declining_removes_the_invitation_once(session, inbox) -> None:
    operations = InvitationOperations(session)

    await operations.decline(user_id=inbox.recipient_id, invitation_id=inbox.first_id)
    await operations.decline(user_id=inbox.recipient_id, invitation_id=inbox.first_id)

    invitation = await session.get(Invitation, inbox.first_id)
    await session.refresh(invitation)
    assert invitation.revoked_by_user_id == inbox.recipient_id
    declined = (
        (
            await session.execute(
                select(AuditEvent).where(
                    AuditEvent.organization_id == inbox.first_org_id,
                    AuditEvent.action == Action.ORGANIZATION_INVITATION_DECLINED,
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(declined) == 1
    assert await _pending_ids(session, inbox.recipient_id) == [inbox.second_id]


async def test_an_invitation_into_a_deleted_organization_is_unreachable(
    session, inbox, monkeypatch
) -> None:
    monkeypatch.setattr(
        "uniffy.domains.organizations.invitations.reader.check_rate_limit", AsyncMock()
    )
    operations = InvitationOperations(session)

    with pytest.raises(InvitationNotFoundError):
        await operations.get_for_token(inbox.deleted_token)
    for lookup in ({"invitation_id": inbox.in_deleted_id}, {"token": inbox.deleted_token}):
        with pytest.raises(InvitationNotFoundError):
            await operations.accept_as_member(
                user_id=inbox.recipient_id,
                search_indexer=recording_indexer(),
                **lookup,
            )

    membership = (
        await session.execute(
            select(OrganizationMember).where(
                OrganizationMember.organization_id == inbox.deleted_org_id,
                OrganizationMember.user_id == inbox.recipient_id,
            )
        )
    ).scalar_one_or_none()
    invitation = await session.get(Invitation, inbox.in_deleted_id)
    await session.refresh(invitation)
    assert membership is None
    assert invitation.accepted_at is None
    assert invitation.revoked_at is None


async def test_an_invitation_into_a_suspended_organization_is_not_listed(session, inbox) -> None:
    second = await session.get(Organization, inbox.second_org_id)
    second.is_suspended = True
    session.add(second)
    await session.commit()

    assert await _pending_ids(session, inbox.recipient_id) == [inbox.first_id]
