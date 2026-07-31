"""Unit tests for parent-chain validation on tasks.

Exercises ``_validate_no_circular_parent`` on the update and create paths
against a ``MagicMock`` session.
"""

from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

import pytest

from uniffy.core.errors import ValidationError
from uniffy.core.types import generate_id
from uniffy.domains.projects.operations import TaskOperations


def _make_ops() -> TaskOperations:
    ops = TaskOperations.__new__(TaskOperations)
    ops.session = MagicMock()
    return ops


def _chain_session(parents_by_id: dict[UUID, UUID | None]) -> AsyncMock:
    """Build a session.execute mock that returns each task's parent_id on lookup.

    The validator selects ``Task.parent_id`` filtered by ``Task.id == current``.
    We return whatever ``parents_by_id[current]`` maps to, defaulting to None
    when the id is absent (i.e. ancestor is the chain root).
    """

    async def execute(stmt):  # noqa: ANN001 - SQLAlchemy statement
        compiled = stmt.compile(compile_kwargs={"literal_binds": True})
        sql = str(compiled).lower()
        # Pull the UUID literal out of the WHERE clause. The compiled form is
        # ``SELECT projects_tasks.parent_id FROM projects_tasks WHERE
        # projects_tasks.id = '<uuid>' AND projects_tasks.is_deleted = false``.
        marker = "projects_tasks.id = '"
        idx = sql.index(marker) + len(marker)
        end = sql.index("'", idx)
        current = UUID(sql[idx:end])
        result = MagicMock()
        result.scalar_one_or_none.return_value = parents_by_id.get(current)
        return result

    return AsyncMock(side_effect=execute)


class TestValidateNoCircularParent:
    async def test_self_parent_rejected(self) -> None:
        ops = _make_ops()
        task_id = generate_id()
        with pytest.raises(ValidationError, match="own parent"):
            await ops._validate_no_circular_parent(task_id, task_id)

    async def test_two_node_cycle_rejected(self) -> None:
        ops = _make_ops()
        task_id = generate_id()
        parent_id = generate_id()
        # parent_id's parent is task_id - completing the cycle one hop up.
        ops.session.execute = _chain_session({parent_id: task_id})
        with pytest.raises(ValidationError, match="loop"):
            await ops._validate_no_circular_parent(task_id, parent_id)

    async def test_five_node_cycle_rejected(self) -> None:
        ops = _make_ops()
        task_id = generate_id()
        a, b, c, d = generate_id(), generate_id(), generate_id(), generate_id()
        # Walking up from a -> b -> c -> d -> task_id closes a 5-node loop.
        ops.session.execute = _chain_session(
            {a: b, b: c, c: d, d: task_id},
        )
        with pytest.raises(ValidationError, match="loop"):
            await ops._validate_no_circular_parent(task_id, a)

    async def test_depth_five_chain_allowed(self) -> None:
        ops = _make_ops()
        task_id = generate_id()
        # Depth 5: task_id sits below 5 ancestors. Walking up from p1 visits
        # p1..p5; the validator counts depth=1 at p1 and depth=5 at p5, then
        # finds None and returns cleanly.
        p1, p2, p3, p4, p5 = (
            generate_id(),
            generate_id(),
            generate_id(),
            generate_id(),
            generate_id(),
        )
        ops.session.execute = _chain_session(
            {p1: p2, p2: p3, p3: p4, p4: p5, p5: None},
        )
        await ops._validate_no_circular_parent(task_id, p1)

    async def test_depth_six_chain_rejected(self) -> None:
        ops = _make_ops()
        task_id = generate_id()
        p1, p2, p3, p4, p5, p6 = (generate_id() for _ in range(6))
        ops.session.execute = _chain_session(
            {p1: p2, p2: p3, p3: p4, p4: p5, p5: p6, p6: None},
        )
        with pytest.raises(ValidationError, match="depth"):
            await ops._validate_no_circular_parent(task_id, p1)

    async def test_existing_chain_cycle_rejected(self) -> None:
        ops = _make_ops()
        task_id = generate_id()
        a, b = generate_id(), generate_id()
        # a <-> b loop that does not involve task_id - validator should still
        # bail out instead of spinning forever.
        ops.session.execute = _chain_session({a: b, b: a})
        with pytest.raises(ValidationError, match="cycle"):
            await ops._validate_no_circular_parent(task_id, a)

    async def test_create_path_skips_cycle_check(self) -> None:
        ops = _make_ops()
        # Create path passes task_id=None. The chain walks up and terminates
        # normally; depth limits still apply but cycles cannot be detected
        # because the new task is not yet anyone's ancestor.
        parent = generate_id()
        ops.session.execute = _chain_session({parent: None})
        await ops._validate_no_circular_parent(None, parent)

    async def test_create_path_still_enforces_depth(self) -> None:
        ops = _make_ops()
        p1, p2, p3, p4, p5, p6 = (generate_id() for _ in range(6))
        ops.session.execute = _chain_session(
            {p1: p2, p2: p3, p3: p4, p4: p5, p5: p6, p6: None},
        )
        with pytest.raises(ValidationError, match="depth"):
            await ops._validate_no_circular_parent(None, p1)
