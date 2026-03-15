"""Tests for agent audit logging helper."""

import asyncio
from unittest.mock import MagicMock
from uuid import uuid4

from uniffy.domains.agents.audit import create_audit_log


def test_create_audit_log_adds_entry() -> None:
    """Verify create_audit_log adds an AgentAuditLog to the session."""
    session = MagicMock()

    org_id = uuid4()
    user_id = uuid4()
    resource_id = uuid4()

    asyncio.run(
        create_audit_log(
            session,
            organization_id=org_id,
            user_id=user_id,
            action="agent.create",
            resource_type="agent",
            resource_id=resource_id,
            details={"name": "Test Agent"},
        )
    )

    session.add.assert_called_once()
    entry = session.add.call_args[0][0]
    assert entry.organization_id == org_id
    assert entry.user_id == user_id
    assert entry.action == "agent.create"
    assert entry.resource_type == "agent"
    assert entry.resource_id == resource_id
    assert entry.details == {"name": "Test Agent"}


def test_create_audit_log_with_none_details() -> None:
    """Verify create_audit_log works without details."""
    session = MagicMock()

    asyncio.run(
        create_audit_log(
            session,
            organization_id=uuid4(),
            user_id=uuid4(),
            action="provider_key.remove",
            resource_type="provider_key",
            resource_id=uuid4(),
        )
    )

    session.add.assert_called_once()
    entry = session.add.call_args[0][0]
    assert entry.details is None


def test_create_audit_log_handles_exception_gracefully() -> None:
    """Verify create_audit_log catches and logs exceptions."""
    session = MagicMock()
    session.add.side_effect = RuntimeError("DB is down")

    # Should not raise
    asyncio.run(
        create_audit_log(
            session,
            organization_id=uuid4(),
            user_id=uuid4(),
            action="skill.delete",
            resource_type="skill",
            resource_id=uuid4(),
            details={"name": "test"},
        )
    )

    # Verify add was attempted
    session.add.assert_called_once()
