"""Permission gate tests for the agents domain.

Each gate has a denial
path and an allowed path. Allowed paths use a sentinel: the first collaborator
after the gate raises ``_Reached`` so we prove control passed the gate without
mocking the whole write tail.

The builder gate (``is_agents_builder``) is exercised for real: the Valkey
perm-cache wrapper is patched to a pass-through and a dispatching fake session
answers the org-role and domain-admin queries, so the org-admin / domain-admin
resolution logic itself is under test rather than a mocked verdict.
"""

from types import SimpleNamespace as NS
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from uniffy.core.errors import PermissionDeniedError
from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.permissions.domain_admin import DomainAdmin
from uniffy.core.types import AccessMode, DomainType, generate_id


class _Reached(Exception):
    """Sentinel raised by the first collaborator after a gate."""


def _result(value):
    res = MagicMock()
    res.scalar_one_or_none = MagicMock(return_value=value)
    return res


def _cache_passthrough():
    """Route the perm-cache wrappers straight to their loaders (no Valkey)."""

    async def _pass(key, loader, ttl=None, *, tags=None):
        return await loader()

    return patch(
        "uniffy.core.auth.cache.cache_get_or_set_locked",
        AsyncMock(side_effect=_pass),
    )


def _queried_domain(stmt):
    for value in stmt.compile().params.values():
        if isinstance(value, DomainType):
            return value
    return None


def _perm_session(
    *,
    org_role=None,
    admin_domains: frozenset = frozenset(),
    rows: dict | None = None,
    agent_deleted: bool = False,
):
    """Fake session answering org-role and domain-admin lookups.

    ``rows`` maps additional mapped classes to the row a full-entity
    select of that class should return. ``agent_deleted`` answers the
    agent-liveness probes that guard acting paths.
    """

    async def execute(stmt):
        # Retire fan-outs issue bulk UPDATE / DELETE, which carry no
        # column_descriptions; nothing reads their result.
        if not hasattr(stmt, "column_descriptions"):
            return _result(None)
        entity = stmt.column_descriptions[0].get("entity")
        if entity is OrganizationMember:
            return _result(org_role)
        if entity is DomainAdmin:
            domain = _queried_domain(stmt)
            return _result(generate_id() if domain in admin_domains else None)
        if rows is not None and entity in rows:
            return _result(rows[entity])
        if entity is Agent:
            return _result(agent_deleted)
        return _result(None)

    session = MagicMock()
    session.execute = AsyncMock(side_effect=execute)
    session.add = MagicMock()
    session.delete = AsyncMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    session.flush = AsyncMock()
    return session


def _org_ops(*, member_raises=False, admin_raises=False):
    ops = MagicMock()
    ops.require_org_member = AsyncMock(
        side_effect=PermissionDeniedError("member") if member_raises else None,
        return_value=NS(role="MEMBER"),
    )
    ops.require_org_admin = AsyncMock(
        side_effect=PermissionDeniedError("admin") if admin_raises else None,
        return_value=NS(role="ADMIN"),
    )
    return ops


_BUILDER_MATRIX = [
    pytest.param(OrganizationRole.MEMBER, frozenset(), False, id="member"),
    pytest.param(OrganizationRole.ADMIN, frozenset(), True, id="org-admin"),
    pytest.param(OrganizationRole.OWNER, frozenset(), True, id="org-owner"),
    pytest.param(
        OrganizationRole.MEMBER,
        frozenset({DomainType.AGENTS}),
        True,
        id="agents-domain-admin",
    ),
    pytest.param(
        OrganizationRole.MEMBER,
        frozenset({DomainType.FILES}),
        False,
        id="files-domain-admin",
    ),
]


