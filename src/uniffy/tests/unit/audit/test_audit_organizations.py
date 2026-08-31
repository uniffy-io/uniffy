"""Audit emissions for the organizations domain.

Covers create / update on the org row plus add_member /
update_member_role / remove_member and the settings JSONB merge path.
DB calls are mocked.
"""

from unittest.mock import AsyncMock, MagicMock, patch

from uniffy.core.audit.actions import Action
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import (
    OrganizationMember,
    OrganizationRole,
)
from uniffy.core.types import generate_id
from uniffy.domains.organizations.operations import OrganizationOperations


def _audit_rows(session: MagicMock) -> list:
    return [
        call.args[0]
        for call in session.add.call_args_list
        if call.args and call.args[0].__class__.__name__ == "AuditEvent"
    ]


def _make_org(*, name: str = "Acme", slug: str = "acme") -> Organization:
    return Organization(
        id=generate_id(),
        name=name,
        slug=slug,
        plan="free",
        is_active=True,
        settings={},
    )


async def test_update_emits_settings_changed_with_diff() -> None:
    org = _make_org(name="Old", slug="old")
    session = MagicMock()
    session.execute = AsyncMock()
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()

    ops = OrganizationOperations(session)
    with patch.object(OrganizationOperations, "get_by_id", AsyncMock(return_value=org)):
        await ops.update(
            org_id=org.id,
            name="New",
            plan="pro",
            actor_user_id=generate_id(),
        )

    rows = _audit_rows(session)
    assert len(rows) == 1
    assert rows[0].action == Action.ORGANIZATION_SETTINGS_CHANGED
    assert sorted(rows[0].details["changed_keys"]) == ["name", "plan"]


async def test_update_with_no_changes_skips_audit() -> None:
    org = _make_org()
    session = MagicMock()
    session.execute = AsyncMock()
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()

    ops = OrganizationOperations(session)
    with patch.object(OrganizationOperations, "get_by_id", AsyncMock(return_value=org)):
        await ops.update(org_id=org.id, actor_user_id=generate_id())

    assert _audit_rows(session) == []


async def test_add_member_emits_member_added() -> None:
    session = MagicMock()
    org = _make_org()
    locked_org = MagicMock()
    locked_org.scalar_one_or_none.return_value = org
    session.execute = AsyncMock(return_value=locked_org)
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.flush = AsyncMock()
    session.refresh = AsyncMock()

    ops = OrganizationOperations(session)

    org_id = org.id
    target = generate_id()
    actor = generate_id()

    with (
        patch.object(OrganizationOperations, "get_membership", AsyncMock(return_value=None)),
        patch.object(OrganizationOperations, "_require_member_capacity", AsyncMock()),
        patch(
            "uniffy.domains.organizations.operations.stage_personal_attachments_folder",
            AsyncMock(),
        ),
        patch(
            "uniffy.domains.organizations.operations.stage_default_channel_memberships",
            AsyncMock(return_value=[]),
        ),
    ):
        await ops.stage_member(target, org_id, OrganizationRole.ADMIN, actor_user_id=actor)

    rows = _audit_rows(session)
    added = [r for r in rows if r.action == Action.ORGANIZATION_MEMBER_ADDED]
    assert len(added) == 1
    assert added[0].actor_user_id == actor
    assert added[0].resource_id == target
    assert added[0].details["role"] == "ADMIN"
    session.commit.assert_not_awaited()


async def test_update_member_role_emits_role_changed_with_previous_role() -> None:
    admin = generate_id()
    org_id = generate_id()
    target = generate_id()
    member = OrganizationMember(
        user_id=target,
        organization_id=org_id,
        role=OrganizationRole.MEMBER,
    )
    user = MagicMock(id=target)

    session = MagicMock()
    join_result = MagicMock()
    join_result.first.return_value = (member, user)
    session.execute = AsyncMock(side_effect=[join_result])
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()

    ops = OrganizationOperations(session)

    admin_membership = MagicMock(role=OrganizationRole.OWNER)
    with (
        patch.object(OrganizationOperations, "require_org_admin", AsyncMock(return_value=None)),
        patch.object(
            OrganizationOperations,
            "get_membership",
            AsyncMock(return_value=admin_membership),
        ),
    ):
        await ops.update_member_role(admin, org_id, target, OrganizationRole.ADMIN)

    rows = _audit_rows(session)
    assert len(rows) == 1
    row = rows[0]
    assert row.action == Action.ORGANIZATION_MEMBER_ROLE_CHANGED
    assert row.details["previous_role"] == "MEMBER"
    assert row.details["new_role"] == "ADMIN"


async def test_remove_member_emits_member_removed_with_previous_role() -> None:
    admin = generate_id()
    org_id = generate_id()
    target = generate_id()
    membership = OrganizationMember(
        user_id=target,
        organization_id=org_id,
        role=OrganizationRole.MEMBER,
    )

    session = MagicMock()
    session.execute = AsyncMock(return_value=MagicMock())
    session.add = MagicMock()
    session.delete = AsyncMock()
    session.commit = AsyncMock()
    indexer = MagicMock()
    indexer.remove_from_organization = AsyncMock(return_value=None)

    ops = OrganizationOperations(session)
    ops._directory_projection = indexer

    with (
        patch.object(OrganizationOperations, "require_org_admin", AsyncMock(return_value=None)),
        patch.object(
            OrganizationOperations,
            "get_membership",
            AsyncMock(return_value=membership),
        ),
    ):
        await ops.remove_member(admin, org_id, target)

    rows = _audit_rows(session)
    removed = [r for r in rows if r.action == Action.ORGANIZATION_MEMBER_REMOVED]
    assert len(removed) == 1
    assert removed[0].details["previous_role"] == "MEMBER"
    assert removed[0].actor_user_id == admin
