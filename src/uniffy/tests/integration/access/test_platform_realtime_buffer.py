"""The platform read of the realtime edit buffer on live PostgreSQL and Valkey."""

from collections.abc import AsyncIterator
from unittest.mock import MagicMock
from uuid import UUID

import pytest
import pytest_asyncio
from connectrpc.code import Code
from connectrpc.errors import ConnectError
from sqlalchemy import delete
from uniffy_proto.superadmin.v1.system_config_pb import (
    GetRealtimeBufferStatusRequest,
    RealtimeBufferStatus,
    RealtimeBufferTotals,
)

from uniffy.core.auth.principal import (
    AuthenticatedPrincipal,
    reset_current_principal,
    set_current_principal,
)
from uniffy.core.models.login.user import User
from uniffy.core.realtime.buffer import RecoveryReason, UpdateBuffer
from uniffy.core.realtime.buffer_keys import DUE_DELAY_MS, stored_bytes
from uniffy.core.realtime.checkpoint import CheckpointStatus, checkpoint_document
from uniffy.core.types import generate_id
from uniffy.domains.platform.config.handlers import SystemConfigHandlers
from uniffy.infrastructure.database import open_session
from uniffy.tests.integration.access.realtime_buffers import (
    admit,
    edit,
    env,  # noqa: F401 - fixture
    establish,
)

pytestmark = pytest.mark.asyncio(loop_scope="session")

NOTHING_PENDING = RealtimeBufferTotals(
    pending_bytes=0, pending_records=0, pending_documents=0, oldest_pending_seconds=0
)


@pytest_asyncio.fixture(loop_scope="session")
async def platform_admin(database) -> AsyncIterator[UUID]:
    """A platform operator with no organization membership."""
    suffix = generate_id().hex[-12:]
    operator = User(
        email=f"ita-operator-{suffix}@test.local",
        username=f"ita-operator-{suffix}",
        full_name="Operator Tester",
        hashed_password="x",
        is_system_admin=True,
    )
    operator_id = operator.id
    async with open_session() as db:
        db.add(operator)
        await db.commit()
    try:
        yield operator_id
    finally:
        async with open_session() as db:
            await db.execute(delete(User).where(User.id == operator_id))
            await db.commit()


async def read_as(
    buffer: UpdateBuffer, user_id: UUID, organization_id: UUID | None = None
) -> RealtimeBufferStatus:
    token = set_current_principal(
        AuthenticatedPrincipal(
            user_id=user_id,
            organization_id=organization_id,
            session_id=None,
            token_version=None,
            full_name="",
            avatar_key="",
        )
    )
    try:
        response = await SystemConfigHandlers(buffer).get_realtime_buffer_status(
            GetRealtimeBufferStatusRequest(), MagicMock()
        )
    finally:
        reset_current_principal(token)
    assert response.status is not None
    return response.status


@pytest.mark.parametrize("role", ["owner_id", "admin_id", "member_id"])
async def test_organization_roles_are_denied(access, valkey_namespace: str, role: str) -> None:
    buffer = UpdateBuffer(namespace=valkey_namespace)

    with pytest.raises(ConnectError) as denied:
        await read_as(buffer, getattr(access, role), access.org_id)

    assert denied.value.code is Code.PERMISSION_DENIED


async def test_totals_count_a_pending_stream_until_its_checkpoint(env, platform_admin: UUID) -> None:
    before = await read_as(env.buffer, platform_admin)
    payload = edit(env.base, " pending")

    head = await establish(env)
    await admit(env, head, "u-1", payload)
    pending = await read_as(env.buffer, platform_admin)
    result = await checkpoint_document(env.buffer, head.scope, enqueue=env.jobs)
    drained = await read_as(env.buffer, platform_admin)

    assert before.totals == NOTHING_PENDING
    totals = pending.totals
    assert totals is not None
    assert (totals.pending_bytes, totals.pending_records, totals.pending_documents) == (
        stored_bytes("u-1", payload),
        1,
        1,
    )
    # The edit is younger than its due delay, so no checkpoint is late yet.
    assert 0 <= totals.oldest_pending_seconds < DUE_DELAY_MS / 1000
    # The document's first epoch counts as an uninitialized reset in this process.
    uninitialized = RecoveryReason.UNINITIALIZED.value
    assert pending.epoch_resets[uninitialized] == before.epoch_resets.get(uninitialized, 0) + 1
    assert result.status is CheckpointStatus.COMMITTED
    assert drained.totals == NOTHING_PENDING