class TestIsAgentsBuilder:
    @pytest.mark.parametrize(("org_role", "admin_domains", "allowed"), _BUILDER_MATRIX)
    async def test_builder_resolution(self, org_role, admin_domains, allowed) -> None:
        from uniffy.domains.agents.access import is_agents_builder

        session = _perm_session(org_role=org_role, admin_domains=admin_domains)
        with _cache_passthrough():
            result = await is_agents_builder(session, generate_id(), generate_id())
        assert result is allowed

    async def test_require_raises_for_non_builder(self) -> None:
        from uniffy.domains.agents.access import require_agents_builder

        session = _perm_session(org_role=OrganizationRole.MEMBER)
        with _cache_passthrough(), pytest.raises(PermissionDeniedError):
            await require_agents_builder(session, generate_id(), generate_id())


class TestCreateAgentBuilderGate:
    def _ops(self, session):
        from uniffy.domains.agents.agents.operations import AgentOperations

        ops = AgentOperations.__new__(AgentOperations)
        ops.session = session
        return ops

    @pytest.mark.parametrize(("org_role", "admin_domains", "allowed"), _BUILDER_MATRIX)
    async def test_create_matrix(self, org_role, admin_domains, allowed) -> None:
        session = _perm_session(org_role=org_role, admin_domains=admin_domains)
        ops = self._ops(session)
        call = ops.create_agent(
            user_id=generate_id(),
            organization_id=generate_id(),
            name="Helper",
        )
        with (
            _cache_passthrough(),
            patch.object(
                ops, "_resolve_access_policy", AsyncMock(side_effect=_Reached())
            ),
            pytest.raises(_Reached if allowed else PermissionDeniedError),
        ):
            await call
        if not allowed:
            session.add.assert_not_called()


class TestUpdateAgentBuilderGate:
    """Builders manage every agent, including agents another user created."""

    def _ops(self, session, agent):
        from uniffy.domains.agents.agents.operations import AgentOperations

        ops = AgentOperations.__new__(AgentOperations)
        ops.session = session
        ops._fetch_by_id = AsyncMock(return_value=agent)
        return ops

    def _agent(self):
        return NS(
            id=generate_id(),
            owner_id=generate_id(),
            name="Someone else's agent",
            is_default=False,
            enabled_skills=[],
            model_params={},
            primary_model="claude-sonnet-4-6",
            updated_at=None,
        )

    @pytest.mark.parametrize(("org_role", "admin_domains", "allowed"), _BUILDER_MATRIX)
    async def test_update_matrix(self, org_role, admin_domains, allowed) -> None:
        session = _perm_session(org_role=org_role, admin_domains=admin_domains)
        agent = self._agent()
        ops = self._ops(session, agent)
        session.commit = AsyncMock(side_effect=_Reached())
        with (
            _cache_passthrough(),
            pytest.raises(_Reached if allowed else PermissionDeniedError),
        ):
            await ops.update_agent(
                user_id=generate_id(),
                organization_id=generate_id(),
                agent_id=agent.id,
                name="Renamed",
            )
        if not allowed:
            session.commit.assert_not_awaited()

    @pytest.mark.parametrize(("org_role", "admin_domains", "allowed"), _BUILDER_MATRIX)
    async def test_delete_matrix(self, org_role, admin_domains, allowed) -> None:
        session = _perm_session(org_role=org_role, admin_domains=admin_domains)
        agent = self._agent()
        agent.is_deleted = False
        ops = self._ops(session, agent)
        session.commit = AsyncMock(side_effect=_Reached())
        with (
            _cache_passthrough(),
            pytest.raises(_Reached if allowed else PermissionDeniedError),
        ):
            await ops.delete_agent(
                user_id=generate_id(),
                organization_id=generate_id(),
                agent_id=agent.id,
            )
        if not allowed:
            assert agent.is_deleted is False


