"""Concurrency tests for ``write_audit_event``.

Python 3.13's ``asyncio.gather`` copies the current ``Context`` per
task, so ``ContextVar`` values set by the request-context middleware
must reach every concurrent audit write inside the request - notably
the agent ToolExecutor's read-tool pool fan-out.
"""

import asyncio
from contextvars import copy_context
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.audit.request_context import (
    audit_ip_var,
    audit_user_agent_var,
)
from uniffy.core.models.login.organization_member import OrganizationRole


def _build_session() -> MagicMock:
    session = MagicMock()
    role_result = MagicMock()
    role_result.scalar_one_or_none.return_value = OrganizationRole.MEMBER
    session.execute = AsyncMock(return_value=role_result)
    session.add = MagicMock()
    return session


def test_asyncio_gather_inherits_request_context_ip_ua() -> None:
    session = _build_session()
    org_id = uuid4()

    async def emit() -> None:
        await write_audit_event(
            session,
            organization_id=org_id,
            actor_user_id=uuid4(),
            action=Action.PERMISSIONS_MEMBER_ADDED,
            resource_type="NOTE",
            resource_id=uuid4(),
        )

    async def fan_out() -> None:
        await asyncio.gather(emit(), emit(), emit())

    def run_with_context() -> None:
        audit_ip_var.set("198.51.100.7")
        audit_user_agent_var.set("uniffy-test/0.1")
        asyncio.run(fan_out())

    ctx = copy_context()
    ctx.run(run_with_context)

    assert session.add.call_count == 3
    for call in session.add.call_args_list:
        event = call.args[0]
        assert event.ip_address == "198.51.100.7"
        assert event.user_agent == "uniffy-test/0.1"
