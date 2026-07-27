"""Guard tests: a deactivated org membership fails every permission gate.

Vanilla pytest + ``asyncio.run`` with a fake session, matching the other
permission tests (no pytest-asyncio, no live DB). The fake answers a query
only when the statement actually constrains ``organization_members.is_active``
for an inactive member, so a gate that drops the condition resolves to the
allowed verdict and the test fails.
"""

import asyncio
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from sqlalchemy.sql.elements import False_

from uniffy.core.errors import PermissionDeniedError
from uniffy.core.models.chat.channel import ChannelType
from uniffy.core.models.chat.channel_member import ChatChannelMember
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.models.permissions.domain_admin import DomainAdmin
from uniffy.core.types import AccessMode, ContentRole, ContentType, DomainType


def _run(coro):
    return asyncio.run(coro)


def _result(value, rows=None):
    res = MagicMock()
    res.scalar_one_or_none = MagicMock(return_value=value)
    res.all = MagicMock(return_value=rows if rows is not None else [])
    return res


def _cache_passthrough():
    """Route the perm-cache wrappers straight to their loaders (no Valkey)."""

    async def _pass(key, loader, ttl=None, *, tags=None):
        return await loader()

    return patch(
        "uniffy.core.auth.cache.cache_get_or_set_locked",
        AsyncMock(side_effect=_pass),
    )


def _queried_domain(stmt):
    for value in stmt.compile().params.values():
        if isinstance(value, DomainType):
            return value
    return None


def _gates_on_active(stmt) -> bool:
    """Only the WHERE clause counts - a full-entity select renders the column
    in its projection without constraining it.
    """
    return "organization_members.is_active" in str(stmt.whereclause)


def _session(
    *,
    org_role=OrganizationRole.ADMIN,
    member_active=True,
    admin_domains: frozenset = frozenset(),
):
    """Fake session for org-role and domain-admin lookups.

    An inactive member is only hidden from statements that constrain
    ``is_active``; an ungated statement still sees the row, which is what makes
    a missing condition observable.
    """

    async def execute(stmt):
        described = stmt.column_descriptions[0]
        entity = described.get("entity")
        hidden = member_active is False and _gates_on_active(stmt)

        if entity is OrganizationMember:
            if hidden or org_role is None:
                return _result(None)
            if described.get("name") == "role":
                return _result(org_role)
            return _result(
                NS(
                    role=org_role,
                    is_active=member_active,
                    user_id=uuid4(),
                    organization_id=uuid4(),
                )
            )
        if entity is DomainAdmin:
            domain = _queried_domain(stmt)
            if hidden:
                return _result(None)
            granted = [d for d in admin_domains if domain is None or d == domain]
            return _result(
                uuid4() if granted else None,
                rows=[(d,) for d in granted],
            )
        return _result(None)

    session = MagicMock()
    session.execute = AsyncMock(side_effect=execute)
    return session


def _org_ops(session):
    from uniffy.domains.organizations.operations import OrganizationOperations

    ops = OrganizationOperations.__new__(OrganizationOperations)
    ops._session = session
    return ops


class TestOrgGates:
    @pytest.mark.parametrize(
        ("gate", "role"),
        [
            ("require_org_member", OrganizationRole.MEMBER),
            ("require_org_admin", OrganizationRole.ADMIN),
            ("require_org_owner", OrganizationRole.OWNER),
        ],
    )
    def test_deactivated_membership_denied(self, gate, role) -> None:
        ops = _org_ops(_session(org_role=role, member_active=False))
        with pytest.raises(PermissionDeniedError):
            _run(getattr(ops, gate)(uuid4(), uuid4()))

    @pytest.mark.parametrize(
        ("gate", "role"),
        [
            ("require_org_member", OrganizationRole.MEMBER),
            ("require_org_admin", OrganizationRole.ADMIN),
            ("require_org_owner", OrganizationRole.OWNER),
        ],
    )
    def test_active_membership_allowed(self, gate, role) -> None:
        ops = _org_ops(_session(org_role=role, member_active=True))
        membership = _run(getattr(ops, gate)(uuid4(), uuid4()))
        assert membership.role is role

    def test_get_membership_still_returns_the_deactivated_row(self) -> None:
        """Management flows (re-add, remove, role edits) need the row; the
        ``is_active`` condition lives in the gates, not in the lookup.
        """
        ops = _org_ops(
            _session(org_role=OrganizationRole.MEMBER, member_active=False)
        )
        membership = _run(ops.get_membership(uuid4(), uuid4()))
        assert membership is not None
        assert membership.is_active is False