class TestDefaultAgentAdminGate:
    """``is_default`` stays org-admin only, even for domain-admin builders."""

    def _ops(self):
        from uniffy.domains.agents.agents.operations import AgentOperations

        ops = AgentOperations.__new__(AgentOperations)
        ops.session = MagicMock()
        ops.session.add = MagicMock()
        ops.session.commit = AsyncMock()
        ops.session.refresh = AsyncMock()
        return ops

    async def test_builder_create_default_denied(self) -> None:
        ops = self._ops()
        org = _org_ops(admin_raises=True)
        with (
            patch(
                "uniffy.domains.agents.agents.operations.require_agents_builder",
                AsyncMock(),
            ),
            patch(
                "uniffy.domains.agents.agents.operations.OrganizationOperations",
                return_value=org,
            ),
            pytest.raises(PermissionDeniedError),
        ):
            await ops.create_agent(
                user_id=generate_id(),
                organization_id=generate_id(),
                name="Helper",
                is_default=True,
            )
        ops.session.add.assert_not_called()

    async def test_builder_flip_default_denied(self) -> None:
        agent = NS(id=generate_id(), is_default=False)
        ops = self._ops()
        ops._fetch_by_id = AsyncMock(return_value=agent)
        org = _org_ops(admin_raises=True)
        with (
            patch(
                "uniffy.domains.agents.agents.operations.require_agents_builder",
                AsyncMock(),
            ),
            patch(
                "uniffy.domains.agents.agents.operations.OrganizationOperations",
                return_value=org,
            ),
            pytest.raises(PermissionDeniedError),
        ):
            await ops.update_agent(
                user_id=generate_id(),
                organization_id=generate_id(),
                agent_id=agent.id,
                is_default=True,
            )

    async def test_admin_flip_default_allowed(self) -> None:
        agent = NS(id=generate_id(), is_default=False)
        ops = self._ops()
        ops._fetch_by_id = AsyncMock(return_value=agent)
        ops._clear_existing_default = AsyncMock(side_effect=_Reached())
        org = _org_ops()
        with (
            patch(
                "uniffy.domains.agents.agents.operations.require_agents_builder",
                AsyncMock(),
            ),
            patch(
                "uniffy.domains.agents.agents.operations.OrganizationOperations",
                return_value=org,
            ),
            pytest.raises(_Reached),
        ):
            await ops.update_agent(
                user_id=generate_id(),
                organization_id=generate_id(),
                agent_id=agent.id,
                is_default=True,
            )
        org.require_org_admin.assert_awaited_once()


class TestCreateSessionAgentGate:
    def _ops(self):
        from uniffy.domains.agents.sessions.operations import SessionOperations

        ops = SessionOperations.__new__(SessionOperations)
        ops._session = MagicMock()
        ops._session.add = MagicMock()
        ops._session.commit = AsyncMock()
        ops._session.refresh = AsyncMock()
        ops._org_ops = _org_ops()
        return ops

    async def test_no_agent_access_denied(self) -> None:
        ops = self._ops()
        agent_ops = MagicMock()
        agent_ops.get_by_id = AsyncMock(side_effect=PermissionDeniedError("view"))
        with patch(
            "uniffy.domains.agents.sessions.operations.AgentOperations",
            return_value=agent_ops,
        ), pytest.raises(PermissionDeniedError):
            await ops.create_session(
                user_id=generate_id(),
                organization_id=generate_id(),
                agent_id=generate_id(),
                kind="direct",
            )
        ops._session.add.assert_not_called()

    async def test_agent_access_allowed(self) -> None:
        ops = self._ops()
        agent_ops = MagicMock()
        agent_ops.get_by_id = AsyncMock(return_value=NS(id=generate_id()))
        with patch(
            "uniffy.domains.agents.sessions.operations.AgentOperations",
            return_value=agent_ops,
        ):
            result = await ops.create_session(
                user_id=generate_id(),
                organization_id=generate_id(),
                agent_id=generate_id(),
                kind="direct",
            )
        agent_ops.get_by_id.assert_awaited_once()
        ops._session.add.assert_called_once()
        assert result is not None


