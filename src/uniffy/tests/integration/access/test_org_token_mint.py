"""RefreshToken minting org-bound access tokens on one session, proven on rows and claims."""

from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock
from uuid import UUID

import pytest
from sqlalchemy import select, update

from uniffy.core.audit.actions import Action
from uniffy.core.auth.tokens import create_refresh_token, decode_access_token
from uniffy.core.models.audit.event import AuditEvent, AuditResourceType
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.login.user import User
from uniffy.core.models.login.user_session import UserSession
from uniffy.domains.auth.contracts import hash_refresh_token
from uniffy.domains.auth.errors import TokenError
from uniffy.domains.auth.operations import REFRESH_GRACE_SECONDS, AuthOperations
from uniffy.domains.auth.types import AuthResult
from uniffy.domains.calls.channels import CallsLifecycle
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.infrastructure.database import open_session
from uniffy.tests.integration.access.calls import _auth_session

pytestmark = pytest.mark.asyncio(loop_scope="session")
_ORG_CLAIM = "org_id"


def _operations(session) -> AuthOperations:
    return AuthOperations(session, CallsLifecycle(open_session))


async def _join_other_org(session, access) -> None:
    session.add(
        OrganizationMember(
            user_id=access.member_id,
            organization_id=access.other_org_id,
            role=OrganizationRole.MEMBER,
        )
    )
    await session.commit()


async def _slug(session, org_id: UUID) -> str:
    return (
        await session.execute(select(Organization.slug).where(Organization.id == org_id))
    ).scalar_one()


async def _token_version(session, user_id: UUID) -> int:
    return (await session.execute(select(User.token_version).where(User.id == user_id))).scalar_one()


async def _signed_in(session, access, org_id: UUID | None) -> tuple[UUID, str]:
    """A session row holding the hash of its refresh token, the state login leaves behind."""
    auth = await _auth_session(session, access.member_id, org_id)
    # A shorter lifetime than a minted token keeps it distinct from the first rotation.
    refresh = create_refresh_token(
        access.member_id,
        token_version=await _token_version(session, access.member_id),
        session_id=auth.id,
        expires_delta=timedelta(days=1),
    )
    await session.execute(
        update(UserSession)
        .where(UserSession.id == auth.id)
        .values(refresh_token_hash=hash_refresh_token(refresh))
    )
    await session.commit()
    return auth.id, refresh


async def _session_row(session, session_id: UUID) -> UserSession:
    return await session.get(UserSession, session_id, populate_existing=True)


def _claims(result: AuthResult) -> dict[str, Any]:
    return decode_access_token(result.access_token)


async def _audits_with_event(session, user_id: UUID, event: str) -> list[AuditEvent]:
    rows = await session.execute(
        select(AuditEvent).where(
            AuditEvent.action == Action.AUTH_TOKEN_REFRESHED,
            AuditEvent.resource_id == user_id,
        )
    )
    return [row for row in rows.scalars() if row.details.get("event") == event]


async def _org_switch_audits(session, user_id: UUID) -> list[AuditEvent]:
    return await _audits_with_event(session, user_id, "org_switch")


class TestMint:
    async def test_one_session_mints_each_organization_in_turn(self, session, access) -> None:
        await _join_other_org(session, access)
        session_id, refresh = await _signed_in(session, access, None)
        operations = _operations(session)

        first = await operations.refresh_token(
            refresh, organization_slug=await _slug(session, access.org_id)
        )

        row = await _session_row(session, session_id)
        assert _claims(first)["org_id"] == str(access.org_id)
        assert row.organization_id == access.org_id
        assert row.previous_refresh_token_hash == hash_refresh_token(refresh)
        assert row.refresh_token_hash == hash_refresh_token(first.refresh_token)

        second = await operations.refresh_token(
            first.refresh_token, organization_slug=await _slug(session, access.other_org_id)
        )

        row = await _session_row(session, session_id)
        claims = _claims(second)
        assert claims["org_id"] == str(access.other_org_id)
        assert claims["sid"] == str(session_id)
        assert second.organization_id == access.other_org_id
        assert row.organization_id == access.other_org_id
        assert row.is_revoked is False
        assert row.previous_refresh_token_hash == hash_refresh_token(first.refresh_token)
        assert row.refresh_token_hash == hash_refresh_token(second.refresh_token)
        [switch] = await _org_switch_audits(session, access.member_id)
        assert switch.organization_id == access.other_org_id
        assert switch.actor_user_id == access.member_id
        assert switch.resource_type == AuditResourceType.USER
        assert switch.details == {
            "event": "org_switch",
            "previous_org_id": str(access.org_id),
            "target_org_id": str(access.other_org_id),
            "session_id": str(session_id),
        }

    async def test_no_slug_mints_the_sessions_last_organization(self, session, access) -> None:
        await _join_other_org(session, access)
        session_id, refresh = await _signed_in(session, access, access.org_id)
        operations = _operations(session)
        switched = await operations.refresh_token(
            refresh, organization_slug=await _slug(session, access.other_org_id)
        )

        again = await operations.refresh_token(switched.refresh_token)

        assert _claims(again)["org_id"] == str(access.other_org_id)
        assert again.organization_slug == await _slug(session, access.other_org_id)
        assert (await _session_row(session, session_id)).organization_id == access.other_org_id
        assert len(await _org_switch_audits(session, access.member_id)) == 1


