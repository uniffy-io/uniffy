"""Tests for ContentMembersOperations validation logic.

Two layers are tested here:

1. Synchronous validation (_validate_access_mode) -- no DB, no patching.
2. Early-rejection paths in add_member / update_member_role /
   set_access_mode / transfer_ownership -- DB calls are stubbed so we
   only exercise the validation branches.
"""

from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from uniffy.core.errors import ValidationError
from uniffy.core.models.login.organization_member import OrganizationRole
from uniffy.core.types import AccessMode, ContentRole, ContentType, SubjectType, generate_id
from uniffy.domains.permissions.members import ContentMembersOperations


def _make_ops() -> ContentMembersOperations:
    session = MagicMock()
    session.execute = AsyncMock()
    session.add = MagicMock()
    session.delete = AsyncMock()
    session.commit = AsyncMock()
    session.flush = AsyncMock()
    session.refresh = AsyncMock()
    return ContentMembersOperations(session, MagicMock())


def _fake_content(
    owner_id=None,
    access_mode=AccessMode.EXPLICIT_MEMBERS,
    baseline_role=None,
):
    content = MagicMock()
    content.id = generate_id()
    content.owner_id = owner_id or generate_id()
    content.access_mode = access_mode
    content.baseline_role = baseline_role
    return content


class TestValidateAccessMode:
    """_validate_access_mode is synchronous and has no DB dependency."""

    def test_open_to_org_accepts_null_baseline_role(self) -> None:
        """Null baseline on OPEN_TO_ORG inherits the org default at read time;
        the validator must accept the storage shape."""
        ops = _make_ops()
        ops._validate_access_mode(AccessMode.OPEN_TO_ORG, None)

    def test_baseline_without_access_mode_rejected(self) -> None:
        ops = _make_ops()
        with pytest.raises(ValidationError, match="baseline_role"):
            ops._validate_access_mode(None, ContentRole.VIEWER)

    def test_null_access_mode_and_null_baseline_valid(self) -> None:
        """`(None, None)` is the inherit-from-org-defaults shape."""
        ops = _make_ops()
        ops._validate_access_mode(None, None)

    def test_open_to_org_rejects_owner_baseline(self) -> None:
        ops = _make_ops()
        with pytest.raises(ValidationError, match="OWNER"):
            ops._validate_access_mode(AccessMode.OPEN_TO_ORG, ContentRole.OWNER)

    def test_open_to_org_rejects_blocked_baseline(self) -> None:
        ops = _make_ops()
        with pytest.raises(ValidationError, match="BLOCKED"):
            ops._validate_access_mode(AccessMode.OPEN_TO_ORG, ContentRole.BLOCKED)

    @pytest.mark.parametrize(
        "valid_baseline",
        [
            ContentRole.VIEWER,
            ContentRole.COMMENTER,
            ContentRole.EDITOR,
            ContentRole.ADMIN,
        ],
    )
    def test_open_to_org_accepts_valid_baselines(self, valid_baseline: ContentRole) -> None:
        ops = _make_ops()
        ops._validate_access_mode(AccessMode.OPEN_TO_ORG, valid_baseline)

    def test_non_open_to_org_rejects_baseline_role(self) -> None:
        ops = _make_ops()
        with pytest.raises(ValidationError, match="baseline_role"):
            ops._validate_access_mode(AccessMode.EXPLICIT_MEMBERS, ContentRole.VIEWER)

    def test_owner_only_with_no_baseline_valid(self) -> None:
        ops = _make_ops()
        ops._validate_access_mode(AccessMode.OWNER_ONLY, None)

    def test_explicit_members_with_no_baseline_valid(self) -> None:
        ops = _make_ops()
        ops._validate_access_mode(AccessMode.EXPLICIT_MEMBERS, None)