class TestSkillBuilderGate:
    def _ops(self, session):
        from uniffy.domains.agents.skills.operations import SkillOperations

        ops = SkillOperations.__new__(SkillOperations)
        ops._session = session
        ops._org_ops = _org_ops()
        return ops

    async def test_member_denied_create_skill(self) -> None:
        session = _perm_session(org_role=OrganizationRole.MEMBER)
        ops = self._ops(session)
        with _cache_passthrough(), pytest.raises(PermissionDeniedError):
            await ops.create_skill(
                user_id=generate_id(),
                organization_id=generate_id(),
                name="mine",
                display_name="Mine",
            )
        session.add.assert_not_called()

    async def test_domain_admin_builder_creates_org_skill(self) -> None:
        from uniffy.core.models.agents.skill import AgentSkill

        session = _perm_session(
            org_role=OrganizationRole.MEMBER,
            admin_domains=frozenset({DomainType.AGENTS}),
            rows={AgentSkill: None},
        )
        ops = self._ops(session)
        ops._snapshot_version = AsyncMock()
        with (
            _cache_passthrough(),
            patch(
                "uniffy.domains.agents.skills.operations.write_audit_event",
                AsyncMock(),
            ),
        ):
            skill = await ops.create_skill(
                user_id=generate_id(),
                organization_id=generate_id(),
                name="deploy-guide",
                display_name="Deploy Guide",
                content="How to deploy",
            )
        assert skill.source == "organization"
        session.add.assert_called()

    async def test_created_skill_source_is_always_organization(self) -> None:
        from uniffy.core.models.agents.skill import AgentSkill

        session = _perm_session(
            org_role=OrganizationRole.ADMIN,
            rows={AgentSkill: None},
        )
        ops = self._ops(session)
        ops._snapshot_version = AsyncMock()
        with (
            _cache_passthrough(),
            patch(
                "uniffy.domains.agents.skills.operations.write_audit_event",
                AsyncMock(),
            ),
        ):
            await ops.create_skill(
                user_id=generate_id(),
                organization_id=generate_id(),
                name="notes-style",
                display_name="Notes Style",
            )
        created = session.add.call_args[0][0]
        assert created.source == "organization"

    async def test_member_denied_update_skill(self) -> None:
        from uniffy.core.models.agents.skill import AgentSkill

        skill = NS(id=generate_id(), source="organization", always_active=False)
        session = _perm_session(
            org_role=OrganizationRole.MEMBER,
            rows={AgentSkill: skill},
        )
        ops = self._ops(session)
        with _cache_passthrough(), pytest.raises(PermissionDeniedError):
            await ops.update_skill(
                user_id=generate_id(),
                organization_id=generate_id(),
                skill_id=skill.id,
                display_name="x",
            )

    async def test_builder_update_skill_allowed(self) -> None:
        from uniffy.core.models.agents.skill import AgentSkill

        skill = NS(id=generate_id(), source="organization", always_active=False)
        session = _perm_session(
            org_role=OrganizationRole.MEMBER,
            admin_domains=frozenset({DomainType.AGENTS}),
            rows={AgentSkill: skill},
        )
        ops = self._ops(session)
        with (
            _cache_passthrough(),
            patch(
                "uniffy.domains.agents.skills.operations.clean_skill_update",
                side_effect=_Reached(),
            ),
            pytest.raises(_Reached),
        ):
            await ops.update_skill(
                user_id=generate_id(),
                organization_id=generate_id(),
                skill_id=skill.id,
                display_name="x",
            )

    async def test_member_denied_delete_skill(self) -> None:
        from uniffy.core.models.agents.skill import AgentSkill

        skill = NS(id=generate_id(), source="organization", always_active=False)
        session = _perm_session(
            org_role=OrganizationRole.MEMBER,
            rows={AgentSkill: skill},
        )
        ops = self._ops(session)
        with _cache_passthrough(), pytest.raises(PermissionDeniedError):
            await ops.delete_skill(
                user_id=generate_id(),
                organization_id=generate_id(),
                skill_id=skill.id,
            )
        session.delete.assert_not_awaited()


