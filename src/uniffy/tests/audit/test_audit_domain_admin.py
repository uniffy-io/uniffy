"""Audit emissions for DomainAdmin grant / revoke.

Wires the writer through ``OrganizationOperations.grant_domain_admin``
and ``revoke_domain_admin``. DB calls are mocked. The test asserts:

- Grant emits exactly one ``domain_admin.granted`` row with the right shape.
- Revoke emits exactly one ``domain_admin.revoked`` row and packs
  ``previous_state`` into ``details``.
- Both writes happen before the surrounding commit so a mid-tx raise
  rolls the audit row back together with the mutation.
- The existing ``require_org_admin`` permission check blocks non-admins
  before any audit write runs.
"""

import asyncio
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from uniffy.core.audit.actions import Action
from uniffy.core.errors import PermissionDeniedError
from uniffy.core.models.login.organization_member import OrganizationRole
from uniffy.core.models.permissions.domain_admin import DomainAdmin
from uniffy.core.types import DomainType
from uniffy.domains.organizations.operations import OrganizationOperations


def _build_session_for_grant(existing: DomainAdmin | None) -> MagicMock:
    """Session that returns ``existing`` from the DomainAdmin lookup and
    a stub user from the trailing User select.
    """
    session = MagicMock()
    user = MagicMock()
    user.id = uuid4()

    domain_lookup = MagicMock()
    domain_lookup.scalar_one_or_none.return_value = existing
    role_lookup = MagicMock()
    role_lookup.scalar_one_or_none.return_value = OrganizationRole.MEMBER  # for audit
    user_lookup = MagicMock()
    user_lookup.scalar_one.return_value = user

    session.execute = AsyncMock(
        side_effect=[domain_lookup, role_lookup, user_lookup]
    )
    session.add = MagicMock()
    session.delete = AsyncMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    return session


def _patch_helpers() -> tuple:
    """Patch the side-effect helpers (`require_*`, pubsub, cache) so
    only the audit path under test runs.
    """
    require_admin = patch.object(
        OrganizationOperations,
        "require_org_admin",
        AsyncMock(return_value=None),
    )
    require_member = patch.object(
        OrganizationOperations,
        "require_org_member",
        AsyncMock(return_value=None),
    )
    invalidate = patch(
        "uniffy.domains.organizations.operations.invalidate_visible_sets_for_user",
        AsyncMock(return_value=None),
    )
    publish = patch(
        "uniffy.core.valkey.pubsub.publish_notification",
        AsyncMock(return_value=None),
    )
    return require_admin, require_member, invalidate, publish


def test_grant_emits_one_audit_row_with_correct_shape() -> None:
    session = _build_session_for_grant(existing=None)
    ops = OrganizationOperations(session)
    admin_id = uuid4()
    org_id = uuid4()
    target_id = uuid4()

    rqa, rqm, inv, pub = _patch_helpers()
    with rqa, rqm, inv, pub:
        asyncio.run(
            ops.grant_domain_admin(admin_id, org_id, target_id, DomainType.CHAT)
        )

    added = [c.args[0] for c in session.add.call_args_list]
    audit_rows = [obj for obj in added if obj.__class__.__name__ == "AuditEvent"]
    assert len(audit_rows) == 1

    row = audit_rows[0]
    assert row.action == Action.DOMAIN_ADMIN_GRANTED
    assert row.organization_id == org_id
    assert row.actor_user_id == admin_id
    assert row.resource_type == "USER"
    assert row.resource_id == target_id
    assert row.details == {"domain": "CHAT"}


def test_grant_writes_audit_before_commit() -> None:
    session = _build_session_for_grant(existing=None)
    ops = OrganizationOperations(session)

    call_order: list[str] = []
    original_add = session.add
    original_commit = session.commit

    def tracking_add(obj):
        if obj.__class__.__name__ == "AuditEvent":
            call_order.append("audit_add")
        original_add(obj)

    async def tracking_commit():
        call_order.append("commit")
        await original_commit()

    session.add = tracking_add
    session.commit = tracking_commit

    rqa, rqm, inv, pub = _patch_helpers()
    with rqa, rqm, inv, pub:
        asyncio.run(
            ops.grant_domain_admin(uuid4(), uuid4(), uuid4(), DomainType.FILES)
        )

    assert call_order == ["audit_add", "commit"]


def test_revoke_emits_one_audit_row_with_previous_state() -> None:
    session = MagicMock()
    existing = DomainAdmin(
        user_id=uuid4(),
        organization_id=uuid4(),
        domain=DomainType.CALENDAR,
        granted_by=uuid4(),
        granted_at=datetime(2026, 5, 19, 11, 30, 0, tzinfo=UTC),
    )

    domain_lookup = MagicMock()
    domain_lookup.scalar_one_or_none.return_value = existing
    role_lookup = MagicMock()
    role_lookup.scalar_one_or_none.return_value = OrganizationRole.ADMIN

    session.execute = AsyncMock(side_effect=[domain_lookup, role_lookup])
    session.add = MagicMock()
    session.delete = AsyncMock()
    session.commit = AsyncMock()

    ops = OrganizationOperations(session)
    admin_id = uuid4()
    org_id = uuid4()
    target_id = uuid4()

    rqa, rqm, inv, pub = _patch_helpers()
    with rqa, rqm, inv, pub:
        asyncio.run(
            ops.revoke_domain_admin(admin_id, org_id, target_id, DomainType.CALENDAR)
        )

    added = [c.args[0] for c in session.add.call_args_list]
    audit_rows = [obj for obj in added if obj.__class__.__name__ == "AuditEvent"]
    assert len(audit_rows) == 1

    row = audit_rows[0]
    assert row.action == Action.DOMAIN_ADMIN_REVOKED
    assert row.organization_id == org_id
    assert row.actor_user_id == admin_id
    assert row.resource_type == "USER"
    assert row.resource_id == target_id
    assert row.details["domain"] == "CALENDAR"
    assert row.details["previous_state"]["granted_at"] == "2026-05-19T11:30:00+00:00"
    assert row.details["previous_state"]["granted_by"] == str(existing.granted_by)


def test_non_admin_blocked_before_audit_runs() -> None:
    session = MagicMock()
    session.add = MagicMock()
    session.execute = AsyncMock()
    session.commit = AsyncMock()
    ops = OrganizationOperations(session)

    rqa = patch.object(
        OrganizationOperations,
        "require_org_admin",
        AsyncMock(side_effect=PermissionDeniedError("manage", "organization")),
    )
    rqm = patch.object(
        OrganizationOperations,
        "require_org_member",
        AsyncMock(return_value=None),
    )

    with rqa, rqm, pytest.raises(PermissionDeniedError):
        asyncio.run(
            ops.grant_domain_admin(uuid4(), uuid4(), uuid4(), DomainType.CHAT)
        )

    added = [c.args[0] for c in session.add.call_args_list]
    audit_rows = [obj for obj in added if obj.__class__.__name__ == "AuditEvent"]
    assert audit_rows == []
