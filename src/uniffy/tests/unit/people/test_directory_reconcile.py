"""Reconcile primitives: match order, global write-once, deprovision guards."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from uniffy.core.errors import ValidationError
from uniffy.core.models.login.organization_member import OrganizationRole
from uniffy.core.models.login.user import User
from uniffy.core.models.people.identity import IdentitySource, IdentitySourceKind
from uniffy.core.types import generate_id
from uniffy.domains.people.directory import reconcile
from uniffy.domains.people.directory.base import LocalSourceConfig
from uniffy.domains.people.directory.local import LocalDirectoryProvider
from uniffy.domains.people.directory.registry import (
    capabilities_for,
    has_provider,
    parse_source_config,
)
from uniffy.domains.people.directory.types import DirectoryUser, ReconcileReport


def _source(kind: IdentitySourceKind = IdentitySourceKind.LDAP) -> IdentitySource:
    return IdentitySource(organization_id=generate_id(), kind=kind, name="Test")


def _result(scalar=None, scalars_first=None, rows=None):
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=scalar)
    result.scalar = MagicMock(return_value=scalar)
    scalars = MagicMock()
    scalars.first = MagicMock(return_value=scalars_first)
    scalars.all = MagicMock(return_value=rows or [])
    result.scalars = MagicMock(return_value=scalars)
    result.all = MagicMock(return_value=rows or [])
    result.rowcount = 0
    return result


def _session(execute_results):
    session = MagicMock()
    session.execute = AsyncMock(side_effect=list(execute_results))
    session.add = MagicMock()
    session.delete = AsyncMock()
    session.flush = AsyncMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    return session


def _record(**overrides) -> DirectoryUser:
    defaults = {
        "external_id": "ext-1",
        "user_name": "jane",
        "email": "Jane@Example.com",
        "display_name": "Jane Doe",
    }
    defaults.update(overrides)
    return DirectoryUser(**defaults)


class TestRegistry:
    def test_local_capabilities_all_false(self) -> None:
        capabilities = capabilities_for(IdentitySourceKind.LOCAL)
        assert not capabilities.supports_pull_users
        assert not capabilities.supports_push
        assert not capabilities.supports_login

    def test_oidc_is_jit_only(self) -> None:
        capabilities = capabilities_for(IdentitySourceKind.OIDC)
        assert capabilities.supports_jit_login
        assert capabilities.supports_login
        assert not capabilities.supports_pull_users

    def test_ldap_is_enumerable(self) -> None:
        assert capabilities_for(IdentitySourceKind.LDAP).supports_pull_users

    def test_only_local_has_a_provider(self) -> None:
        assert has_provider(IdentitySourceKind.LOCAL)
        assert not has_provider(IdentitySourceKind.LDAP)

    def test_parse_config_rejects_unknown_keys(self) -> None:
        with pytest.raises(ValidationError, match="unknown config keys"):
            parse_source_config(IdentitySourceKind.LOCAL, {"surprise": 1})

    def test_parse_config_accepts_empty(self) -> None:
        for kind in IdentitySourceKind:
            assert parse_source_config(kind, {}) is not None


class TestRecordMapping:
    def test_profile_fields_skip_absent(self) -> None:
        record = _record(job_title="VP", department=None)
        fields = reconcile.record_profile_fields(record)
        assert fields == {"job_title": "VP"}

    def test_display_name_fallbacks(self) -> None:
        assert reconcile.record_display_name(_record()) == "Jane Doe"
        assert (
            reconcile.record_display_name(
                _record(display_name=None, given_name="Jane", family_name="Doe")
            )
            == "Jane Doe"
        )
        assert reconcile.record_display_name(_record(display_name=None)) == "jane"


class TestUpsertUser:
    async def test_creates_passwordless_user(self) -> None:
        source = _source()
        report = ReconcileReport()
        session = _session([
            _result(scalar=None),  # no link
            _result(scalar=None),  # no email match
            _result(scalar=None),  # username free
            _result(),  # profile upsert
        ])
        org_ops = MagicMock()
        org_ops.get_membership = AsyncMock(return_value=None)
        org_ops.add_member = AsyncMock()
        with patch.object(reconcile, "OrganizationOperations", return_value=org_ops):
            user_id = await reconcile.upsert_user(session, source, _record(), report=report)

        assert user_id is not None
        assert report.users_created == 1
        created = [a.args[0] for a in session.add.call_args_list if isinstance(a.args[0], User)]
        assert len(created) == 1
        assert created[0].hashed_password is None
        assert created[0].email == "jane@example.com"
        org_ops.add_member.assert_awaited_once()

    async def test_linked_user_never_gets_global_writes(self) -> None:
        source = _source()
        report = ReconcileReport()
        user = User(email="old@example.com", username="jane", full_name="Jane Doe")
        link = MagicMock()
        link.subject_id = user.id
        membership = MagicMock()
        membership.is_active = True
        session = _session([_result(scalar=link), _result(scalar=user), _result()])
        org_ops = MagicMock()
        org_ops.get_membership = AsyncMock(return_value=membership)
        org_ops.add_member = AsyncMock()
        with patch.object(reconcile, "OrganizationOperations", return_value=org_ops):
            user_id = await reconcile.upsert_user(
                session, source, _record(email="new@example.com"), report=report
            )

        assert user_id == user.id
        assert user.email == "old@example.com"
        assert report.users_updated == 1
        assert report.skipped_global_changes == 1
        org_ops.add_member.assert_not_awaited()

    async def test_email_match_on_inactive_account_skips(self) -> None:
        source = _source()
        report = ReconcileReport()
        inactive = User(email="jane@example.com", username="jane", is_active=False)
        session = _session([_result(scalar=None), _result(scalar=inactive)])
        user_id = await reconcile.upsert_user(session, source, _record(), report=report)
        assert user_id is None
        assert report.users_skipped == 1

    async def test_record_without_email_cannot_create(self) -> None:
        source = _source()
        report = ReconcileReport()
        session = _session([_result(scalar=None)])
        user_id = await reconcile.upsert_user(session, source, _record(email=None), report=report)
        assert user_id is None
        assert report.users_skipped == 1

    async def test_inactive_unknown_record_skips(self) -> None:
        source = _source()
        report = ReconcileReport()
        session = _session([_result(scalar=None), _result(scalar=None)])
        user_id = await reconcile.upsert_user(session, source, _record(active=False), report=report)
        assert user_id is None
        assert report.users_skipped == 1


class TestUsernameDedupe:
    async def test_suffixes_on_collision(self) -> None:
        session = _session([_result(scalar=generate_id()), _result(scalar=None)])
        assert await reconcile._dedupe_username(session, "bob") == "bob2"


class TestDeprovision:
    async def test_refuses_last_owner(self) -> None:
        source = _source()
        user_id = generate_id()
        membership = MagicMock()
        membership.is_active = True
        membership.role = OrganizationRole.OWNER
        org_ops = MagicMock()
        org_ops.get_membership = AsyncMock(return_value=membership)
        session = _session([])
        with patch.object(reconcile, "OrganizationOperations", return_value=org_ops):
            done = await reconcile.deprovision_user(
                session, source, user_id, active_owner_ids={user_id}
            )
        assert done is False
        assert membership.is_active is True

    async def test_flips_membership_and_removes_search_document(self) -> None:
        source = _source()
        user_id = generate_id()
        membership = MagicMock()
        membership.is_active = True
        membership.role = OrganizationRole.MEMBER
        org_ops = MagicMock()
        org_ops.get_membership = AsyncMock(return_value=membership)
        session = _session([])
        indexer = MagicMock()
        indexer.remove_from_organization = AsyncMock()
        with (
            patch.object(reconcile, "OrganizationOperations", return_value=org_ops),
            patch.object(reconcile, "invalidate_person", AsyncMock()),
            patch.object(reconcile, "UserSearchIndexer", return_value=indexer),
            patch.object(reconcile, "publish_mention_state", AsyncMock()) as publish,
        ):
            done = await reconcile.deprovision_user(session, source, user_id, active_owner_ids=set())

        assert done is True
        assert membership.is_active is False
        indexer.remove_from_organization.assert_awaited_once_with(user_id, source.organization_id)
        publish.assert_awaited_once()
        assert publish.await_args.args[2] == {"urn_status": "DELETED"}

    async def test_ratio_abort_deactivates_nobody(self) -> None:
        source = _source()
        report = ReconcileReport()
        links = [(f"ext-{i}", generate_id()) for i in range(10)]
        session = _session([_result(rows=links), _result(scalar=20)])
        with patch.object(reconcile, "deprovision_user", AsyncMock()) as deprovision:
            await reconcile._deprovision_pass(session, source, set(), report)
        assert report.aborted is True
        assert report.users_deprovisioned == 0
        deprovision.assert_not_awaited()

    async def test_within_ratio_deprovisions_only_unseen(self) -> None:
        source = _source()
        report = ReconcileReport()
        keep_id, drop_id = generate_id(), generate_id()
        links = [("ext-keep", keep_id), ("ext-drop", drop_id)]
        session = _session([_result(rows=links), _result(scalar=20), _result(rows=[])])
        with patch.object(
            reconcile, "deprovision_user", AsyncMock(return_value=True)
        ) as deprovision:
            await reconcile._deprovision_pass(session, source, {"ext-keep"}, report)
        assert report.aborted is False
        assert report.users_deprovisioned == 1
        assert deprovision.await_args.args[2] == drop_id


class TestRunFullSync:
    async def test_local_provider_runs_empty_and_succeeds(self) -> None:
        source = _source(IdentitySourceKind.LOCAL)
        provider = LocalDirectoryProvider(LocalSourceConfig(), None)
        session = _session([])
        with (
            patch.object(reconcile, "write_audit_event", AsyncMock()) as audit,
            patch.object(reconcile, "invalidate_org_people", AsyncMock()) as invalidate,
            patch.object(reconcile, "sync_people_search", AsyncMock()) as search,
        ):
            report = await reconcile.run_full_sync(session, source, provider)

        assert source.last_sync_status == "succeeded"
        assert source.last_sync_at is not None
        assert report.users_created == 0
        assert report.aborted is False
        audit.assert_awaited_once()
        assert audit.await_args.kwargs["details"] == report.as_dict()
        invalidate.assert_awaited_once_with(source.organization_id)
        search.assert_not_awaited()