class TestProviderKeyAdminGate:
    """Provider keys are org-admin managed; creators get no special power."""

    def _ops(self, *, admin_raises=False):
        from uniffy.domains.agents.providers.operations import ProviderOperations

        ops = ProviderOperations.__new__(ProviderOperations)
        ops._session = MagicMock()
        ops._session.add = MagicMock()
        ops._session.delete = AsyncMock()
        ops._session.commit = AsyncMock()
        ops._session.execute = AsyncMock()
        ops._org_ops = _org_ops(admin_raises=admin_raises)
        return ops

    def _add_key(self, ops, user_id=None):
        return ops.add_key(
            user_id=user_id or generate_id(),
            organization_id=generate_id(),
            provider="anthropic",
            label="k",
            credential="sk-x",
        )

    async def test_member_denied_add_key(self) -> None:
        ops = self._ops(admin_raises=True)
        with pytest.raises(PermissionDeniedError):
            await self._add_key(ops)
        ops._session.add.assert_not_called()

    async def test_admin_add_key_reaches_registry(self) -> None:
        ops = self._ops()
        with (
            patch(
                "uniffy.domains.agents.providers.operations.get_provider_registry",
                MagicMock(side_effect=_Reached()),
            ),
            pytest.raises(_Reached),
        ):
            await self._add_key(ops)
        ops._org_ops.require_org_admin.assert_awaited_once()

    async def test_member_can_list_keys_unfiltered(self) -> None:
        """Chat model pickers need the list, so it is member-readable and every
        org key is returned - keys carry no per-key access policy."""
        key = NS(id=generate_id(), provider="anthropic", label="k")
        ops = self._ops(admin_raises=True)
        scalars = MagicMock()
        scalars.all = MagicMock(return_value=[key])
        result = MagicMock()
        result.scalars = MagicMock(return_value=scalars)
        ops._session.execute = AsyncMock(return_value=result)

        keys = await ops.list_keys(user_id=generate_id(), organization_id=generate_id())

        assert keys == [key]
        ops._org_ops.require_org_member.assert_awaited_once()
        ops._org_ops.require_org_admin.assert_not_awaited()
        stmt = str(ops._session.execute.await_args.args[0])
        assert "permissions_content_members" not in stmt

    async def test_non_admin_creator_denied_remove_key(self) -> None:
        creator = generate_id()
        key = NS(id=generate_id(), created_by=creator, label="k", provider="anthropic")
        ops = self._ops(admin_raises=True)
        ops._session.execute = AsyncMock(return_value=_result(key))
        with pytest.raises(PermissionDeniedError):
            await ops.remove_key(
                user_id=creator,
                organization_id=generate_id(),
                key_id=key.id,
            )
        ops._session.delete.assert_not_awaited()

    async def test_non_admin_creator_denied_toggle_key(self) -> None:
        creator = generate_id()
        key = NS(id=generate_id(), created_by=creator, is_enabled=True)
        ops = self._ops(admin_raises=True)
        ops._session.execute = AsyncMock(return_value=_result(key))
        with pytest.raises(PermissionDeniedError):
            await ops.toggle_key(
                creator,
                generate_id(),
                key.id,
                False,
            )
        ops._session.commit.assert_not_awaited()
        assert key.is_enabled is True

    async def test_non_admin_denied_validate_key(self) -> None:
        ops = self._ops(admin_raises=True)
        with pytest.raises(PermissionDeniedError):
            await ops.validate_key(
                user_id=generate_id(),
                organization_id=generate_id(),
                key_id=generate_id(),
            )
        ops._session.execute.assert_not_awaited()