class TestAddMemberRejections:
    """add_member rejects invalid role / access_mode combinations before touching the DB."""

    def _patch_prereqs(self, ops, content, actor_role=ContentRole.ADMIN):
        """Patch _load_content and _require_manage to bypass auth checks."""
        return (
            patch.object(ops, "_load_content", AsyncMock(return_value=content)),
            patch.object(
                ops,
                "_require_manage",
                AsyncMock(return_value=(actor_role, OrganizationRole.MEMBER)),
            ),
        )

    async def test_rejects_owner_role(self) -> None:
        ops = _make_ops()
        content = _fake_content()
        p1, p2 = self._patch_prereqs(ops, content)
        with p1, p2, pytest.raises(ValidationError, match="transfer_ownership"):
            await ops.add_member(
                actor_user_id=generate_id(),
                organization_id=generate_id(),
                content_type=ContentType.NOTE,
                content_id=content.id,
                subject_type=SubjectType.USER,
                subject_id=generate_id(),
                role=ContentRole.OWNER,
            )

    async def test_rejects_when_owner_only_mode(self) -> None:
        ops = _make_ops()
        content = _fake_content(access_mode=AccessMode.OWNER_ONLY)
        p1, p2 = self._patch_prereqs(ops, content)
        with p1, p2, pytest.raises(ValidationError, match="OWNER_ONLY"):
            await ops.add_member(
                actor_user_id=generate_id(),
                organization_id=generate_id(),
                content_type=ContentType.NOTE,
                content_id=content.id,
                subject_type=SubjectType.USER,
                subject_id=generate_id(),
                role=ContentRole.EDITOR,
            )

    async def test_rejects_adding_owner_as_member(self) -> None:
        owner_id = generate_id()
        ops = _make_ops()
        content = _fake_content(owner_id=owner_id)
        p1, p2 = self._patch_prereqs(ops, content)
        with p1, p2, pytest.raises(ValidationError, match="Owner cannot be added"):
            await ops.add_member(
                actor_user_id=generate_id(),
                organization_id=generate_id(),
                content_type=ContentType.NOTE,
                content_id=content.id,
                subject_type=SubjectType.USER,
                subject_id=owner_id,
                role=ContentRole.EDITOR,
            )


class TestUpdateMemberRoleRejections:
    def _patch_prereqs(self, ops, content):
        return (
            patch.object(ops, "_load_content", AsyncMock(return_value=content)),
            patch.object(
                ops,
                "_require_manage",
                AsyncMock(return_value=(ContentRole.ADMIN, OrganizationRole.MEMBER)),
            ),
        )

    async def test_rejects_new_role_owner(self) -> None:
        ops = _make_ops()
        content = _fake_content()
        p1, p2 = self._patch_prereqs(ops, content)
        with p1, p2, pytest.raises(ValidationError, match="transfer_ownership"):
            await ops.update_member_role(
                actor_user_id=generate_id(),
                organization_id=generate_id(),
                content_type=ContentType.NOTE,
                content_id=content.id,
                subject_type=SubjectType.USER,
                subject_id=generate_id(),
                new_role=ContentRole.OWNER,
            )