class TestDomainAdminFollowsMembership:
    def test_domain_admin_row_confers_nothing_when_deactivated(self) -> None:
        from uniffy.core.auth.domain_admin import is_domain_admin

        session = _session(
            org_role=OrganizationRole.MEMBER,
            member_active=False,
            admin_domains=frozenset({DomainType.AGENTS}),
        )
        with _cache_passthrough():
            granted = _run(
                is_domain_admin(session, uuid4(), uuid4(), DomainType.AGENTS)
            )
        assert granted is False

    def test_domain_admin_row_grants_when_active(self) -> None:
        from uniffy.core.auth.domain_admin import is_domain_admin

        session = _session(
            org_role=OrganizationRole.MEMBER,
            member_active=True,
            admin_domains=frozenset({DomainType.AGENTS}),
        )
        with _cache_passthrough():
            granted = _run(
                is_domain_admin(session, uuid4(), uuid4(), DomainType.AGENTS)
            )
        assert granted is True

    def test_domain_admin_claims_empty_when_deactivated(self) -> None:
        from uniffy.core.auth.domain_admin import get_user_domain_admins

        session = _session(
            org_role=OrganizationRole.MEMBER,
            member_active=False,
            admin_domains=frozenset({DomainType.CHAT}),
        )
        assert _run(get_user_domain_admins(session, uuid4(), uuid4())) == []


class TestAgentsBuilderGate:
    @pytest.mark.parametrize(
        ("org_role", "admin_domains"),
        [
            (OrganizationRole.ADMIN, frozenset()),
            (OrganizationRole.OWNER, frozenset()),
            (OrganizationRole.MEMBER, frozenset({DomainType.AGENTS})),
        ],
    )
    def test_deactivated_builder_denied(self, org_role, admin_domains) -> None:
        from uniffy.domains.agents.access import is_agents_builder, require_agents_builder

        session = _session(
            org_role=org_role, member_active=False, admin_domains=admin_domains
        )
        with _cache_passthrough():
            assert _run(is_agents_builder(session, uuid4(), uuid4())) is False

        session = _session(
            org_role=org_role, member_active=False, admin_domains=admin_domains
        )
        with _cache_passthrough(), pytest.raises(PermissionDeniedError):
            _run(require_agents_builder(session, uuid4(), uuid4()))

    def test_active_builder_allowed(self) -> None:
        from uniffy.domains.agents.access import is_agents_builder

        session = _session(org_role=OrganizationRole.ADMIN, member_active=True)
        with _cache_passthrough():
            assert _run(is_agents_builder(session, uuid4(), uuid4())) is True


def _with_content_member_grant(session, role):
    """Overlay a direct ContentMember row onto the fake session."""
    outer_execute = session.execute.side_effect

    async def execute(stmt):
        if stmt.column_descriptions[0].get("entity") is ContentMember:
            return _result(role)
        return await outer_execute(stmt)

    session.execute = AsyncMock(side_effect=execute)
    return session


def _effective_role(session, *, user_id=None, owner_id=None, access_mode, baseline_role=None):
    from uniffy.core.auth.permissions.checker import PermissionChecker

    checker = PermissionChecker(session)
    with _cache_passthrough():
        return _run(
            checker.effective_role(
                user_id or uuid4(),
                uuid4(),
                ContentType.NOTE,
                uuid4(),
                owner_id=owner_id or uuid4(),
                access_mode=access_mode,
                baseline_role=baseline_role,
            )
        )


class TestEffectiveRoleMembershipGate:
    def test_deactivated_member_grant_confers_nothing(self) -> None:
        session = _with_content_member_grant(
            _session(org_role=OrganizationRole.MEMBER, member_active=False),
            ContentRole.EDITOR,
        )
        role = _effective_role(session, access_mode=AccessMode.EXPLICIT_MEMBERS)
        assert role is None

    def test_deactivated_owner_loses_their_own_content(self) -> None:
        user_id = uuid4()
        session = _session(org_role=OrganizationRole.MEMBER, member_active=False)
        role = _effective_role(
            session,
            user_id=user_id,
            owner_id=user_id,
            access_mode=AccessMode.OWNER_ONLY,
        )
        assert role is None

    def test_grant_without_any_membership_row_confers_nothing(self) -> None:
        session = _with_content_member_grant(
            _session(org_role=None), ContentRole.ADMIN
        )
        role = _effective_role(session, access_mode=AccessMode.EXPLICIT_MEMBERS)
        assert role is None

    def test_active_member_grant_resolves(self) -> None:
        session = _with_content_member_grant(
            _session(org_role=OrganizationRole.MEMBER, member_active=True),
            ContentRole.EDITOR,
        )
        role = _effective_role(session, access_mode=AccessMode.EXPLICIT_MEMBERS)
        assert role is ContentRole.EDITOR

    def test_active_owner_resolves(self) -> None:
        user_id = uuid4()
        session = _session(org_role=OrganizationRole.MEMBER, member_active=True)
        role = _effective_role(
            session,
            user_id=user_id,
            owner_id=user_id,
            access_mode=AccessMode.OWNER_ONLY,
        )
        assert role is ContentRole.OWNER