class TestCronTransferOwnership:
    def _ops(self, task):
        from uniffy.domains.agents.cron.operations import CronTaskOperations

        ops = CronTaskOperations.__new__(CronTaskOperations)
        ops.session = MagicMock()
        ops.session.execute = AsyncMock(return_value=_result(task))
        ops.session.commit = AsyncMock()
        ops.session.refresh = AsyncMock()
        ops._index_for_search = AsyncMock()
        return ops

    def _task(self, owner):
        return NS(
            id=generate_id(),
            organization_id=generate_id(),
            agent_id=generate_id(),
            owner_id=owner,
            execution_user_id=owner,
            is_deleted=False,
        )

    async def test_non_owner_actor_denied(self) -> None:
        old_owner = generate_id()
        task = self._task(old_owner)
        ops = self._ops(task)
        agent_ops = MagicMock()
        agent_ops.get_by_id = AsyncMock(return_value=NS(id=task.agent_id))
        members = MagicMock()
        members.transfer_ownership = AsyncMock(
            side_effect=PermissionDeniedError("transfer")
        )
        with (
            patch(
                "uniffy.domains.agents.cron.operations.AgentOperations",
                return_value=agent_ops,
            ),
            patch(
                "uniffy.domains.agents.cron.operations.ContentMembersOperations",
                return_value=members,
            ), pytest.raises(PermissionDeniedError)
        ):
            await ops.transfer_ownership(
                actor_user_id=generate_id(),  # an admin who is not the owner
                organization_id=task.organization_id,
                task_id=task.id,
                new_owner_id=generate_id(),
            )
        # Execution identity must not move on a denied transfer.
        assert task.execution_user_id == old_owner

    async def test_owner_transfer_moves_execution_identity(self) -> None:
        # The generic content transfer runs the registered ownership hook
        # inside its transaction; simulate that wiring on the mock.
        from uniffy.core.content.members import _ownership_transfer_hooks
        from uniffy.core.types import ContentType

        old_owner = generate_id()
        new_owner = generate_id()
        task = self._task(old_owner)
        ops = self._ops(task)
        agent_ops = MagicMock()
        agent_ops.get_by_id = AsyncMock(return_value=NS(id=task.agent_id))
        hook = _ownership_transfer_hooks[ContentType.AGENT_CRON_TASK]

        async def run_hook(**kwargs):
            await hook(
                ops.session, task.organization_id, kwargs["content_id"], new_owner
            )

        members = MagicMock()
        members.transfer_ownership = AsyncMock(side_effect=run_hook)
        with (
            patch(
                "uniffy.domains.agents.cron.operations.AgentOperations",
                return_value=agent_ops,
            ),
            patch(
                "uniffy.domains.agents.cron.operations.ContentMembersOperations",
                return_value=members,
            ),
        ):
            await ops.transfer_ownership(
                actor_user_id=old_owner,
                organization_id=task.organization_id,
                task_id=task.id,
                new_owner_id=new_owner,
            )
        members.transfer_ownership.assert_awaited_once()
        assert task.execution_user_id == new_owner

    def test_cron_hook_is_registered(self) -> None:
        import uniffy.domains.agents.cron.operations  # noqa: F401  (registers the hook)
        from uniffy.core.content.members import _ownership_transfer_hooks
        from uniffy.core.types import ContentType

        assert ContentType.AGENT_CRON_TASK in _ownership_transfer_hooks


