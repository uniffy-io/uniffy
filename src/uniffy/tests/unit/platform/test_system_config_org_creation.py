"""The operator setting for who may create organizations: write, audit, wire mapping and handler."""

from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

import pytest
from connectrpc.code import Code
from connectrpc.errors import ConnectError
from uniffy_proto.superadmin.v1.system_config_pb import (
    OrgCreationPolicy as OrgCreationPolicyProto,
)
from uniffy_proto.superadmin.v1.system_config_pb import (
    SetOrgCreationPolicyRequest,
)

from uniffy.core.audit.actions import Action
from uniffy.core.auth.principal import (
    AuthenticatedPrincipal,
    reset_current_principal,
    set_current_principal,
)
from uniffy.core.config.org_creation import OrgCreationPolicy, OrgCreationState
from uniffy.core.config.registration import PublicRegistrationState
from uniffy.core.config.source import SettingSource
from uniffy.core.errors import PermissionDeniedError
from uniffy.core.models.audit.event import AuditEvent, AuditResourceType
from uniffy.core.models.login.user import User
from uniffy.core.models.settings.deployment_setting import DeploymentSetting
from uniffy.core.realtime.buffer import UpdateBuffer
from uniffy.core.types import generate_id
from uniffy.domains.platform.config.converters import (
    config_to_proto,
    org_creation_policy_from_proto,
    org_creation_policy_to_proto,
)
from uniffy.domains.platform.config.handlers import SystemConfigHandlers
from uniffy.domains.platform.config.operations import SystemConfigOperations, SystemConfigState
from uniffy.domains.users.operations import UserOperations

_HANDLERS = "uniffy.domains.platform.config.handlers"
# Field 1 carries 99, a policy number this build does not define.
_UNKNOWN_POLICY_WIRE = bytes([0x08, 99])


class DeploymentSettingsStore:
    """Stands in for the deployment_settings table behind every reader and writer."""

    def __init__(self) -> None:
        self.rows: dict[tuple[str, str], DeploymentSetting] = {}

    def __call__(self, session: object) -> DeploymentSettingsStore:
        return self

    async def get_namespace(self, namespace: str) -> dict[str, DeploymentSetting]:
        return {key: row for (ns, key), row in self.rows.items() if ns == namespace}

    async def set(
        self,
        *,
        namespace: str,
        key: str,
        value: object,
        is_secret: bool = False,
        updated_by_user_id: UUID | None = None,
    ) -> None:
        self.rows[namespace, key] = DeploymentSetting(
            namespace=namespace,
            key=key,
            value=value,
            is_secret=is_secret,
            updated_by_user_id=updated_by_user_id,
        )


@pytest.fixture
def store(monkeypatch: pytest.MonkeyPatch) -> Iterator[DeploymentSettingsStore]:
    monkeypatch.delenv("ALLOW_ORG_CREATION", raising=False)
    monkeypatch.delenv("ALLOW_PUBLIC_REGISTRATION", raising=False)
    fake = DeploymentSettingsStore()
    with (
        patch("uniffy.domains.platform.config.operations.DeploymentSettingsOperations", fake),
        patch("uniffy.core.config.org_creation.DeploymentSettingsOperations", fake),
        patch("uniffy.core.config.registration.DeploymentSettingsOperations", fake),
        patch.object(UserOperations, "require_system_admin", AsyncMock()),
    ):
        yield fake


def _audit_rows(session: MagicMock) -> list[AuditEvent]:
    return [
        call.args[0]
        for call in session.add.call_args_list
        if call.args and isinstance(call.args[0], AuditEvent)
    ]


class TestSetOrgCreationPolicy:
    async def test_writes_the_row_and_the_audit_row_then_commits(
        self, store: DeploymentSettingsStore
    ) -> None:
        session = MagicMock()
        session.commit = AsyncMock()
        operator_id = generate_id()

        state = await SystemConfigOperations(session).set_org_creation_policy(
            user_id=operator_id, policy=OrgCreationPolicy.MEMBERS
        )

        row = store.rows["system", "org_creation"]
        assert row.value == OrgCreationPolicy.MEMBERS.value
        assert row.is_secret is False
        assert row.updated_by_user_id == operator_id
        (audit,) = _audit_rows(session)
        assert audit.action == Action.SYSTEM_ORG_CREATION_CHANGED
        assert audit.resource_type == AuditResourceType.SYSTEM_FLAG
        assert audit.organization_id is None
        assert audit.actor_user_id == operator_id
        assert audit.details == {
            "key": "org_creation",
            "policy": "members",
            "previous_policy": "operators_and_owners",
            "previous_source": "default",
        }
        session.commit.assert_awaited_once()
        assert state.org_creation == OrgCreationState(
            policy=OrgCreationPolicy.MEMBERS, source=SettingSource.DEPLOYMENT
        )

    async def test_audit_records_the_previous_deployment_value(
        self, store: DeploymentSettingsStore
    ) -> None:
        session = MagicMock()
        session.commit = AsyncMock()
        ops = SystemConfigOperations(session)
        await ops.set_org_creation_policy(user_id=generate_id(), policy=OrgCreationPolicy.ANYONE)

        await ops.set_org_creation_policy(
            user_id=generate_id(), policy=OrgCreationPolicy.OPERATORS_ONLY
        )

        last = _audit_rows(session)[-1]
        assert last.details["previous_policy"] == OrgCreationPolicy.ANYONE.value
        assert last.details["previous_source"] == SettingSource.DEPLOYMENT.value
        assert store.rows["system", "org_creation"].value == OrgCreationPolicy.OPERATORS_ONLY.value

    async def test_non_operator_is_refused_before_any_write(
        self, store: DeploymentSettingsStore
    ) -> None:
        session = MagicMock()
        session.commit = AsyncMock()
        with (
            patch.object(
                UserOperations,
                "require_system_admin",
                AsyncMock(side_effect=PermissionDeniedError("Requires system admin privileges")),
            ),
            pytest.raises(PermissionDeniedError),
        ):
            await SystemConfigOperations(session).set_org_creation_policy(
                user_id=generate_id(), policy=OrgCreationPolicy.ANYONE
            )

        assert store.rows == {}
        session.commit.assert_not_awaited()


