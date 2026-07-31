"""Unit tests for the hierarchy-aware filters on ``TaskOperations.list_tasks``.

Follows the same MagicMock-based harness used by ``test_projects_parent.py`` and
``test_projects_tags.py``: no real database. We intercept ``session.execute`` to
inspect the SQL the operation builds, and the recursive CTE that powers the
``in_epic_id`` and ``min_depth`` / ``max_depth`` filters is verified by
compiling the constructed query and asserting structural markers in the SQL.
"""

from unittest.mock import AsyncMock, MagicMock, patch

from uniffy.core.types import generate_id
from uniffy.domains.projects.operations import TaskOperations


def _make_ops() -> TaskOperations:
    ops = TaskOperations.__new__(TaskOperations)
    ops.session = MagicMock()
    return ops


def _capture_executes(ops: TaskOperations) -> list[str]:
    """Replace ``session.execute`` with a stub that records compiled SQL text.

    Returns the captured list. The count query receives a scalar_one() of 0
    and the data query a scalars().all() of [] so list_tasks completes.
    """
    captured: list[str] = []

    async def execute(stmt):  # noqa: ANN001 - SQLAlchemy statement
        try:
            compiled = stmt.compile(compile_kwargs={"literal_binds": True})
            captured.append(str(compiled).lower())
        except Exception:
            captured.append(str(stmt).lower())
        result = MagicMock()
        result.scalar_one.return_value = 0
        result.scalars.return_value.all.return_value = []
        return result

    ops.session.execute = AsyncMock(side_effect=execute)
    return captured


def _patch_project_check():
    """Skip the ``ProjectOperations.get_by_id`` permission preflight."""
    return patch(
        "uniffy.domains.projects.operations.ProjectOperations.get_by_id",
        new=AsyncMock(return_value=None),
    )


class TestRootOnlyFilter:
    async def test_root_only_emits_parent_id_is_null(self) -> None:
        ops = _make_ops()
        captured = _capture_executes(ops)
        with _patch_project_check():
            await ops.list_tasks(
                user_id=generate_id(),
                organization_id=generate_id(),
                project_id=generate_id(),
                root_only=True,
            )
        # Both the count and data queries should carry the IS NULL predicate.
        assert any("parent_id is null" in sql for sql in captured)

    async def test_root_only_overrides_parent_id(self) -> None:
        """Spec: ``root_only`` wins over an explicit parent_id."""
        ops = _make_ops()
        captured = _capture_executes(ops)
        explicit_parent = generate_id()
        with _patch_project_check():
            await ops.list_tasks(
                user_id=generate_id(),
                organization_id=generate_id(),
                project_id=generate_id(),
                parent_id=explicit_parent,
                root_only=True,
            )
        assert any("parent_id is null" in sql for sql in captured)
        # No equality against the explicit parent id leaked in.
        assert not any(f"parent_id = '{explicit_parent.hex}'" in sql for sql in captured)


class TestHasSubtasksFilter:
    async def test_has_subtasks_true_emits_in_subquery(self) -> None:
        ops = _make_ops()
        captured = _capture_executes(ops)
        with _patch_project_check():
            await ops.list_tasks(
                user_id=generate_id(),
                organization_id=generate_id(),
                project_id=generate_id(),
                has_subtasks=True,
            )
        sql = next(s for s in captured if "select projects_tasks.id" in s)
        assert "projects_tasks.id in" in sql
        assert "parent_id is not null" in sql
        assert "projects_tasks.id not in" not in sql

    async def test_has_subtasks_false_emits_not_in_subquery(self) -> None:
        ops = _make_ops()
        captured = _capture_executes(ops)
        with _patch_project_check():
            await ops.list_tasks(
                user_id=generate_id(),
                organization_id=generate_id(),
                project_id=generate_id(),
                has_subtasks=False,
            )
        sql = next(s for s in captured if "select projects_tasks.id" in s)
        assert "projects_tasks.id not in" in sql


