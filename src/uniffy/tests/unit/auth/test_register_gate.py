"""Registration honors the rate limit, pending first run setup and the registration policy."""

from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from connectrpc.code import Code
from connectrpc.errors import ConnectError
from uniffy_proto.auth.v1.auth_pb import RegisterRequest

from uniffy.core.audit import email_hash
from uniffy.core.errors import RateLimitExceededError
from uniffy.domains.auth import operations
from uniffy.domains.auth.errors import RegistrationError
from uniffy.domains.auth.handlers import AuthHandlers
from uniffy.domains.auth.operations import AuthOperations

_MODULE = "uniffy.domains.auth.operations"
_HANDLERS = "uniffy.domains.auth.handlers"
_EMAIL = "x@y.com"
_IP = "203.0.113.7"


def _exceeded() -> RateLimitExceededError:
    return RateLimitExceededError(
        resource="registration attempts (per email)",
        limit=operations.REGISTER_RATE_LIMIT_EMAIL,
        window_seconds=operations.REGISTER_RATE_LIMIT_WINDOW_SECONDS,
        retry_after=60,
    )


@dataclass
class Gates:
    rate_limit: AsyncMock
    client_ip: MagicMock
    setup_required: AsyncMock
    registration_enabled: AsyncMock
    audit: AsyncMock


@pytest.fixture
def gates() -> Iterator[Gates]:
    found = Gates(
        rate_limit=AsyncMock(),
        client_ip=MagicMock(return_value=None),
        setup_required=AsyncMock(return_value=False),
        registration_enabled=AsyncMock(return_value=True),
        audit=AsyncMock(),
    )
    with (
        patch(f"{_MODULE}.check_rate_limit", found.rate_limit),
        patch(f"{_MODULE}.client_ip_for_rate_limit", found.client_ip),
        patch(f"{_MODULE}.setup_required", found.setup_required),
        patch(f"{_MODULE}.public_registration_enabled", found.registration_enabled),
        patch(f"{_MODULE}.write_audit_event", found.audit),
    ):
        yield found


def _ops() -> tuple[AuthOperations, AsyncMock]:
    session = AsyncMock()
    session.add = MagicMock()
    return AuthOperations(session, AsyncMock()), session


async def _register(ops: AuthOperations, email: str = _EMAIL) -> None:
    await ops.register(email=email, username="x", password="password1")


def _rejection_reason(audit: AsyncMock) -> str:
    return audit.await_args.kwargs["details"]["reason"]


class TestRegisterGate:
    async def test_rejects_when_disabled(self, gates: Gates) -> None:
        gates.registration_enabled.return_value = False
        ops, session = _ops()

        with pytest.raises(RegistrationError, match="invited"):
            await _register(ops)

        gates.audit.assert_awaited_once()
        assert _rejection_reason(gates.audit) == "public_registration_disabled"
        session.add.assert_not_called()

    async def test_allows_when_enabled(self, gates: Gates) -> None:
        ops, _session = _ops()
        with (
            patch.object(ops, "_get_user_by_email", new=AsyncMock(return_value=object())),
            patch.object(ops, "_get_user_by_username", new=AsyncMock(return_value=None)),
            pytest.raises(RegistrationError, match="Could not create account"),
        ):
            await _register(ops, "dup@y.com")

    async def test_refuses_while_the_deployment_waits_for_setup(self, gates: Gates) -> None:
        gates.setup_required.return_value = True
        ops, session = _ops()

        with pytest.raises(RegistrationError, match="setup"):
            await _register(ops)

        assert _rejection_reason(gates.audit) == "setup_required"
        gates.registration_enabled.assert_not_awaited()
        session.add.assert_not_called()


class TestRegisterRateLimit:
    async def test_limits_per_email_hash_and_per_client_ip(self, gates: Gates) -> None:
        gates.client_ip.return_value = _IP
        gates.registration_enabled.return_value = False
        ops, _session = _ops()

        with pytest.raises(RegistrationError):
            await _register(ops, "  X@Y.com ")

        keys = [call.kwargs["key"] for call in gates.rate_limit.await_args_list]
        assert keys == [
            f"rl:auth:register:email:{email_hash(_EMAIL)}",
            f"rl:auth:register:ip:{_IP}",
        ]
        assert _EMAIL not in keys[0]

    async def test_skips_the_ip_bucket_without_a_trusted_client_ip(self, gates: Gates) -> None:
        gates.registration_enabled.return_value = False
        ops, _session = _ops()

        with pytest.raises(RegistrationError):
            await _register(ops)

        gates.rate_limit.assert_awaited_once()

    async def test_exceeded_limit_is_audited_and_stops_before_any_lookup(self, gates: Gates) -> None:
        gates.rate_limit.side_effect = _exceeded()
        ops, session = _ops()

        with pytest.raises(RateLimitExceededError):
            await _register(ops)

        assert _rejection_reason(gates.audit) == "rate_limited"
        gates.setup_required.assert_not_awaited()
        session.add.assert_not_called()


def _ctx() -> MagicMock:
    ctx = MagicMock()
    ctx.request_headers = {"user-agent": "Mozilla/5.0"}
    return ctx


class TestRegisterHandler:
    async def test_maps_an_exceeded_limit_to_resource_exhausted(self) -> None:
        @asynccontextmanager
        async def open_session() -> AsyncIterator[MagicMock]:
            yield MagicMock()

        operations_class = MagicMock()
        operations_class.return_value.register = AsyncMock(side_effect=_exceeded())
        with (
            patch(f"{_HANDLERS}.open_session", open_session),
            patch(f"{_HANDLERS}.AuthOperations", operations_class),
            pytest.raises(ConnectError) as exc_info,
        ):
            await AuthHandlers(MagicMock(), MagicMock()).register(
                RegisterRequest(email=_EMAIL, username="x", password="password1"), _ctx()
            )

        assert exc_info.value.code is Code.RESOURCE_EXHAUSTED
