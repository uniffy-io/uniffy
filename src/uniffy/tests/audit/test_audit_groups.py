"""Audit emissions for the groups domain.

Covers create / update / delete plus add_member / remove_member.
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from uniffy.core.audit.actions import Action
from uniffy.core.models.login.group import Group
from uniffy.core.models.login.group_member import GroupRole
from uniffy.domains.groups.operations import GroupOperations


def _audit_rows(session: MagicMock) -> list:
    return [
        call.args[0]
        for call in session.add.call_args_list
        if call.args and call.args[0].__class__.__name__ == "AuditEvent"
    ]


def _make_group() -> Group:
    return Group(
        id=uuid4(),
        organization_id=uuid4(),
        name="Engineering",
        slug="engineering",
        created_by_user_id=uuid4(),
        description="",
        is_private=False,
        is_default=False,
    )


def test_create_emits_group_created() -> None:
    session = MagicMock()
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()

    ops = GroupOperations(session)
    actor = uuid4()
    org = uuid4()

    asyncio.run(
        ops.create(
            organization_id=org,
            name="Designers",
            created_by_user_id=actor,
            is_private=True,
        )
    )

    rows = _audit_rows(session)
    assert len(rows) == 1
    row = rows[0]
    assert row.action == Action.GROUP_CREATED
    assert row.organization_id == org
    assert row.actor_user_id == actor
    assert row.details["name"] == "Designers"
    assert row.details["is_private"] is True


def test_update_emits_changed_keys() -> None:
    group = _make_group()
    session = MagicMock()
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()

    ops = GroupOperations(session)
    with patch.object(
        GroupOperations, "get_by_id", AsyncMock(return_value=group)
    ):
        asyncio.run(
            ops.update(
                group_id=group.id,
                name="Eng",
                description="Updated",
                actor_user_id=uuid4(),
            )
        )

    rows = _audit_rows(session)
    assert len(rows) == 1
    assert rows[0].action == Action.GROUP_UPDATED
    assert sorted(rows[0].details["changed_keys"]) == ["description", "name"]


def test_update_with_no_changes_skips_audit() -> None:
    group = _make_group()
    session = MagicMock()
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()

    ops = GroupOperations(session)
    with patch.object(
        GroupOperations, "get_by_id", AsyncMock(return_value=group)
    ):
        asyncio.run(ops.update(group_id=group.id, actor_user_id=uuid4()))

    assert _audit_rows(session) == []


def test_delete_emits_group_deleted_with_member_count() -> None:
    group = _make_group()
    session = MagicMock()
    member_lookup = MagicMock()
    member_lookup.all.return_value = [(uuid4(),), (uuid4(),)]
    session.execute = AsyncMock(return_value=member_lookup)
    session.add = MagicMock()
    session.delete = AsyncMock()
    session.commit = AsyncMock()

    ops = GroupOperations(session)
    with patch.object(
        GroupOperations, "get_by_id", AsyncMock(return_value=group)
    ), patch(
        "uniffy.domains.groups.operations.invalidate_perm_user",
        AsyncMock(return_value=None),
    ):
        asyncio.run(ops.delete(group.id, actor_user_id=uuid4()))

    rows = _audit_rows(session)
    assert len(rows) == 1
    row = rows[0]
    assert row.action == Action.GROUP_DELETED
    assert row.details["member_count"] == 2


def test_add_member_emits_group_member_added() -> None:
    group = _make_group()
    session = MagicMock()
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()

    ops = GroupOperations(session)
    target = uuid4()
    actor = uuid4()

    with patch.object(
        GroupOperations, "get_by_id", AsyncMock(return_value=group)
    ), patch(
        "uniffy.domains.groups.operations.invalidate_perm_user",
        AsyncMock(return_value=None),
    ):
        asyncio.run(
            ops.add_member(group.id, target, GroupRole.MEMBER, actor_user_id=actor)
        )

    rows = _audit_rows(session)
    added = [r for r in rows if r.action == Action.GROUP_MEMBER_ADDED]
    assert len(added) == 1
    assert added[0].actor_user_id == actor
    assert added[0].details["target_user_id"] == str(target)
    assert added[0].details["role"] == "MEMBER"


def test_remove_member_emits_group_member_removed() -> None:
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
    target = uuid4()
    actor = uuid4()

    with patch.object(
        GroupOperations, "get_by_id", AsyncMock(return_value=group)
    ), patch(
        "uniffy.domains.groups.operations.invalidate_perm_user",
        AsyncMock(return_value=None),
    ):
        asyncio.run(ops.remove_member(group.id, target, actor_user_id=actor))

    rows = _audit_rows(session)
    removed = [r for r in rows if r.action == Action.GROUP_MEMBER_REMOVED]
    assert len(removed) == 1
    assert removed[0].actor_user_id == actor
    assert removed[0].details["target_user_id"] == str(target)
    assert removed[0].details["previous_role"] == "MEMBER"
