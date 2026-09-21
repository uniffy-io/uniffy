from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from uniffy.core.search.workspace import WorkspaceSearch
from uniffy.core.types import AccessMode, generate_id
from uniffy.domains.search.operations import SearchOperations
from uniffy.domains.search.queries import SearchResult

OPEN_BLOCKER = str(generate_id())
DONE_BLOCKER = str(generate_id())
DELETED_BLOCKER = str(generate_id())


def _task_row(blocked_by: list[str], *, completed: bool = False) -> SimpleNamespace:
    return SimpleNamespace(
        id=generate_id(),
        status="status_todo",
        priority="priority_medium",
        due_date=None,
        assignee_ids=None,
        task_type="task",
        number=1,
        blocked_by_task_ids=blocked_by,
        completed_at="2026-09-01" if completed else None,
        project_id=generate_id(),
        project_name="Ops",
        project_slug="OPS",
        project_color="",
    )


def _result(task_id) -> SearchResult:
    return SearchResult(
        urn=f"urn:uniffy:content:TASK:{task_id}",
        organization_id=generate_id(),
        title="Task",
        description=None,
        entity_type="task",
        url_path="",
        access_mode=AccessMode.OWNER_ONLY.value,
        baseline_role=None,
        owner_id=generate_id(),
        tags=None,
        metadata=None,
        updated_at=None,
        rank_score=1.0,
        search_score=None,
    )


async def _enrich(rows: list[SimpleNamespace]) -> dict[str, SearchResult]:
    session = MagicMock()
    rows_result = MagicMock()
    rows_result.all.return_value = rows
    session.execute = AsyncMock(return_value=rows_result)
    operations = SearchOperations(session, MagicMock(spec=WorkspaceSearch))
    operations._load_field_options = AsyncMock(return_value={})
    operations._get_subtask_counts = AsyncMock(return_value={})
    operations._get_open_task_ids = AsyncMock(return_value={OPEN_BLOCKER})

    results = {_result(row.id).urn: _result(row.id) for row in rows}
    urn_to_id = {urn: row.id for urn, row in zip(results, rows, strict=True)}
    await operations._enrich_tasks(
        results,
        [row.id for row in rows],
        urn_to_id,
        organization_id=generate_id(),
        user_id=generate_id(),
    )
    return results


async def test_blocked_count_counts_only_open_blockers() -> None:
    row = _task_row([OPEN_BLOCKER, DONE_BLOCKER, DELETED_BLOCKER, "not-a-uuid"])
    results = await _enrich([row])

    assert next(iter(results.values())).blocked_by_count == 1


async def test_completed_task_is_not_blocked() -> None:
    done = _task_row([OPEN_BLOCKER], completed=True)
    results = await _enrich([done])

    assert next(iter(results.values())).blocked_by_count == 0