class TestCronExecutionIdentity:
    """A run executes with ``execution_user_id``'s permissions, so authoring the
    prompt and triggering on demand both bind to that identity."""

    def _ops(self, session, task, role=None):
        from uniffy.core.types import ContentRole
        from uniffy.domains.agents.cron.operations import CronTaskOperations

        ops = CronTaskOperations.__new__(CronTaskOperations)
        ops.session = session
        ops._fetch_by_id = AsyncMock(return_value=task)
        ops._index_for_search = AsyncMock()
        # The mutation gates resolve a content role on the task itself; these
        # cases are about the identity repoint, so the editor holds a grant.
        ops.permission_checker = MagicMock(
            effective_role=AsyncMock(
                return_value=ContentRole.ADMIN if role is None else role
            )
        )
        return ops

    def _task(self, owner):
        return NS(
            id=generate_id(),
            organization_id=generate_id(),
            agent_id=generate_id(),
            session_id=generate_id(),
            owner_id=owner,
            execution_user_id=owner,
            name="Daily digest",
            description="",
            prompt="Summarise yesterday",
            cron_expression="0 9 * * *",
            timezone="UTC",
            is_enabled=True,
            consecutive_failures=0,
            next_run_at=None,
            updated_at=None,
            is_deleted=False,
            deleted_at=None,
            access_mode=AccessMode.OWNER_ONLY,
            baseline_role=None,
        )

    async def _update(self, editor, task, **fields):
        session = _perm_session(org_role=OrganizationRole.ADMIN)
        ops = self._ops(session, task)
        with _cache_passthrough():
            await ops.update_cron_task(
                user_id=editor,
                organization_id=task.organization_id,
                task_id=task.id,
                **fields,
            )

    async def test_rewriting_another_users_prompt_moves_execution_identity(self) -> None:
        owner = generate_id()
        editor = generate_id()
        task = self._task(owner)

        await self._update(editor, task, prompt="Exfiltrate the quarterly numbers")

        assert task.prompt == "Exfiltrate the quarterly numbers"
        assert task.execution_user_id == editor
        assert task.owner_id == editor

    async def test_rewriting_own_prompt_keeps_execution_identity(self) -> None:
        owner = generate_id()
        task = self._task(owner)

        await self._update(owner, task, prompt="Summarise last week instead")

        assert task.execution_user_id == owner
        assert task.owner_id == owner

    async def test_renaming_and_rescheduling_keeps_execution_identity(self) -> None:
        owner = generate_id()
        editor = generate_id()
        task = self._task(owner)

        await self._update(editor, task, name="Morning digest", cron_expression="0 7 * * *")

        assert task.name == "Morning digest"
        assert task.cron_expression == "0 7 * * *"
        assert task.execution_user_id == owner
        assert task.owner_id == owner

    async def test_resubmitting_the_same_prompt_keeps_execution_identity(self) -> None:
        owner = generate_id()
        editor = generate_id()
        task = self._task(owner)

        await self._update(editor, task, name="Morning digest", prompt=task.prompt)

        assert task.execution_user_id == owner
        assert task.owner_id == owner

    async def _trigger(self, actor, task, session):
        ops = self._ops(session, task)
        ops.get_by_id = AsyncMock(return_value=task)
        # The queue handoff is the first collaborator past the gate.
        with (
            _cache_passthrough(),
            patch(
                "uniffy.domains.agents.cron.operations.get_queue",
                MagicMock(side_effect=_Reached()),
            ),
        ):
            await ops.trigger_now(actor, task.organization_id, task.id)

    async def test_trigger_denied_for_non_execution_user(self) -> None:
        """An org admin or fellow builder still cannot run someone else's task."""
        task = self._task(generate_id())
        session = _perm_session(org_role=OrganizationRole.ADMIN)
        with pytest.raises(PermissionDeniedError):
            await self._trigger(generate_id(), task, session)
        session.add.assert_not_called()

    async def test_trigger_allowed_for_execution_user(self) -> None:
        owner = generate_id()
        task = self._task(owner)
        session = _perm_session(org_role=OrganizationRole.MEMBER)
        with pytest.raises(_Reached):
            await self._trigger(owner, task, session)
        session.add.assert_called_once()

    async def _update_with_role(self, editor, task, role, **fields):
        session = _perm_session(org_role=OrganizationRole.ADMIN)
        ops = self._ops(session, task, role=role)
        with _cache_passthrough():
            await ops.update_cron_task(
                user_id=editor,
                organization_id=task.organization_id,
                task_id=task.id,
                **fields,
            )

    async def test_update_denied_without_an_edit_role_on_the_task(self) -> None:
        """The builder gate is a domain power, not a content bypass: reading
        back an OWNER_ONLY prompt or retiming it needs a role on the task."""
        from uniffy.core.types import ContentRole

        task = self._task(generate_id())
        with pytest.raises(PermissionDeniedError):
            await self._update_with_role(
                generate_id(), task, ContentRole.VIEWER, cron_expression="0 3 * * *"
            )
        assert task.cron_expression == "0 9 * * *"

    async def test_enable_flip_denied_without_an_edit_role(self) -> None:
        """The identity repoint only fires on a prompt rewrite, so a schedule
        or enabled flip has to be gated by the role check itself."""
        from uniffy.core.types import ContentRole

        task = self._task(generate_id())
        task.is_enabled = False
        with pytest.raises(PermissionDeniedError):
            await self._update_with_role(generate_id(), task, ContentRole.VIEWER, is_enabled=True)
        assert task.is_enabled is False

    async def _delete(self, actor, task, role):
        session = _perm_session(org_role=OrganizationRole.ADMIN)
        ops = self._ops(session, task, role=role)
        ops.search_indexer = MagicMock(remove=AsyncMock())
        with _cache_passthrough():
            await ops.delete_cron_task(
                user_id=actor,
                organization_id=task.organization_id,
                task_id=task.id,
            )

    async def test_delete_denied_below_admin_role(self) -> None:
        from uniffy.core.types import ContentRole

        task = self._task(generate_id())
        with pytest.raises(PermissionDeniedError):
            await self._delete(generate_id(), task, ContentRole.EDITOR)
        assert task.is_deleted is False

    async def test_delete_allowed_for_the_owner(self) -> None:
        from uniffy.core.types import ContentRole

        owner = generate_id()
        task = self._task(owner)
        await self._delete(owner, task, ContentRole.OWNER)
        assert task.is_deleted is True
        assert task.is_enabled is False

    async def test_cron_delete_tool_targets_a_method_that_exists(self) -> None:
        """The tool used to call ``ops.delete``, which no class in the chain
        defines; a spec'd double turns that back into a failure."""
        from uniffy.domains.agents.cron.operations import CronTaskOperations
        from uniffy.domains.agents.tools.builtin.cron import _execute_cron_delete

        ops = MagicMock(spec=CronTaskOperations)
        ops.delete_cron_task = AsyncMock()
        ctx = NS(session=MagicMock(), user_id=generate_id(), organization_id=generate_id())
        with patch(
            "uniffy.domains.agents.cron.operations.CronTaskOperations",
            return_value=ops,
        ):
            result = await _execute_cron_delete(ctx, {"task_id": str(generate_id())})

        assert result.success
        ops.delete_cron_task.assert_awaited_once()

    def test_cron_task_has_no_manage_override(self) -> None:
        """Builders manage cron tasks through ``require_agents_builder``; a
        sharing-dialog override would also cover the ownership-bound surfaces."""
        import uniffy.domains.agents.agents.operations  # noqa: F401
        import uniffy.domains.agents.cron.operations  # noqa: F401
        from uniffy.core.content.members import _manage_overrides
        from uniffy.core.types import ContentType

        assert ContentType.AGENT_CRON_TASK not in _manage_overrides


