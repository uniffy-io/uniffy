"""Audit emissions for the groups domain.

Covers create / update / delete plus the three member mutations.
"""

from contextlib import ExitStack
from unittest.mock import AsyncMock, MagicMock, patch

from uniffy.core.audit.actions import Action
from uniffy.core.models.login.group import Group
from uniffy.core.models.login.group_member import GroupRole
from uniffy.core.types import generate_id
from uniffy.domains.groups.operations import GroupOperations
from uniffy.domains.organizations.operations import OrganizationOperations


def _audit_rows(session: MagicMock) -> list:
    return [
        call.args[0]
        for call in session.add.call_args_list
        if call.args and call.args[0].__class__.__name__ == "AuditEvent"
    ]


def _make_group() -> Group:
    return Group(
        id=generate_id(),
        organization_id=generate_id(),
        name="Engineering",
        slug="engineering",
        created_by_user_id=generate_id(),
        description="",
        is_private=False,
        is_default=False,
    )


def _permitted(group: Group | None = None) -> ExitStack:
    """Stub the org gates and the org-scoped row load so the test observes
    only the audit behavior.
    """
    stack = ExitStack()
    stack.enter_context(
        patch.object(OrganizationOperations, "require_org_admin", AsyncMock(return_value=None))
    )
    stack.enter_context(
        patch.object(OrganizationOperations, "require_org_member", AsyncMock(return_value=None))
    )
    stack.enter_context(
        patch(
            "uniffy.domains.groups.operations.invalidate_perm_user",
            AsyncMock(return_value=None),
        )
    )
    if group is not None:
        stack.enter_context(
            patch.object(GroupOperations, "_fetch", AsyncMock(return_value=group))
        )
    return stack


async def test_create_emits_group_created() -> None:
    session = MagicMock()
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()

    ops = GroupOperations(session)
    actor = generate_id()
    org = generate_id()

    with _permitted():
        await ops.create(
            organization_id=org,
            name="Designers",
            created_by_user_id=actor,
            is_private=True,
        )

    rows = _audit_rows(session)
    assert len(rows) == 1
    row = rows[0]
    assert row.action == Action.GROUP_CREATED
    assert row.organization_id == org
    assert row.actor_user_id == actor
    assert row.details["name"] == "Designers"
    assert row.details["is_private"] is True


async def test_update_emits_changed_keys() -> None:
    group = _make_group()
    session = MagicMock()
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()

    ops = GroupOperations(session)
    with _permitted(group):
        await ops.update(
            group_id=group.id,
            organization_id=group.organization_id,
            actor_user_id=generate_id(),
            name="Eng",
            description="Updated",
        )

    rows = _audit_rows(session)
    assert len(rows) == 1
    assert rows[0].action == Action.GROUP_UPDATED
    assert sorted(rows[0].details["changed_keys"]) == ["description", "name"]


async def test_update_with_no_changes_skips_audit() -> None:
    group = _make_group()
    session = MagicMock()
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()

    ops = GroupOperations(session)
    with _permitted(group):
        await ops.update(
            group_id=group.id,
            organization_id=group.organization_id,
            actor_user_id=generate_id(),
        )

    assert _audit_rows(session) == []


async def test_delete_emits_group_deleted_with_member_count() -> None:
    group = _make_group()
    session = MagicMock()
    member_lookup = MagicMock()
    member_lookup.all.return_value = [(generate_id(),), (generate_id(),)]
    session.execute = AsyncMock(return_value=member_lookup)
    session.add = MagicMock()
    session.delete = AsyncMock()
    session.commit = AsyncMock()

    ops = GroupOperations(session)
    with _permitted(group):
        await ops.delete(group.id, group.organization_id, actor_user_id=generate_id())

    rows = _audit_rows(session)
    assert len(rows) == 1
    row = rows[0]
    assert row.action == Action.GROUP_DELETED
    assert row.details["member_count"] == 2


async def test_add_member_emits_group_member_added() -> None:
    group = _make_group()
    session = MagicMock()
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()

    ops = GroupOperations(session)
    target = generate_id()
    actor = generate_id()

    with _permitted(group):
        await ops.add_member(
            group_id=group.id,
            organization_id=group.organization_id,
            user_id=target,
            actor_user_id=actor,
            role=GroupRole.MEMBER,
        )

    rows = _audit_rows(session)
    added = [r for r in rows if r.action == Action.GROUP_MEMBER_ADDED]
    assert len(added) == 1
    assert added[0].actor_user_id == actor
    assert added[0].details["target_user_id"] == str(target)
    assert added[0].details["role"] == "MEMBER"


async def test_update_member_role_emits_role_changed() -> None:
    group = _make_group()
    membership = MagicMock(role=GroupRole.MEMBER)
    session = MagicMock()
    session.execute = AsyncMock(
        return_value=MagicMock(scalar_one_or_none=lambda: membership)
    )
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()

    ops = GroupOperations(session)
    target = generate_id()
    actor = generate_id()

    with _permitted(group):
        await ops.update_member_role(
            group_id=group.id,
            organization_id=group.organization_id,
            user_id=target,
            role=GroupRole.ADMIN,
            actor_user_id=actor,
        )

    rows = _audit_rows(session)
    changed = [r for r in rows if r.action == Action.GROUP_MEMBER_ROLE_CHANGED]
    assert len(changed) == 1
    assert changed[0].actor_user_id == actor
    assert changed[0].details["target_user_id"] == str(target)
    assert changed[0].details["previous_role"] == "MEMBER"
    assert changed[0].details["role"] == "ADMIN"


async def test_remove_member_emits_group_member_removed() -> None:
    group = _make_group()
    membership = MagicMock(role=GroupRole.MEMBER)
    session = MagicMock()
    session.execute = AsyncMock(
        return_value=MagicMock(scalar_one_or_none=lambda: membership)
    )
    session.add = MagicMock()
    session.delete = AsyncMock()
    session.commit = AsyncMock()

    ops = GroupOperations(session)
    target = generate_id()
    actor = generate_id()

    with _permitted(group):
        await ops.remove_member(
            group_id=group.id,
            organization_id=group.organization_id,
            user_id=target,
            actor_user_id=actor,
        )

    rows = _audit_rows(session)
    removed = [r for r in rows if r.action == Action.GROUP_MEMBER_REMOVED]
    assert len(removed) == 1
    assert removed[0].actor_user_id == actor
    assert removed[0].details["target_user_id"] == str(target)
    assert removed[0].details["previous_role"] == "MEMBER"
