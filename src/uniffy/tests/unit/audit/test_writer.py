"""Behavioural tests for ``core.audit.writer.write_audit_event``.

Verifies the contract documented in
``.claude/plans/audit-log-integration.md``:

- Adds the row to the caller's session without committing.
- Captures the actor's ``OrganizationRole`` via a single ``SELECT``.
- Missing membership snapshots as ``NULL``.
- Reads client IP / User-Agent from the request-context ContextVars.
- Exceptions propagate (no swallow).
"""

import asyncio
from contextvars import copy_context
from unittest.mock import AsyncMock, MagicMock

import pytest

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.audit.request_context import (
    audit_ip_var,
    audit_user_agent_var,
)
from uniffy.core.models.login.organization_member import OrganizationRole
from uniffy.core.types import generate_id


def _build_session(*, role: OrganizationRole | None) -> MagicMock:
    """Return a session whose role-snapshot SELECT returns ``role``."""
    session = MagicMock()
    role_result = MagicMock()
    role_result.scalar_one_or_none.return_value = role
    session.execute = AsyncMock(return_value=role_result)
    session.add = MagicMock()
    return session


async def test_writer_adds_row_to_caller_session() -> None:
    session = _build_session(role=OrganizationRole.ADMIN)
    org_id = generate_id()
    actor_id = generate_id()
    resource_id = generate_id()

    await write_audit_event(
        session,
        organization_id=org_id,
        actor_user_id=actor_id,
        action=Action.PERMISSIONS_MEMBER_ADDED,
        resource_type="NOTE",
        resource_id=resource_id,
        details={"subject_id": "abc"},
    )

    session.add.assert_called_once()
    event = session.add.call_args[0][0]
    assert event.organization_id == org_id
    assert event.actor_user_id == actor_id
    assert event.action == Action.PERMISSIONS_MEMBER_ADDED
    assert event.resource_type == "NOTE"
    assert event.resource_id == resource_id
    assert event.actor_org_role == OrganizationRole.ADMIN.value
    assert event.details == {"subject_id": "abc"}
    session.commit.assert_not_called()


async def test_missing_membership_snapshots_as_null_role() -> None:
    session = _build_session(role=None)

    await write_audit_event(
        session,
        organization_id=generate_id(),
        actor_user_id=generate_id(),
        action=Action.AUTH_LOGIN_SUCCESS,
    )

    event = session.add.call_args[0][0]
    assert event.actor_org_role is None


async def test_none_actor_skips_role_lookup() -> None:
    session = _build_session(role=OrganizationRole.OWNER)

    await write_audit_event(
        session,
        organization_id=generate_id(),
        actor_user_id=None,
        action="system.cron",
    )

    session.execute.assert_not_called()
    event = session.add.call_args[0][0]
    assert event.actor_user_id is None
    assert event.actor_org_role is None


async def test_ip_and_user_agent_pulled_from_context_vars() -> None:
    session = _build_session(role=OrganizationRole.MEMBER)

    async def emit() -> None:
        await write_audit_event(
            session,
            organization_id=generate_id(),
            actor_user_id=generate_id(),
            action=Action.AUTH_LOGIN_SUCCESS,
        )

    ctx = copy_context()
    ctx.run(audit_ip_var.set, "203.0.113.42")
    ctx.run(audit_user_agent_var.set, "Mozilla/5.0")
    await asyncio.create_task(emit(), context=ctx)

    event = session.add.call_args[0][0]
    assert event.ip_address == "203.0.113.42"
    assert event.user_agent == "Mozilla/5.0"


async def test_writer_does_not_swallow_exceptions() -> None:
    session = MagicMock()
    session.execute = AsyncMock(side_effect=RuntimeError("DB down"))

    with pytest.raises(RuntimeError, match="DB down"):
        await write_audit_event(
            session,
            organization_id=generate_id(),
            actor_user_id=generate_id(),
            action=Action.AUTH_LOGIN_SUCCESS,
        )


async def test_details_default_to_empty_dict() -> None:
    session = _build_session(role=OrganizationRole.MEMBER)

    await write_audit_event(
        session,
        organization_id=generate_id(),
        actor_user_id=generate_id(),
        action=Action.AUTH_LOGIN_SUCCESS,
    )

    event = session.add.call_args[0][0]
    assert event.details == {}