class TestRefusal:
    async def test_reusing_a_rotated_token_after_the_grace_window_revokes_the_session(
        self, session, access
    ) -> None:
        await _join_other_org(session, access)
        session_id, refresh = await _signed_in(session, access, access.org_id)
        operations = _operations(session)
        rotated = await operations.refresh_token(
            refresh, organization_slug=await _slug(session, access.other_org_id)
        )
        await session.execute(
            update(UserSession)
            .where(UserSession.id == session_id)
            .values(
                previous_refresh_rotated_at=datetime.now(UTC)
                - timedelta(seconds=REFRESH_GRACE_SECONDS + 5)
            )
        )
        await session.commit()
        token_version = await _token_version(session, access.member_id)

        with pytest.raises(TokenError):
            await operations.refresh_token(
                refresh, organization_slug=await _slug(session, access.org_id)
            )

        assert (await _session_row(session, session_id)).is_revoked is True
        assert await _token_version(session, access.member_id) == token_version + 1
        with pytest.raises(TokenError):
            await operations.refresh_token(rotated.refresh_token)

    async def test_a_suspended_organization_demotes_the_session_to_no_org(
        self, session, access
    ) -> None:
        await _join_other_org(session, access)
        session_id, refresh = await _signed_in(session, access, access.org_id)
        home_slug = await _slug(session, access.org_id)
        suspended_slug = await _slug(session, access.other_org_id)
        await session.execute(
            update(Organization)
            .where(Organization.id == access.other_org_id)
            .values(is_suspended=True, suspended_at=datetime.now(UTC))
        )
        await session.commit()
        operations = _operations(session)

        dropped = await operations.refresh_token(refresh, organization_slug=suspended_slug)

        assert dropped.organization_id is None
        assert _ORG_CLAIM not in _claims(dropped)
        row = await _session_row(session, session_id)
        assert row.organization_id is None
        assert row.is_revoked is False
        assert row.refresh_token_hash == hash_refresh_token(dropped.refresh_token)
        audits = await _audits_with_event(session, access.member_id, "org_dropped")
        assert [a.details["requested_slug"] for a in audits] == [suspended_slug]

        kept = await operations.refresh_token(dropped.refresh_token, organization_slug=home_slug)
        assert _claims(kept)["org_id"] == str(access.org_id)
        assert (await _session_row(session, session_id)).organization_id == access.org_id

    async def test_a_removed_membership_demotes_the_mint_while_the_other_org_still_mints(
        self, session, access
    ) -> None:
        await _join_other_org(session, access)
        session_id, refresh = await _signed_in(session, access, access.org_id)
        removed_slug = await _slug(session, access.org_id)
        other_slug = await _slug(session, access.other_org_id)
        await OrganizationOperations(session).remove_member(
            access.owner_id,
            access.org_id,
            access.member_id,
            search_indexer=AsyncMock(),
            call_lifecycle=CallsLifecycle(open_session),
        )
        operations = _operations(session)

        dropped = await operations.refresh_token(refresh, organization_slug=removed_slug)
        assert dropped.organization_id is None
        assert (await _session_row(session, session_id)).organization_id is None

        still_dropped = await operations.refresh_token(dropped.refresh_token)
        assert still_dropped.organization_id is None

        minted = await operations.refresh_token(
            still_dropped.refresh_token, organization_slug=other_slug
        )

        assert _claims(minted)["org_id"] == str(access.other_org_id)
        row = await _session_row(session, session_id)
        assert row.organization_id == access.other_org_id
        assert row.is_revoked is False