class TestAccessFilterMembershipGate:
    def _build(self, session):
        from uniffy.core.auth.permissions.queries import ContentAccessQuery
        from uniffy.core.models.notes.note import Note

        query = ContentAccessQuery(session)
        return _run(
            query.build_accessible_filter(
                user_id=uuid4(),
                organization_id=uuid4(),
                content_type=ContentType.NOTE,
                content_id_column=Note.id,
                owner_id_column=Note.owner_id,
                access_mode_column=Note.access_mode,
                baseline_role_column=Note.baseline_role,
            )
        )

    def test_deactivated_actor_gets_a_no_rows_filter(self) -> None:
        expr = self._build(
            _session(org_role=OrganizationRole.MEMBER, member_active=False)
        )
        assert isinstance(expr, False_)

    def test_missing_membership_gets_a_no_rows_filter(self) -> None:
        expr = self._build(_session(org_role=None))
        assert isinstance(expr, False_)

    def test_active_actor_gets_the_normal_filter(self) -> None:
        expr = self._build(
            _session(org_role=OrganizationRole.MEMBER, member_active=True)
        )
        assert not isinstance(expr, False_)


class TestAddMemberReactivation:
    def _patches(self):
        return (
            patch(
                "uniffy.domains.organizations.operations.write_audit_event",
                AsyncMock(),
            ),
            patch(
                "uniffy.domains.organizations.operations._drop_user_perm_cache",
                AsyncMock(),
            ),
            patch(
                "uniffy.core.auth.membership.invalidate_membership_cache",
                AsyncMock(),
            ),
        )

    def test_readd_reactivates_and_applies_the_incoming_role(self) -> None:
        session = _session(org_role=OrganizationRole.MEMBER, member_active=False)
        session.commit = AsyncMock()
        session.refresh = AsyncMock()
        ops = _org_ops(session)
        user_id, org_id = uuid4(), uuid4()

        audit_patch, drop_patch, invalidate_patch = self._patches()
        with audit_patch, drop_patch as drop_cache, invalidate_patch as invalidate:
            membership = _run(
                ops.add_member(user_id, org_id, role=OrganizationRole.ADMIN)
            )

        assert membership.is_active is True
        assert membership.role is OrganizationRole.ADMIN
        drop_cache.assert_awaited_once_with(user_id)
        invalidate.assert_awaited_once_with(user_id, org_id)

    def test_readd_of_an_active_member_changes_nothing(self) -> None:
        session = _session(org_role=OrganizationRole.MEMBER, member_active=True)
        ops = _org_ops(session)

        membership = _run(
            ops.add_member(uuid4(), uuid4(), role=OrganizationRole.ADMIN)
        )

        assert membership.is_active is True
        assert membership.role is OrganizationRole.MEMBER


class TestChatModerationGate:
    def _channel(self):
        return NS(id=uuid4(), channel_type=ChannelType.PRIVATE, is_archived=False)

    def _checker(self, session):
        from uniffy.domains.chat.access import ChatAccessChecker

        return ChatAccessChecker(session)

    def test_deactivated_org_admin_is_not_a_moderator(self) -> None:
        checker = self._checker(
            _session(org_role=OrganizationRole.ADMIN, member_active=False)
        )
        with _cache_passthrough():
            assert _run(checker.is_org_admin(uuid4(), uuid4())) is False

    def test_deactivated_admin_cannot_reach_a_private_channel(self) -> None:
        session = _session(
            org_role=OrganizationRole.ADMIN,
            member_active=False,
            admin_domains=frozenset({DomainType.CHAT}),
        )
        checker = self._checker(session)
        with _cache_passthrough(), pytest.raises(PermissionDeniedError):
            _run(checker.check_access(uuid4(), uuid4(), self._channel()))

    def test_active_admin_reaches_a_private_channel(self) -> None:
        checker = self._checker(
            _session(org_role=OrganizationRole.ADMIN, member_active=True)
        )
        with _cache_passthrough():
            _run(checker.check_access(uuid4(), uuid4(), self._channel()))

    def test_deactivated_member_with_channel_row_still_reaches_the_channel(self) -> None:
        """Chat membership is its own model: deactivating the org membership
        drops the moderator bypass, not the channel row itself.
        """
        session = _session(org_role=OrganizationRole.MEMBER, member_active=False)
        outer_execute = session.execute.side_effect

        async def execute(stmt):
            if stmt.column_descriptions[0].get("entity") is ChatChannelMember:
                return _result(NS(role="MEMBER"))
            return await outer_execute(stmt)

        session.execute = AsyncMock(side_effect=execute)
        checker = self._checker(session)
        with _cache_passthrough():
            _run(checker.check_access(uuid4(), uuid4(), self._channel()))
