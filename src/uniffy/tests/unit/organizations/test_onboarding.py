"""Organization entry flow: who it is pending for, resuming, finishing, and staging on creation."""

from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

import pytest
from connectrpc.code import Code
from connectrpc.errors import ConnectError
from sqlalchemy.dialects.postgresql import Insert
from uniffy_proto.organizations.v1.organizations_pb import (
    OnboardingStep as OnboardingStepProto,
)
from uniffy_proto.organizations.v1.organizations_pb import (
    RecordOnboardingStepRequest,
)

from uniffy.core.auth.principal import (
    AuthenticatedPrincipal,
    reset_current_principal,
    set_current_principal,
)
from uniffy.core.errors import MembershipRequiredError, PermissionDeniedError
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.settings.org_setting import OrgSetting
from uniffy.core.types import generate_id
from uniffy.domains.organizations.onboarding import (
    OnboardingEntry,
    OnboardingStatus,
    OnboardingStep,
    stage_onboarding,
)
from uniffy.domains.organizations.onboarding.converters import (
    STEP_FROM_PROTO,
    STEP_TO_PROTO,
    onboarding_state_to_proto,
)
from uniffy.domains.organizations.onboarding.operations import (
    OnboardingOperations,
    OnboardingView,
)
from uniffy.domains.organizations.onboarding.state import entry_from_blob
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.domains.organizations.service import OrganizationsServiceImpl

_OPERATIONS = "uniffy.domains.organizations.operations"


class _Store:
    """Answers the membership read, the settings row read and the settings upsert."""

    def __init__(self, entry: OnboardingEntry | None, membership: OrganizationMember | None):
        self.blob: Any = entry.to_blob() if entry else None
        self.membership = membership
        self.writes: list[dict[str, Any]] = []
        self.locked = False
        self.session = MagicMock()
        self.session.commit = AsyncMock()
        self.session.rollback = AsyncMock()
        self.session.execute = AsyncMock(side_effect=self._execute)

    async def _execute(self, statement: Any) -> MagicMock:
        result = MagicMock()
        if isinstance(statement, Insert):
            value = statement.compile().params["value"]
            self.writes.append(value)
            self.blob = value
            return result
        entity = statement.column_descriptions[0]["entity"]
        if entity is OrgSetting:
            self.locked = self.locked or statement._for_update_arg is not None
            row = None if self.blob is None else OrgSetting(value=self.blob, is_secret=False)
            result.scalar_one_or_none.return_value = row
            return result
        result.scalar_one_or_none.return_value = self.membership
        return result

    @property
    def entry(self) -> OnboardingEntry | None:
        return entry_from_blob(self.blob)


def _member(user_id: UUID, org_id: UUID, role: OrganizationRole) -> OrganizationMember:
    return OrganizationMember(user_id=user_id, organization_id=org_id, role=role)


def _store(
    *,
    creator: UUID,
    caller: UUID,
    org_id: UUID,
    role: OrganizationRole = OrganizationRole.OWNER,
    status: OnboardingStatus = OnboardingStatus.PENDING,
    step: OnboardingStep = OnboardingStep.WELCOME,
    member: bool = True,
) -> _Store:
    entry = OnboardingEntry(user_id=creator, status=status, current_step=step)
    return _Store(entry, _member(caller, org_id, role) if member else None)