class TestSetAccessModeRejections:
    def _patch_prereqs(self, ops, content):
        return (
            patch.object(ops, "_load_content", AsyncMock(return_value=content)),
            patch.object(
                ops,
                "_require_manage",
                AsyncMock(return_value=(ContentRole.ADMIN, OrganizationRole.MEMBER)),
            ),
        )

    async def test_rejects_baseline_without_access_mode(self) -> None:
        """`(access_mode=None, baseline_role=X)` is an undefined storage shape
        and must be rejected before any DB work."""
        ops = _make_ops()
        content = _fake_content()
        p1, p2 = self._patch_prereqs(ops, content)
        with p1, p2, pytest.raises(ValidationError, match="baseline_role"):
            await ops.set_access_mode(
                actor_user_id=generate_id(),
                organization_id=generate_id(),
                content_type=ContentType.NOTE,
                content_id=content.id,
                new_access_mode=None,
                new_baseline_role=ContentRole.VIEWER,
            )

    async def test_rejects_owner_only_when_members_exist_without_flag(self) -> None:
        ops = _make_ops()
        content = _fake_content()

        existing_member = MagicMock()
        existing_member.subject_type = SubjectType.USER
        existing_member.subject_id = generate_id()
        existing_member.role = ContentRole.EDITOR

        member_query_result = MagicMock()
        member_query_result.scalars.return_value.all.return_value = [existing_member]
        ops.session.execute = AsyncMock(return_value=member_query_result)

        p1, p2 = self._patch_prereqs(ops, content)
        with p1, p2, pytest.raises(ValidationError, match="OWNER_ONLY"):
            await ops.set_access_mode(
                actor_user_id=generate_id(),
                organization_id=generate_id(),
                content_type=ContentType.NOTE,
                content_id=content.id,
                new_access_mode=AccessMode.OWNER_ONLY,
                new_baseline_role=None,
                remove_members_on_narrow=False,
            )

    async def test_rejects_open_to_org_for_calendar_event(self) -> None:
        """Events are invite-only: OPEN_TO_ORG would leak an event to the whole org."""
        ops = _make_ops()
        content = _fake_content()
        p1, p2 = self._patch_prereqs(ops, content)
        with p1, p2, pytest.raises(ValidationError, match="invite-only"):
            await ops.set_access_mode(
                actor_user_id=generate_id(),
                organization_id=generate_id(),
                content_type=ContentType.CALENDAR_EVENT,
                content_id=content.id,
                new_access_mode=AccessMode.OPEN_TO_ORG,
                new_baseline_role=ContentRole.VIEWER,
            )

    async def test_calendar_event_accepts_explicit_members(self) -> None:
        """Explicit member grants stay allowed on events; only OPEN_TO_ORG is refused."""
        ops = _make_ops()
        content = _fake_content()
        p1, p2 = self._patch_prereqs(ops, content)
        with (
            p1,
            p2,
            patch.object(ops, "_resolve_effective_mode", AsyncMock(side_effect=_Reached())),
            pytest.raises(_Reached),
        ):
            await ops.set_access_mode(
                actor_user_id=generate_id(),
                organization_id=generate_id(),
                content_type=ContentType.CALENDAR_EVENT,
                content_id=content.id,
                new_access_mode=AccessMode.EXPLICIT_MEMBERS,
            )

    async def test_calendar_event_accepts_owner_only(self) -> None:
        ops = _make_ops()
        content = _fake_content()

        member_query_result = MagicMock()
        member_query_result.scalars.return_value.all.return_value = []
        ops.session.execute = AsyncMock(return_value=member_query_result)

        p1, p2 = self._patch_prereqs(ops, content)
        with (
            p1,
            p2,
            patch.object(ops, "_resolve_effective_mode", AsyncMock(side_effect=_Reached())),
            pytest.raises(_Reached),
        ):
            await ops.set_access_mode(
                actor_user_id=generate_id(),
                organization_id=generate_id(),
                content_type=ContentType.CALENDAR_EVENT,
                content_id=content.id,
                new_access_mode=AccessMode.OWNER_ONLY,
            )

    async def test_accepts_owner_only_with_remove_members_flag(self) -> None:
        ops = _make_ops()
        content = _fake_content()
        content.access_mode = AccessMode.EXPLICIT_MEMBERS
        actor_user_id = generate_id()
        organization_id = generate_id()

        existing_member = MagicMock()
        existing_member.subject_type = SubjectType.USER
        existing_member.subject_id = generate_id()
        existing_member.role = ContentRole.EDITOR

        member_query_result = MagicMock()
        member_query_result.scalars.return_value.all.return_value = [existing_member]
        ops.session.execute = AsyncMock(return_value=member_query_result)

        search_sync_mock = AsyncMock()
        revoked_notification_mock = AsyncMock()
        access_change_mock = AsyncMock()

        p1, p2 = self._patch_prereqs(ops, content)
        with (
            p1,
            p2,
            patch.object(ops, "_sync_search_sharing", search_sync_mock),
            patch.object(ops, "_sync_search_access_policy", AsyncMock()),
            patch.object(ops, "_emit_revoked_notification", revoked_notification_mock),
            patch.object(ops, "_publish_access_change", access_change_mock),
        ):
            await ops.set_access_mode(
                actor_user_id=actor_user_id,
                organization_id=organization_id,
                content_type=ContentType.NOTE,
                content_id=content.id,
                new_access_mode=AccessMode.OWNER_ONLY,
                new_baseline_role=None,
                remove_members_on_narrow=True,
            )
        ops.session.delete.assert_called_once_with(existing_member)
        revoked_notification_mock.assert_awaited_once_with(
            organization_id=organization_id,
            actor_user_id=actor_user_id,
            content_type=ContentType.NOTE,
            content_id=content.id,
            subject_type=SubjectType.USER,
            subject_id=existing_member.subject_id,
        )
        access_change_mock.assert_awaited_once_with(
            organization_id=organization_id,
            content_type=ContentType.NOTE,
            content_id=content.id,
            subject_type=SubjectType.USER,
            subject_id=existing_member.subject_id,
            action="revoked",
        )


