"""Agents gates refuse a lost membership with the typed reason and a missing role without it."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

import pytest
from connectrpc.code import Code
from connectrpc.errors import ConnectError
from uniffy_proto.agents.v1.memories_pb import GetMemorySharingRequest, SetMemorySharingRequest

from uniffy.core.errors import MembershipRequiredError, PermissionDeniedError
from uniffy.core.models.login.organization_member import OrganizationRole
from uniffy.core.types import generate_id
from uniffy.domains.agents.memories.handlers import MemoriesHandlers
from uniffy.domains.agents.runtime.settings.operations import RuntimeSettingsOperations
from uniffy.domains.agents.skills.metrics import SkillMetricsReader
from uniffy.transport.rpc import MEMBERSHIP_REQUIRED_REASON, error_info_detail, with_domain_details

_SETTINGS = "uniffy.domains.agents.runtime.settings.operations"
_ORGANIZATIONS = "uniffy.domains.organizations.operations"
_ACCESS = "uniffy.domains.agents.access"
_MEMORIES = "uniffy.domains.agents.memories.handlers"


def _membership(role: OrganizationRole | None) -> AsyncMock:
    return AsyncMock(return_value=SimpleNamespace(role=role) if role is not None else None)


def _session() -> MagicMock:
    rows = MagicMock()
    rows.mappings.return_value.all.return_value = []
    session = MagicMock()
    session.execute = AsyncMock(return_value=rows)
    return session


def _wire_details(error: ConnectError) -> list[tuple[str, bytes]]:
    return [(d.type_name, d.message_bytes) for d in with_domain_details(error).details]


_REASON = error_info_detail(MEMBERSHIP_REQUIRED_REASON)
_MEMBERSHIP_REQUIRED = [(_REASON.type_name, _REASON.message_bytes)]


class TestRuntimeSettingsAdminGate:
    async def _gate(self, role: OrganizationRole | None) -> None:
        operations = RuntimeSettingsOperations(_session())
        with patch(f"{_SETTINGS}.get_active_membership", _membership(role)):
            await operations._require_admin(generate_id(), generate_id())

    async def test_a_lost_membership_raises_the_typed_refusal(self) -> None:
        with pytest.raises(MembershipRequiredError):
            await self._gate(None)

    async def test_a_member_without_the_admin_role_gets_a_plain_refusal(self) -> None:
        with pytest.raises(PermissionDeniedError) as refused:
            await self._gate(OrganizationRole.MEMBER)

        assert not isinstance(refused.value, MembershipRequiredError)

    @pytest.mark.parametrize("role", [OrganizationRole.ADMIN, OrganizationRole.OWNER])
    async def test_an_admin_passes(self, role: OrganizationRole) -> None:
        await self._gate(role)


class TestSkillMetricsGate:
    async def _read(
        self,
        role: OrganizationRole | None,
        *,
        skill_id: UUID | None,
        agents_domain_admin: bool = False,
    ) -> MagicMock:
        session = _session()
        membership = _membership(role)
        with (
            patch(f"{_ORGANIZATIONS}.get_active_membership", membership),
            patch(f"{_ACCESS}.get_active_membership", membership),
            patch(f"{_ACCESS}.is_domain_admin", AsyncMock(return_value=agents_domain_admin)),
        ):
            await SkillMetricsReader(session).read(
                user_id=generate_id(),
                organization_id=generate_id(),
                skill_id=skill_id,
            )
        return session

    @pytest.mark.parametrize("skill_id", [None, generate_id()], ids=["org-wide", "one-skill"])
    async def test_a_lost_membership_raises_the_typed_refusal(self, skill_id: UUID | None) -> None:
        with pytest.raises(MembershipRequiredError):
            await self._read(None, skill_id=skill_id)

    async def test_a_member_without_the_admin_role_gets_a_plain_refusal(self) -> None:
        with pytest.raises(PermissionDeniedError) as refused:
            await self._read(OrganizationRole.MEMBER, skill_id=None)

        assert not isinstance(refused.value, MembershipRequiredError)

    async def test_a_member_who_is_not_a_builder_gets_a_plain_refusal(self) -> None:
        with pytest.raises(PermissionDeniedError) as refused:
            await self._read(OrganizationRole.MEMBER, skill_id=generate_id())

        assert not isinstance(refused.value, MembershipRequiredError)

    async def test_an_agents_domain_admin_reads_one_skill(self) -> None:
        session = await self._read(
            OrganizationRole.MEMBER, skill_id=generate_id(), agents_domain_admin=True
        )

        session.execute.assert_awaited_once()


class TestMemorySharingGate:
    @asynccontextmanager
    async def _rpc(self, *, member: bool) -> AsyncIterator[AsyncMock]:
        @asynccontextmanager
        async def open_session() -> AsyncIterator[MagicMock]:
            yield _session()

        runtime_settings = AsyncMock()
        with (
            patch(f"{_MEMORIES}.current_user_id", MagicMock(return_value=generate_id())),
            patch(f"{_MEMORIES}.resolve_organization_id", MagicMock(return_value=generate_id())),
            patch(f"{_MEMORIES}.open_session", open_session),
            patch(f"{_MEMORIES}.is_active_member", AsyncMock(return_value=member)),
            patch(f"{_MEMORIES}.get_runtime_settings", runtime_settings),
        ):
            yield runtime_settings

    @pytest.mark.parametrize(
        ("method", "request_message"),
        [
            ("get_memory_sharing", GetMemorySharingRequest()),
            ("set_memory_sharing", SetMemorySharingRequest(use_in_shared_spaces=True)),
        ],
    )
    async def test_a_lost_membership_answers_with_the_typed_reason(
        self, method: str, request_message: object
    ) -> None:
        async with self._rpc(member=False) as runtime_settings:
            with pytest.raises(ConnectError) as refused:
                await getattr(MemoriesHandlers(), method)(request_message, MagicMock())

        assert refused.value.code is Code.PERMISSION_DENIED
        assert _wire_details(refused.value) == _MEMBERSHIP_REQUIRED
        runtime_settings.assert_not_awaited()