class TestPending:
    async def test_pending_for_the_creator_who_owns_it(self) -> None:
        creator, org_id = generate_id(), generate_id()
        store = _store(creator=creator, caller=creator, org_id=org_id, step=OnboardingStep.SHARING)

        view = await OnboardingOperations(store.session).get_state(creator, org_id)

        assert view == OnboardingView(pending=True, current_step=OnboardingStep.SHARING)

    async def test_not_pending_for_another_member(self) -> None:
        creator, other, org_id = generate_id(), generate_id(), generate_id()
        store = _store(creator=creator, caller=other, org_id=org_id, role=OrganizationRole.ADMIN)

        view = await OnboardingOperations(store.session).get_state(other, org_id)

        assert view == OnboardingView(pending=False, current_step=None)

    async def test_not_pending_for_a_second_owner(self) -> None:
        creator, other, org_id = generate_id(), generate_id(), generate_id()
        store = _store(creator=creator, caller=other, org_id=org_id)

        view = await OnboardingOperations(store.session).get_state(other, org_id)

        assert view.pending is False

    async def test_not_pending_once_ownership_moved_away(self) -> None:
        creator, org_id = generate_id(), generate_id()
        store = _store(creator=creator, caller=creator, org_id=org_id, role=OrganizationRole.ADMIN)

        view = await OnboardingOperations(store.session).get_state(creator, org_id)

        assert view.pending is False

    async def test_no_row_means_no_flow(self) -> None:
        creator, org_id = generate_id(), generate_id()
        store = _Store(None, _member(creator, org_id, OrganizationRole.OWNER))

        view = await OnboardingOperations(store.session).get_state(creator, org_id)

        assert view == OnboardingView(pending=False, current_step=None)

    @pytest.mark.parametrize("blob", ["pending", {"status": "pending"}, {"user_id": "x"}])
    def test_malformed_blob_reads_as_no_flow(self, blob: object) -> None:
        assert entry_from_blob(blob) is None

    async def test_non_member_is_refused_with_the_typed_membership_error(self) -> None:
        creator, org_id = generate_id(), generate_id()
        store = _store(creator=creator, caller=creator, org_id=org_id, member=False)

        with pytest.raises(MembershipRequiredError):
            await OnboardingOperations(store.session).get_state(creator, org_id)


class TestRecordStep:
    async def test_moves_the_resume_point_and_commits(self) -> None:
        creator, org_id = generate_id(), generate_id()
        store = _store(creator=creator, caller=creator, org_id=org_id)

        view = await OnboardingOperations(store.session).record_step(
            creator, org_id, OnboardingStep.AGENTS
        )

        assert view == OnboardingView(pending=True, current_step=OnboardingStep.AGENTS)
        assert store.entry == OnboardingEntry(user_id=creator, current_step=OnboardingStep.AGENTS)
        assert store.locked
        store.session.commit.assert_awaited_once()

    async def test_after_finishing_is_a_no_op(self) -> None:
        creator, org_id = generate_id(), generate_id()
        store = _store(
            creator=creator,
            caller=creator,
            org_id=org_id,
            status=OnboardingStatus.COMPLETED,
            step=OnboardingStep.LAUNCH,
        )

        view = await OnboardingOperations(store.session).record_step(
            creator, org_id, OnboardingStep.WELCOME
        )

        assert view == OnboardingView(pending=False, current_step=OnboardingStep.LAUNCH)
        assert store.writes == []
        store.session.commit.assert_not_awaited()

    async def test_requires_the_owner(self) -> None:
        creator, org_id = generate_id(), generate_id()
        store = _store(creator=creator, caller=creator, org_id=org_id, role=OrganizationRole.ADMIN)

        with pytest.raises(PermissionDeniedError):
            await OnboardingOperations(store.session).record_step(
                creator, org_id, OnboardingStep.TEAM
            )

        assert store.writes == []


class TestFinish:
    @pytest.mark.parametrize(
        ("dismissed", "status"),
        [(False, OnboardingStatus.COMPLETED), (True, OnboardingStatus.DISMISSED)],
    )
    async def test_ends_the_flow(self, dismissed: bool, status: OnboardingStatus) -> None:
        creator, org_id = generate_id(), generate_id()
        store = _store(creator=creator, caller=creator, org_id=org_id, step=OnboardingStep.TEAM)

        view = await OnboardingOperations(store.session).finish(
            creator, org_id, dismissed=dismissed
        )

        assert view == OnboardingView(pending=False, current_step=OnboardingStep.TEAM)
        entry = store.entry
        assert entry is not None
        assert entry.status is status
        assert entry.finished_at is not None
        store.session.commit.assert_awaited_once()

    async def test_finishing_twice_writes_once(self) -> None:
        creator, org_id = generate_id(), generate_id()
        store = _store(creator=creator, caller=creator, org_id=org_id)
        ops = OnboardingOperations(store.session)

        await ops.finish(creator, org_id, dismissed=False)
        first = store.entry
        again = await ops.finish(creator, org_id, dismissed=True)

        assert again.pending is False
        assert len(store.writes) == 1
        assert store.entry == first

    async def test_another_owner_cannot_finish_the_creators_flow(self) -> None:
        creator, other, org_id = generate_id(), generate_id(), generate_id()
        store = _store(creator=creator, caller=other, org_id=org_id)

        view = await OnboardingOperations(store.session).finish(other, org_id, dismissed=True)

        assert view.pending is False
        assert store.writes == []
        assert store.entry is not None
        assert store.entry.status is OnboardingStatus.PENDING


