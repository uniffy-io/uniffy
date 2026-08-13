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
    with patch.object(
        OrganizationOperations, "get_by_id", AsyncMock(return_value=org)
    ):
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
    with patch.object(
        OrganizationOperations, "get_by_id", AsyncMock(return_value=org)
    ):
        await ops.update(org_id=org.id, actor_user_id=generate_id())

    assert _audit_rows(session) == []


async def test_add_member_emits_member_added() -> None:
    session = MagicMock()
    session.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=lambda: None))
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    indexer = MagicMock()
    indexer.index_for_organization = AsyncMock(return_value=None)

    ops = OrganizationOperations(session)
    ops._user_indexer = indexer

    org_id = generate_id()
    target = generate_id()
    actor = generate_id()

    attachment_ops_instance = MagicMock()
    attachment_ops_instance.get_or_create_attachments_folder = AsyncMock(
        return_value=MagicMock()
    )
    attachment_factory = MagicMock(return_value=attachment_ops_instance)

    chat_ops_instance = MagicMock()
    chat_ops_instance.join_default_channels = AsyncMock(return_value=None)
    chat_factory = MagicMock(return_value=chat_ops_instance)

    with patch.object(
        OrganizationOperations, "get_membership", AsyncMock(return_value=None)
    ), patch(
        "uniffy.domains.files.attachments.operations.AttachmentOperations",
        attachment_factory,
    ), patch(
        "uniffy.domains.chat.channels.operations.ChatChannelOperations",
        chat_factory,
    ), patch(
        "uniffy.domains.organizations.operations._drop_user_perm_cache",
        AsyncMock(return_value=None),
    ):
        await ops.add_member(
            target, org_id, OrganizationRole.ADMIN, actor_user_id=actor
        )

    rows = _audit_rows(session)
    added = [r for r in rows if r.action == Action.ORGANIZATION_MEMBER_ADDED]
    assert len(added) == 1
    assert added[0].actor_user_id == actor
    assert added[0].resource_id == target
    assert added[0].details["role"] == "ADMIN"


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
    with patch.object(
        OrganizationOperations, "require_org_admin", AsyncMock(return_value=None)
    ), patch.object(
        OrganizationOperations,
        "get_membership",
        AsyncMock(return_value=admin_membership),
    ), patch(
        "uniffy.domains.organizations.operations._drop_user_perm_cache",
        AsyncMock(return_value=None),
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
    ops._user_indexer = indexer

    with patch.object(
        OrganizationOperations, "require_org_admin", AsyncMock(return_value=None)
    ), patch.object(
        OrganizationOperations,
        "get_membership",
        AsyncMock(return_value=membership),
    ), patch(
        "uniffy.domains.organizations.operations._drop_user_perm_cache",
        AsyncMock(return_value=None),
    ):
        await ops.remove_member(admin, org_id, target)

    rows = _audit_rows(session)
    removed = [r for r in rows if r.action == Action.ORGANIZATION_MEMBER_REMOVED]
    assert len(removed) == 1
    assert removed[0].details["previous_role"] == "MEMBER"
    assert removed[0].actor_user_id == admin


async def test_update_organization_settings_emits_changed_keys() -> None:
    org = _make_org()
    org.settings = {"chat": {"agents_enabled": False}}
    session = MagicMock()
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()

    ops = OrganizationOperations(session)

    with patch.object(
        OrganizationOperations, "require_org_admin", AsyncMock(return_value=None)
    ), patch.object(
        OrganizationOperations, "get_by_id", AsyncMock(return_value=org)
    ):
        await ops.update_organization_settings(generate_id(), org.id, chat_agents_enabled=True)

    rows = _audit_rows(session)
    assert len(rows) == 1
    assert rows[0].action == Action.ORGANIZATION_SETTINGS_CHANGED
    assert rows[0].details["changed_keys"] == ["chat.agents_enabled"]