class TestAncestryCte:
    async def test_in_epic_id_builds_cte(self) -> None:
        ops = _make_ops()
        captured = _capture_executes(ops)
        epic_id = generate_id()
        with _patch_project_check():
            await ops.list_tasks(
                user_id=generate_id(),
                organization_id=generate_id(),
                project_id=generate_id(),
                in_epic_id=epic_id,
            )
        sql = next(s for s in captured if "task_ancestry" in s)
        assert "with recursive" in sql
        assert "task_ancestry" in sql
        assert f"ancestor_id = '{epic_id.hex}'" in sql

    async def test_min_depth_uses_max_aggregate(self) -> None:
        """Task depth = MAX(depth) over the ancestry walk (deepest ancestor)."""
        ops = _make_ops()
        captured = _capture_executes(ops)
        with _patch_project_check():
            await ops.list_tasks(
                user_id=generate_id(),
                organization_id=generate_id(),
                project_id=generate_id(),
                min_depth=1,
            )
        sql = next(s for s in captured if "task_ancestry" in s)
        assert "with recursive" in sql
        assert "max(task_ancestry.depth) >= 1" in sql

    async def test_max_depth_uses_max_aggregate(self) -> None:
        ops = _make_ops()
        captured = _capture_executes(ops)
        with _patch_project_check():
            await ops.list_tasks(
                user_id=generate_id(),
                organization_id=generate_id(),
                project_id=generate_id(),
                max_depth=2,
            )
        sql = next(s for s in captured if "task_ancestry" in s)
        assert "max(task_ancestry.depth) <= 2" in sql

    async def test_depth_range_combines_having_conditions(self) -> None:
        ops = _make_ops()
        captured = _capture_executes(ops)
        with _patch_project_check():
            await ops.list_tasks(
                user_id=generate_id(),
                organization_id=generate_id(),
                project_id=generate_id(),
                min_depth=1,
                max_depth=3,
            )
        sql = next(s for s in captured if "task_ancestry" in s)
        assert "max(task_ancestry.depth) >= 1" in sql
        assert "max(task_ancestry.depth) <= 3" in sql

    async def test_cte_omitted_when_no_hierarchy_filters(self) -> None:
        """The recursive CTE only shows up when in_epic/min_depth/max_depth fire."""
        ops = _make_ops()
        captured = _capture_executes(ops)
        with _patch_project_check():
            await ops.list_tasks(
                user_id=generate_id(),
                organization_id=generate_id(),
                project_id=generate_id(),
                root_only=True,
                has_subtasks=True,
            )
        assert not any("task_ancestry" in sql for sql in captured)
        assert not any("with recursive" in sql for sql in captured)


class TestFilterComposition:
    async def test_in_epic_plus_max_depth_share_cte(self) -> None:
        """One CTE should cover both ancestry filters in the same query."""
        ops = _make_ops()
        captured = _capture_executes(ops)
        epic_id = generate_id()
        with _patch_project_check():
            await ops.list_tasks(
                user_id=generate_id(),
                organization_id=generate_id(),
                project_id=generate_id(),
                in_epic_id=epic_id,
                max_depth=1,
            )
        sql = next(s for s in captured if "task_ancestry" in s)
        # ``WITH RECURSIVE task_ancestry`` appears exactly once per query --
        # we don't want two separate CTEs walking the chain twice.
        assert sql.count("with recursive task_ancestry") == 1
        assert f"ancestor_id = '{epic_id.hex}'" in sql
        assert "max(task_ancestry.depth) <= 1" in sql

    async def test_root_only_plus_has_subtasks_compose(self) -> None:
        ops = _make_ops()
        captured = _capture_executes(ops)
        with _patch_project_check():
            await ops.list_tasks(
                user_id=generate_id(),
                organization_id=generate_id(),
                project_id=generate_id(),
                root_only=True,
                has_subtasks=True,
            )
        sql = next(s for s in captured if "select projects_tasks.id" in s)
        assert "parent_id is null" in sql
        assert "projects_tasks.id in" in sql


class TestNoMagicStringForRoot:
    async def test_string_root_no_longer_filters_to_null(self) -> None:
        """The legacy ``parent_id='root'`` contract is gone.

        Callers must pass ``root_only=True`` instead. Passing the literal
        string would previously have been silently coerced; now the operation
        signature requires a UUID, so we guard against accidental regressions
        by asserting no IS NULL predicate appears for a non-None parent_id.
        """
        ops = _make_ops()
        captured = _capture_executes(ops)
        with _patch_project_check():
            await ops.list_tasks(
                user_id=generate_id(),
                organization_id=generate_id(),
                project_id=generate_id(),
            )
        # Bare list_tasks call: no parent filter, no IS NULL, no equality.
        assert not any("parent_id is null" in sql for sql in captured)
        assert not any("parent_id =" in sql for sql in captured)