class TestStaging:
    async def test_stage_writes_a_pending_flow_for_the_owner_without_committing(self) -> None:
        owner, org_id = generate_id(), generate_id()
        store = _Store(None, None)

        await stage_onboarding(store.session, organization_id=org_id, user_id=owner)

        assert store.entry == OnboardingEntry(user_id=owner)
        store.session.commit.assert_not_awaited()

    @pytest.mark.parametrize("begin", [True, False])
    async def test_stage_organization_starts_the_flow_only_when_asked(self, begin: bool) -> None:
        owner_id = generate_id()
        session = MagicMock()
        session.add = MagicMock()
        session.add_all = MagicMock()
        session.flush = AsyncMock()
        owner_lookup = MagicMock()
        owner_lookup.scalar_one_or_none.return_value = SimpleNamespace(id=owner_id)
        session.execute = AsyncMock(return_value=owner_lookup)
        ops = OrganizationOperations(session)
        cipher = MagicMock(provision=AsyncMock())
        channels = MagicMock(stage_channel=AsyncMock(return_value=MagicMock()))
        stage = AsyncMock()

        with (
            patch(f"{_OPERATIONS}.OrgCipher", return_value=cipher),
            patch(f"{_OPERATIONS}.stage_personal_attachments_folder", AsyncMock()),
            patch(f"{_OPERATIONS}.create_default_presets", AsyncMock()),
            patch(f"{_OPERATIONS}.create_default_tag_filter_presets", AsyncMock()),
            patch(f"{_OPERATIONS}.ChatChannelOperations", return_value=channels),
            patch(f"{_OPERATIONS}.stage_default_agent", AsyncMock(return_value=MagicMock())),
            patch(f"{_OPERATIONS}.write_audit_event", AsyncMock()),
            patch(f"{_OPERATIONS}.stage_onboarding", stage),
        ):
            staged = await ops.stage_organization(
                "Acme", "acme", owner_id, begin_onboarding=begin
            )

        if begin:
            stage.assert_awaited_once_with(
                session, organization_id=staged.organization.id, user_id=owner_id
            )
        else:
            stage.assert_not_awaited()

    async def test_create_passes_the_flag_to_staging(self) -> None:
        session = MagicMock()
        session.commit = AsyncMock()
        session.refresh = AsyncMock()
        ops = OrganizationOperations(session)
        staged = SimpleNamespace(organization=MagicMock())
        owner_id = generate_id()

        with (
            patch.object(ops, "stage_organization", AsyncMock(return_value=staged)) as stage,
            patch.object(ops, "finish_organization_create_after_commit", AsyncMock()),
        ):
            await ops.create(
                "Acme", "acme", owner_id, search_indexer=MagicMock(), begin_onboarding=True
            )

        assert stage.await_args.kwargs["begin_onboarding"] is True


class TestProto:
    def test_every_step_round_trips(self) -> None:
        assert set(STEP_TO_PROTO) == set(OnboardingStep)
        for step, proto in STEP_TO_PROTO.items():
            assert STEP_FROM_PROTO[proto] is step

    def test_no_resume_point_is_unspecified(self) -> None:
        proto = onboarding_state_to_proto(OnboardingView(pending=False, current_step=None))

        assert proto.current_step == OnboardingStepProto.UNSPECIFIED

    async def test_unspecified_step_is_an_invalid_argument(self) -> None:
        service = OrganizationsServiceImpl(MagicMock(), MagicMock())
        org_id = generate_id()
        request = RecordOnboardingStepRequest(
            organization_id=str(org_id), step=OnboardingStepProto.UNSPECIFIED
        )
        token = set_current_principal(
            AuthenticatedPrincipal(
                user_id=generate_id(),
                organization_id=org_id,
                session_id=None,
                token_version=None,
                full_name="",
                avatar_key="",
            )
        )
        try:
            with pytest.raises(ConnectError) as refused:
                await service.record_onboarding_step(request, MagicMock())
        finally:
            reset_current_principal(token)

        assert refused.value.code is Code.INVALID_ARGUMENT
