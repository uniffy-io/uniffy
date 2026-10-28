from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from uniffy.core.audit.actions import Action
from uniffy.core.errors import PermissionDeniedError
from uniffy.core.types import AccessMode, ContentRole
from uniffy.domains.projects.time.internal import (
    INTERNAL_PROJECT_SLUG,
    INTERNAL_TASK_TITLES,
    InternalProjectOperations,
)
from uniffy.domains.projects.time.policy import ResolvedTimePolicy

MODULE = "uniffy.domains.projects.time.internal"
ORG = uuid4()
ADMIN = uuid4()
EXISTING = uuid4()
TASK_COUNT = 6


class _Session:
    def __init__(self, live_project) -> None:  # noqa: ANN001
        self.live_project = live_project
        self.events: list[str] = []

    async def execute(self, stmt):  # noqa: ANN001
        sql = str(stmt.compile(compile_kwargs={"literal_binds": True})).lower()
        assert "projects_projects.is_deleted = false" in sql
        result = MagicMock()
        result.scalar_one_or_none.return_value = self.live_project
        return result

    async def commit(self) -> None:
        self.events.append("commit")


def _env(policy: ResolvedTimePolicy, live_project=None, *, admin: bool = True):  # noqa: ANN001
    stack = ExitStack()
    session = _Session(live_project)
    access = MagicMock()
    access.require_timekeeping_admin = AsyncMock(
        side_effect=None if admin else PermissionDeniedError("manage time tracking")
    )
    created = SimpleNamespace(id=uuid4(), slug="INT2", name="Internal")
    project_ops = MagicMock()
    project_ops.create = AsyncMock(return_value=created)
    task_ops = MagicMock()
    task_ops.create = AsyncMock()
    save = AsyncMock()
    audit = AsyncMock()
    stack.enter_context(patch(f"{MODULE}.TimeAccess", return_value=access))
    stack.enter_context(patch(f"{MODULE}.load_time_policy", new=AsyncMock(return_value=policy)))
    stack.enter_context(patch(f"{MODULE}.ProjectOperations", return_value=project_ops))
    stack.enter_context(patch(f"{MODULE}.TaskOperations", return_value=task_ops))
    stack.enter_context(patch(f"{MODULE}.save_time_policy", new=save))
    stack.enter_context(patch(f"{MODULE}.write_audit_event", new=audit))
    ops = InternalProjectOperations(session, MagicMock(), MagicMock(), MagicMock())  # type: ignore[arg-type]
    return (
        stack,
        ops,
        SimpleNamespace(
            session=session,
            created=created,
            project_ops=project_ops,
            task_ops=task_ops,
            save=save,
            audit=audit,
        ),
    )


async def test_the_first_call_creates_the_project_its_tasks_and_records_it_in_the_policy() -> None:
    stack, ops, env = _env(ResolvedTimePolicy(organization_id=ORG))
    with stack:
        result = await ops.ensure(ADMIN, ORG)

    assert result.created is True
    assert result.project is env.created
    assert result.policy.internal_project_id == env.created.id
    args, kwargs = env.project_ops.create.await_args
    assert args == (ADMIN, ORG, "Internal")
    assert kwargs["access_mode"] is AccessMode.OPEN_TO_ORG
    assert kwargs["baseline_role"] is ContentRole.EDITOR
    assert kwargs["slug"] == INTERNAL_PROJECT_SLUG
    titles = [call.args[3] for call in env.task_ops.create.await_args_list]
    assert titles == list(INTERNAL_TASK_TITLES)
    assert len(titles) == TASK_COUNT
    assert env.save.await_args.kwargs["policy"].internal_project_id == env.created.id
    assert env.save.await_args.kwargs["updated_by_user_id"] == ADMIN
    assert env.audit.await_args.kwargs["action"] == Action.INTERNAL_TIME_PROJECT_CREATED
    assert env.audit.await_args.kwargs["resource_id"] == env.created.id
    assert env.session.events == ["commit"]


async def test_a_second_call_returns_the_live_project_without_creating() -> None:
    existing = SimpleNamespace(id=EXISTING, slug="INT")
    stack, ops, env = _env(
        ResolvedTimePolicy(organization_id=ORG, internal_project_id=EXISTING), live_project=existing
    )
    with stack:
        result = await ops.ensure(ADMIN, ORG)

    assert result.created is False
    assert result.project is existing
    env.project_ops.create.assert_not_awaited()
    env.task_ops.create.assert_not_awaited()
    env.save.assert_not_awaited()
    assert env.session.events == []


async def test_a_trashed_project_is_replaced() -> None:
    stack, ops, env = _env(
        ResolvedTimePolicy(organization_id=ORG, internal_project_id=EXISTING), live_project=None
    )
    with stack:
        result = await ops.ensure(ADMIN, ORG)

    assert result.created is True
    assert result.policy.internal_project_id == env.created.id
    env.project_ops.create.assert_awaited_once()


async def test_only_timekeeping_admins_may_create_it() -> None:
    stack, ops, env = _env(ResolvedTimePolicy(organization_id=ORG), admin=False)
    with stack, pytest.raises(PermissionDeniedError):
        await ops.ensure(uuid4(), ORG)
    env.project_ops.create.assert_not_awaited()
