"""The operator read of the realtime edit buffer through its RPC handler."""

from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager
from unittest.mock import MagicMock

import pytest
from connectrpc.code import Code
from connectrpc.errors import ConnectError
from uniffy_proto.superadmin.v1.system_config_pb import (
    GetRealtimeBufferStatusRequest,
    GetRealtimeBufferStatusResponse,
    RealtimeBufferVerdict,
)

from uniffy.core.auth.principal import (
    AuthenticatedPrincipal,
    reset_current_principal,
    set_current_principal,
)
from uniffy.core.models.login.user import User
from uniffy.core.realtime.buffer import UpdateBuffer
from uniffy.core.realtime.preflight import (
    PENDING_BUDGET_OVERRIDE,
    PREFLIGHT_MODE,
    PreflightMode,
    run_preflight,
)
from uniffy.core.types import generate_id
from uniffy.domains.platform.config.handlers import SystemConfigHandlers

RUN_ID = "565deefd1b36dff07a7d63be7f9b8352d97885ec"
VALKEY_VERSION = "9.1.2"


class UserRow:
    """Stands in for PostgreSQL behind the session: the caller's own user row."""

    def __init__(self, user: User) -> None:
        self._user = user

    async def execute(self, statement: object) -> UserRow:
        return self

    def scalar_one_or_none(self) -> User:
        return self._user


class PreflightValkey:
    """Answers the preflight's INFO and CONFIG GET reads from fixed facts."""

    async def info(self, section: str) -> dict[str, object]:
        return {
            "server": {"run_id": RUN_ID, "valkey_version": VALKEY_VERSION},
            "persistence": {"aof_enabled": 1},
        }[section]

    async def config_get(self, pattern: str) -> dict[str, str]:
        return {
            "maxmemory-policy": {pattern: "allkeys-lru"},
            "maxmemory": {pattern: str(512 * 1024 * 1024)},
            "save": {pattern: ""},
            "appendfsync": {pattern: "everysec"},
        }[pattern]


@pytest.fixture(autouse=True)
def unreachable_valkey(monkeypatch: pytest.MonkeyPatch) -> None:
    # Nothing listens on port 1, so a connect attempt fails at once instead of finding a server.
    monkeypatch.setenv("VALKEY_HOST", "127.0.0.1")
    monkeypatch.setenv("VALKEY_PORT", "1")


@pytest.fixture
def caller(monkeypatch: pytest.MonkeyPatch) -> Iterator[User]:
    """A signed-in user whose row the handler's session returns."""
    user = User(
        id=generate_id(),
        email="caller@example.com",
        username="caller",
        full_name="Caller",
        hashed_password="hashed",
        is_active=True,
        is_system_admin=False,
    )

    @asynccontextmanager
    async def open_session() -> AsyncIterator[UserRow]:
        yield UserRow(user)

    monkeypatch.setattr("uniffy.domains.platform.config.handlers.open_session", open_session)
    token = set_current_principal(
        AuthenticatedPrincipal(
            user_id=user.id,
            organization_id=generate_id(),
            session_id=None,
            token_version=1,
            full_name=user.full_name,
            avatar_key="",
        )
    )
    try:
        yield user
    finally:
        reset_current_principal(token)


async def read_status() -> GetRealtimeBufferStatusResponse:
    handlers = SystemConfigHandlers(UpdateBuffer())
    return await handlers.get_realtime_buffer_status(GetRealtimeBufferStatusRequest(), MagicMock())


async def test_a_signed_in_user_without_the_platform_flag_is_denied(caller: User) -> None:
    # Organization roles live on memberships and never open this read; the access suite proves
    # an org owner, admin and member are each denied on real rows.
    with pytest.raises(ConnectError) as denied:
        await read_status()

    assert denied.value.code is Code.PERMISSION_DENIED


async def test_platform_admin_reads_the_recorded_preflight(caller: User) -> None:
    caller.is_system_admin = True
    recorded = await run_preflight(
        PreflightValkey(), mode=PreflightMode.STRICT, budget_override=None
    )

    status = (await read_status()).status

    assert status is not None
    assert status.verdict is RealtimeBufferVerdict.DISABLED
    assert status.preflight_mode == PREFLIGHT_MODE.value
    assert status.pending_budget_from_env is (PENDING_BUDGET_OVERRIDE is not None)
    preflight = status.preflight
    assert preflight is not None
    assert (preflight.eviction_policy, preflight.maxmemory_bytes) == ("allkeys-lru", 512 * 1024**2)
    assert (preflight.aof_enabled, preflight.rdb_snapshots_configured) == (True, False)
    assert preflight.loss_window == recorded.loss_window
    assert preflight.valkey_version == VALKEY_VERSION
    assert preflight.valkey_run_id_prefix == RUN_ID[:8]
    assert preflight.pending_budget_bytes == recorded.pending_budget_bytes == 128 * 1024**2


async def test_platform_admin_still_reads_the_verdict_when_valkey_is_unreachable(
    caller: User,
) -> None:
    caller.is_system_admin = True
    await run_preflight(PreflightValkey(), mode=PreflightMode.WARN, budget_override=None)

    status = (await read_status()).status

    assert status is not None
    assert status.verdict is RealtimeBufferVerdict.ENABLED
    assert status.totals is None
