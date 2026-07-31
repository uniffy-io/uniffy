"""Destructive-action audit emissions for projects and tasks."""

from unittest.mock import AsyncMock, MagicMock

from uniffy.core.audit.actions import Action
from uniffy.core.types import generate_id


def _audit_rows(session: MagicMock) -> list:
    return [
        call.args[0]
        for call in session.add.call_args_list
        if call.args and call.args[0].__class__.__name__ == "AuditEvent"
    ]


async def test_project_deleted_payload_has_name() -> None:
    from uniffy.core.audit import write_audit_event

    session = MagicMock()
    session.add = MagicMock()
    session.commit = AsyncMock()

    await write_audit_event(
        session,
        organization_id=generate_id(),
        actor_user_id=generate_id(),
        action=Action.PROJECT_DELETED,
        resource_type="PROJECT",
        resource_id=generate_id(),
        details={"name": "Q4 roadmap"},
    )

    rows = _audit_rows(session)
    assert len(rows) == 1
    assert rows[0].action == Action.PROJECT_DELETED
    assert rows[0].details["name"] == "Q4 roadmap"


async def test_task_moved_payload_records_parent_change() -> None:
    from uniffy.core.audit import write_audit_event

    session = MagicMock()
    session.add = MagicMock()
    session.commit = AsyncMock()

    task_id = generate_id()
    old_parent = generate_id()
    new_parent = generate_id()

    await write_audit_event(
        session,
        organization_id=generate_id(),
        actor_user_id=generate_id(),
        action=Action.TASK_MOVED,
        resource_type="TASK",
        resource_id=task_id,
        details={
            "previous_parent_id": str(old_parent),
            "new_parent_id": str(new_parent),
        },
    )

    rows = _audit_rows(session)
    assert len(rows) == 1
    assert rows[0].action == Action.TASK_MOVED
    assert rows[0].details["previous_parent_id"] == str(old_parent)
    assert rows[0].details["new_parent_id"] == str(new_parent)


async def test_task_permanently_deleted_carries_project_id() -> None:
    from uniffy.core.audit import write_audit_event

    session = MagicMock()
    session.add = MagicMock()
    session.commit = AsyncMock()

    task_id = generate_id()
    project_id = generate_id()

    await write_audit_event(
        session,
        organization_id=generate_id(),
        actor_user_id=generate_id(),
        action=Action.TASK_PERMANENTLY_DELETED,
        resource_type="TASK",
        resource_id=task_id,
        details={"title": "Ship widgets", "project_id": str(project_id)},
    )

    rows = _audit_rows(session)
    assert len(rows) == 1
    assert rows[0].action == Action.TASK_PERMANENTLY_DELETED
    assert rows[0].details["project_id"] == str(project_id)