class TestAgentToolAuthorization:
    """Advertisement is not authorization, and a tool's own reads stay inside
    ``effective_role``."""

    def test_allowed_set_is_derived_from_the_resolved_schemas(self) -> None:
        from uniffy.domains.agents.runtime.operations import _allowed_tool_names

        # Post-filter schemas carry API names; the executor compares internal ones.
        allowed = _allowed_tool_names(
            [{"name": "notes-read_note"}, {"name": "github-list_issues"}]
        )
        assert allowed == frozenset({"notes.read_note", "github.list_issues"})
        assert _allowed_tool_names(None) == frozenset()

    async def _capture_sql(self, run) -> str:
        captured: list = []

        async def execute(stmt):
            captured.append(stmt)
            return MagicMock(all=lambda: [])

        session = MagicMock(execute=AsyncMock(side_effect=execute))
        ctx = NS(session=session, user_id=generate_id(), organization_id=generate_id())
        await run(ctx)
        return str(captured[-1].compile())

    async def test_note_parent_titles_are_permission_filtered(self) -> None:
        from uniffy.domains.agents.tools.builtin.notes import _fetch_titles

        sql = await self._capture_sql(lambda ctx: _fetch_titles(ctx, {generate_id()}))
        assert "notes_notes.organization_id" in sql
        assert "permissions_content_members" in sql

    async def test_file_folder_names_are_permission_filtered(self) -> None:
        from uniffy.domains.agents.tools.builtin.files import _fetch_folder_names

        sql = await self._capture_sql(lambda ctx: _fetch_folder_names(ctx, {generate_id()}))
        assert "files_folders.organization_id" in sql
        assert "permissions_content_members" in sql


def test_access_mode_enum_present() -> None:
    # Guards against an accidental import break in the module under test.
    assert AccessMode.OWNER_ONLY is not None