class TestTransferOwnershipRejections:
    def _patch_prereqs(self, ops, content):
        return (
            patch.object(ops, "_load_content", AsyncMock(return_value=content)),
            patch.object(
                ops,
                "_require_transfer",
                AsyncMock(return_value=(ContentRole.OWNER, OrganizationRole.MEMBER)),
            ),
        )

    async def test_rejects_same_owner_transfer(self) -> None:
        owner_id = generate_id()
        ops = _make_ops()
        content = _fake_content(owner_id=owner_id)
        p1, p2 = self._patch_prereqs(ops, content)
        with p1, p2, pytest.raises(ValidationError, match="already the current owner"):
            await ops.transfer_ownership(
                actor_user_id=generate_id(),
                organization_id=generate_id(),
                content_type=ContentType.NOTE,
                content_id=content.id,
                new_owner_user_id=owner_id,
            )

    async def test_rejects_new_owner_not_in_org(self) -> None:
        ops = _make_ops()
        content = _fake_content()
        new_owner = generate_id()
        p1, p2 = self._patch_prereqs(ops, content)
        with (
            p1,
            p2,
            patch.object(ops, "_is_active_org_member", AsyncMock(return_value=False)),
            pytest.raises(ValidationError, match="not an active member"),
        ):
            await ops.transfer_ownership(
                actor_user_id=generate_id(),
                organization_id=generate_id(),
                content_type=ContentType.NOTE,
                content_id=content.id,
                new_owner_user_id=new_owner,
            )

    async def test_registered_hook_runs_before_the_transfer_commit(self) -> None:
        """Domain state tied to the owner must move in the same transaction."""
        from uniffy.domains.permissions import members as members_module

        ops = _make_ops()
        content = _fake_content()
        new_owner = generate_id()
        order: list[str] = []

        async def hook(session, org_id, content_id, new_owner_id):
            order.append("hook")

        async def commit():
            order.append("commit")

        ops.session.commit = AsyncMock(side_effect=commit)
        p1, p2 = self._patch_prereqs(ops, content)
        with (
            p1,
            p2,
            patch.object(ops, "_is_active_org_member", AsyncMock(return_value=True)),
            patch.object(ops, "_get_existing_member", AsyncMock(return_value=None)),
            patch.object(ops, "_sync_search_access_policy", AsyncMock()),
            patch.object(ops, "_sync_search_sharing", AsyncMock()),
            patch.object(ops, "_emit_granted_notification", AsyncMock()),
            patch.object(members_module, "find_ownership_transfer_hook", return_value=hook),
            patch.object(members_module, "record_ownership_transferred", AsyncMock()),
            patch.object(members_module, "record_member_added", AsyncMock()),
            patch.object(members_module, "publish_perm_change", AsyncMock()),
        ):
            await ops.transfer_ownership(
                actor_user_id=generate_id(),
                organization_id=generate_id(),
                content_type=ContentType.NOTE,
                content_id=content.id,
                new_owner_user_id=new_owner,
            )

        assert order[:2] == ["hook", "commit"]

    async def test_child_acl_refresh_is_recorded_before_commit_and_enqueued_after(self) -> None:
        from uniffy.domains.permissions import members as members_module

        ops = _make_ops()
        content = _fake_content()
        new_owner = generate_id()
        order: list[str] = []

        async def record(session, organization_id, content_id):
            order.append("record")

        async def enqueue(content_id):
            order.append("enqueue")

        async def commit():
            order.append("commit")

        ops.session.commit = AsyncMock(side_effect=commit)
        p1, p2 = self._patch_prereqs(ops, content)
        with (
            p1,
            p2,
            patch.object(ops, "_is_active_org_member", AsyncMock(return_value=True)),
            patch.object(ops, "_get_existing_member", AsyncMock(return_value=None)),
            patch.object(ops, "_sync_search_access_policy", AsyncMock()),
            patch.object(ops, "_sync_search_sharing", AsyncMock()),
            patch.object(ops, "_emit_granted_notification", AsyncMock()),
            patch.object(
                members_module,
                "find_child_acl_refresh_hook",
                return_value=(record, enqueue),
            ),
            patch.object(members_module, "record_ownership_transferred", AsyncMock()),
            patch.object(members_module, "record_member_added", AsyncMock()),
            patch.object(members_module, "publish_perm_change", AsyncMock()),
        ):
            await ops.transfer_ownership(
                actor_user_id=generate_id(),
                organization_id=generate_id(),
                content_type=ContentType.NOTE,
                content_id=content.id,
                new_owner_user_id=new_owner,
            )

        assert order == ["record", "commit", "enqueue"]


class _Reached(Exception):
    """Sentinel raised by the first collaborator after a passed gate."""