class TestConverters:
    @pytest.mark.parametrize("policy", list(OrgCreationPolicy))
    def test_round_trip(self, policy: OrgCreationPolicy) -> None:
        wire = org_creation_policy_to_proto(policy)

        assert wire is not OrgCreationPolicyProto.UNSPECIFIED
        assert org_creation_policy_from_proto(wire) is policy

    def test_every_known_wire_value_maps_back(self) -> None:
        known = [
            value
            for value in OrgCreationPolicyProto
            if value is not OrgCreationPolicyProto.UNSPECIFIED
        ]

        assert {org_creation_policy_from_proto(value) for value in known} == set(OrgCreationPolicy)

    def test_unspecified_and_unknown_wire_values_map_to_none(self) -> None:
        unknown = SetOrgCreationPolicyRequest.from_binary(_UNKNOWN_POLICY_WIRE).policy

        assert org_creation_policy_from_proto(OrgCreationPolicyProto.UNSPECIFIED) is None
        assert org_creation_policy_from_proto(unknown) is None

    def test_config_carries_the_policy_and_its_source(self) -> None:
        state = SystemConfigState(
            public_registration=PublicRegistrationState(enabled=True, source=SettingSource.ENV),
            org_creation=OrgCreationState(
                policy=OrgCreationPolicy.ANYONE, source=SettingSource.DEPLOYMENT
            ),
        )

        msg = config_to_proto(state)

        assert msg.org_creation is not None
        assert msg.org_creation.policy is OrgCreationPolicyProto.ANYONE
        assert msg.org_creation.source == SettingSource.DEPLOYMENT.value
        assert msg.public_registration is not None
        assert msg.public_registration.enabled is True
        assert msg.public_registration.source == SettingSource.ENV.value


class UserRow:
    """The caller's own user row, answered for every statement the session runs."""

    def __init__(self, user: User) -> None:
        self._user = user
        self.add = MagicMock()
        self.commit = AsyncMock()

    async def execute(self, statement: object) -> UserRow:
        return self

    def scalar_one_or_none(self) -> User:
        return self._user


@pytest.fixture
def caller(monkeypatch: pytest.MonkeyPatch) -> Iterator[User]:
    user = User(
        id=generate_id(),
        email="caller@example.com",
        username="caller",
        is_active=True,
        is_system_admin=False,
    )

    @asynccontextmanager
    async def open_session() -> AsyncIterator[UserRow]:
        yield UserRow(user)

    monkeypatch.setattr(f"{_HANDLERS}.open_session", open_session)
    token = set_current_principal(
        AuthenticatedPrincipal(
            user_id=user.id,
            organization_id=generate_id(),
            session_id=None,
            token_version=1,
            full_name="Caller",
            avatar_key="",
        )
    )
    try:
        yield user
    finally:
        reset_current_principal(token)


async def _set(request: SetOrgCreationPolicyRequest) -> None:
    await SystemConfigHandlers(UpdateBuffer()).set_org_creation_policy(request, MagicMock())


class TestHandler:
    @pytest.mark.parametrize(
        "request_",
        [
            SetOrgCreationPolicyRequest(),
            SetOrgCreationPolicyRequest(policy=OrgCreationPolicyProto.UNSPECIFIED),
            SetOrgCreationPolicyRequest.from_binary(_UNKNOWN_POLICY_WIRE),
        ],
    )
    async def test_unspecified_policy_is_invalid(
        self, request_: SetOrgCreationPolicyRequest, caller: User
    ) -> None:
        caller.is_system_admin = True
        with (
            patch(f"{_HANDLERS}.SystemConfigOperations") as operations,
            pytest.raises(ConnectError) as rejected,
        ):
            await _set(request_)

        assert rejected.value.code is Code.INVALID_ARGUMENT
        operations.assert_not_called()

    async def test_signed_in_user_without_the_platform_flag_is_denied(self, caller: User) -> None:
        with pytest.raises(ConnectError) as denied:
            await _set(SetOrgCreationPolicyRequest(policy=OrgCreationPolicyProto.ANYONE))

        assert denied.value.code is Code.PERMISSION_DENIED

    async def test_operator_gets_the_updated_config(
        self, caller: User, store: DeploymentSettingsStore
    ) -> None:
        caller.is_system_admin = True
        handlers = SystemConfigHandlers(UpdateBuffer())

        response = await handlers.set_org_creation_policy(
            SetOrgCreationPolicyRequest(policy=OrgCreationPolicyProto.MEMBERS), MagicMock()
        )

        assert response.config is not None
        assert response.config.org_creation is not None
        assert response.config.org_creation.policy is OrgCreationPolicyProto.MEMBERS
        assert response.config.org_creation.source == SettingSource.DEPLOYMENT.value
        assert store.rows["system", "org_creation"].value == OrgCreationPolicy.MEMBERS.value