@contextmanager
def _authorization_context():
    yield


def _dispatch_session(*, org_role=None, admin_domains: frozenset = frozenset()):
    """Fake session answering the org-role and domain-admin lookups the
    registered manage overrides issue."""
    from uniffy.core.models.login.organization_member import OrganizationMember
    from uniffy.core.models.permissions.domain_admin import DomainAdmin
    from uniffy.core.types import DomainType

    def _queried_domain(stmt):
        for value in stmt.compile().params.values():
            if isinstance(value, DomainType):
                return value
        return None

    async def execute(stmt):
        result = MagicMock()
        entity = stmt.column_descriptions[0].get("entity")
        if entity is OrganizationMember:
            membership = SimpleNamespace(role=org_role) if org_role is not None else None
            result.scalar_one_or_none = MagicMock(return_value=membership)
        elif entity is DomainAdmin:
            domain = _queried_domain(stmt)
            hit = generate_id() if domain in admin_domains else None
            result.scalar_one_or_none = MagicMock(return_value=hit)
        else:
            result.scalar_one_or_none = MagicMock(return_value=None)
        return result

    session = MagicMock()
    session.execute = AsyncMock(side_effect=execute)
    session.add = MagicMock()
    session.delete = AsyncMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    return session


class TestManageOverrides:
    """Domain-level manage overrides grant MANAGE on specific content types
    without touching effective_role (no read/list/search widening)."""

    def _make_override_ops(
        self,
        *,
        org_role=None,
        admin_domains: frozenset = frozenset(),
        effective_role=ContentRole.VIEWER,
    ) -> ContentMembersOperations:
        # Importing the agents ops modules registers the AGENT loader and
        # its manage override.
        import uniffy.domains.agents.agents.operations  # noqa: F401

        session = _dispatch_session(org_role=org_role, admin_domains=admin_domains)
        ops = ContentMembersOperations(session, MagicMock())
        ops.permission_checker = MagicMock()
        ops.permission_checker.effective_role = AsyncMock(return_value=effective_role)
        return ops

    def _agent_content(self):
        return _fake_content(
            access_mode=AccessMode.OPEN_TO_ORG,
            baseline_role=ContentRole.VIEWER,
        )

    def test_overrides_registered_per_content_type(self) -> None:
        import uniffy.domains.agents.agents.operations  # noqa: F401
        import uniffy.domains.agents.cron.operations  # noqa: F401
        import uniffy.domains.agents.providers.operations  # noqa: F401
        from uniffy.core.content.registry import find_manage_override
        from uniffy.domains.agents.access import is_agents_builder

        assert find_manage_override(ContentType.AGENT) is is_agents_builder
        # Cron tasks stay ownership-bound: a run carries its owner's identity.
        assert find_manage_override(ContentType.AGENT_CRON_TASK) is None
        # Provider keys have no access policy at all; nothing to override.
        assert find_manage_override(ContentType.PROVIDER_KEY) is None

    async def test_agents_builder_cannot_manage_unowned_cron_task(self) -> None:
        import uniffy.domains.agents.cron.operations  # noqa: F401
        from uniffy.core.errors import PermissionDeniedError
        from uniffy.core.types import DomainType

        ops = self._make_override_ops(
            org_role=OrganizationRole.MEMBER,
            admin_domains=frozenset({DomainType.AGENTS}),
        )
        content = self._agent_content()
        with (
            patch.object(ops, "_load_content", AsyncMock(return_value=content)),
            _authorization_context(),
            pytest.raises(PermissionDeniedError),
        ):
            await ops.set_access_mode(
                actor_user_id=generate_id(),
                organization_id=generate_id(),
                content_type=ContentType.AGENT_CRON_TASK,
                content_id=content.id,
                new_access_mode=AccessMode.OPEN_TO_ORG,
            )

    async def test_org_admin_can_add_member_on_unowned_agent(self) -> None:
        ops = self._make_override_ops(org_role=OrganizationRole.ADMIN)
        content = self._agent_content()
        with (
            patch.object(ops, "_load_content", AsyncMock(return_value=content)),
            patch.object(ops, "_get_existing_member", AsyncMock(side_effect=_Reached())),
            _authorization_context(),
            pytest.raises(_Reached),
        ):
            await ops.add_member(
                actor_user_id=generate_id(),
                organization_id=generate_id(),
                content_type=ContentType.AGENT,
                content_id=content.id,
                subject_type=SubjectType.USER,
                subject_id=generate_id(),
                role=ContentRole.EDITOR,
            )

    async def test_agents_domain_admin_can_set_access_mode_on_agent(self) -> None:
        from uniffy.core.types import DomainType

        ops = self._make_override_ops(
            org_role=OrganizationRole.MEMBER,
            admin_domains=frozenset({DomainType.AGENTS}),
        )
        content = self._agent_content()
        with (
            patch.object(ops, "_load_content", AsyncMock(return_value=content)),
            patch.object(ops, "_resolve_effective_mode", AsyncMock(side_effect=_Reached())),
            _authorization_context(),
            pytest.raises(_Reached),
        ):
            await ops.set_access_mode(
                actor_user_id=generate_id(),
                organization_id=generate_id(),
                content_type=ContentType.AGENT,
                content_id=content.id,
                new_access_mode=AccessMode.EXPLICIT_MEMBERS,
            )

    async def test_plain_member_cannot_manage_agent(self) -> None:
        from uniffy.core.errors import PermissionDeniedError

        ops = self._make_override_ops(org_role=OrganizationRole.MEMBER)
        content = self._agent_content()
        with (
            patch.object(ops, "_load_content", AsyncMock(return_value=content)),
            _authorization_context(),
            pytest.raises(PermissionDeniedError),
        ):
            await ops.add_member(
                actor_user_id=generate_id(),
                organization_id=generate_id(),
                content_type=ContentType.AGENT,
                content_id=content.id,
                subject_type=SubjectType.USER,
                subject_id=generate_id(),
                role=ContentRole.EDITOR,
            )
        ops.session.add.assert_not_called()

    async def test_other_domain_admin_gets_no_manage_on_agent(self) -> None:
        from uniffy.core.errors import PermissionDeniedError
        from uniffy.core.types import DomainType

        ops = self._make_override_ops(
            org_role=OrganizationRole.MEMBER,
            admin_domains=frozenset({DomainType.FILES}),
        )
        content = self._agent_content()
        with (
            patch.object(ops, "_load_content", AsyncMock(return_value=content)),
            _authorization_context(),
            pytest.raises(PermissionDeniedError),
        ):
            await ops.add_member(
                actor_user_id=generate_id(),
                organization_id=generate_id(),
                content_type=ContentType.AGENT,
                content_id=content.id,
                subject_type=SubjectType.USER,
                subject_id=generate_id(),
                role=ContentRole.EDITOR,
            )

    async def test_override_does_not_grant_view(self) -> None:
        """The view path stays pure effective_role: an org admin with no access
        to the row cannot list its members."""
        from uniffy.core.errors import PermissionDeniedError

        ops = self._make_override_ops(org_role=OrganizationRole.ADMIN, effective_role=None)
        content = self._agent_content()
        with (
            patch.object(ops, "_load_content", AsyncMock(return_value=content)),
            _authorization_context(),
            pytest.raises(PermissionDeniedError),
        ):
            await ops.list_members(
                actor_user_id=generate_id(),
                organization_id=generate_id(),
                content_type=ContentType.AGENT,
                content_id=content.id,
            )

    async def test_override_does_not_grant_transfer(self) -> None:
        """MANAGE via override never becomes OWNER: transfer still requires the
        real effective_role to be OWNER."""
        from uniffy.core.errors import PermissionDeniedError

        ops = self._make_override_ops(
            org_role=OrganizationRole.ADMIN, effective_role=ContentRole.ADMIN
        )
        content = self._agent_content()
        with (
            patch.object(ops, "_load_content", AsyncMock(return_value=content)),
            _authorization_context(),
            pytest.raises(PermissionDeniedError),
        ):
            await ops.transfer_ownership(
                actor_user_id=generate_id(),
                organization_id=generate_id(),
                content_type=ContentType.AGENT,
                content_id=content.id,
                new_owner_user_id=generate_id(),
            )


class TestChildContent:
    """Child content resolves access through its parent and has no members of its own."""

    async def test_member_ops_reject_content_without_a_policy(self) -> None:
        ops = _make_ops()
        task = SimpleNamespace(id=generate_id(), owner_id=generate_id())
        loader = AsyncMock(return_value=task)
        with (
            patch("uniffy.domains.permissions.members.get_content_loader", return_value=loader),
            pytest.raises(ValidationError, match="follows its parent"),
        ):
            await ops.list_members(generate_id(), generate_id(), ContentType.TASK, generate_id())
        ops.session.execute.assert_not_called()
