"""A view filter on a 10k-task project among other projects' tasks reads the task indexes."""

import random
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
import pytest_asyncio
from sqlalchemy import delete, insert, select, text
from uniffy_proto.projects.v1.projects_pb2 import (
    FilterLogic,
    TaskFieldRef,
    TaskFilterCondition,
    TaskFilterDate,
    TaskFilterDateRange,
    TaskFilterGroup,
    TaskFilterIdSet,
    TaskFilterNode,
    TaskFilterOperator,
    TaskFilterValue,
    TaskPseudoField,
)

from uniffy.core.json_codec import dumps_str, loads
from uniffy.core.models.projects.field_definition import FieldDefinition, ProjectFieldType
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.task import Task
from uniffy.core.models.tags.tag import Tag, TagAssignment
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import AccessMode, ContentType, generate_id
from uniffy.domains.projects.defaults import stage_default_project_fields
from uniffy.domains.projects.tasks.reader import TaskReader
from uniffy.infrastructure.database import open_session
from uniffy.tests.integration.internal.database.conftest import seed_env, teardown_env

pytestmark = pytest.mark.asyncio(loop_scope="session")

TASKS = 10_000
OTHER_TASKS = 30_000
PEOPLE = 500
TAGS = 20
OPTIONS = 500
TASK_TABLE = "projects_tasks"
SEQ_SCAN = "Seq Scan"
ASSIGNEE_INDEX = "ix_projects_tasks_assignee_ids"
FIELD_VALUES_INDEX = "ix_projects_tasks_field_values"
DUE_DATE_INDEX = "ix_projects_tasks_project_due_date"
TAG_INDEXES = frozenset({"pk_tag_assignments", "ix_tag_assignments_content_urn"})
TAG_BY_TAG_INDEX = "ix_tag_assignments_tag_content_type"


def _condition(field: TaskFieldRef, ids: list[str]) -> TaskFilterNode:
    return TaskFilterNode(
        condition=TaskFilterCondition(
            field=field,
            operator=TaskFilterOperator.TASK_FILTER_OPERATOR_IS_ANY_OF,
            value=TaskFilterValue(ids=TaskFilterIdSet(ids=ids)),
        )
    )


@pytest_asyncio.fixture(scope="module", loop_scope="session")
async def large_project(database):
    """Seeded once for the module: 40k rows are slow to write and only ever read here."""
    async with open_session() as session:
        env = await seed_env(session)
        try:
            yield await _seed_large(session, env)
        finally:
            await _cleanup_large(session, env)
            await teardown_env(session, env)


async def _seed_large(session, env) -> SimpleNamespace:
    project = Project(
        organization_id=env.org_id,
        owner_id=env.admin_id,
        access_mode=AccessMode.OWNER_ONLY,
        name=f"Large {generate_id().hex[:10]}",
        slug=f"LG{generate_id().hex[:8].upper()}",
    )
    other = Project(
        organization_id=env.org_id,
        owner_id=env.admin_id,
        access_mode=AccessMode.OWNER_ONLY,
        name=f"Other {generate_id().hex[:10]}",
        slug=f"OT{generate_id().hex[:8].upper()}",
    )
    session.add_all([project, other])
    await session.flush()
    await stage_default_project_fields(session, project.id)
    session.add(
        FieldDefinition(
            id="size",
            project_id=project.id,
            name="Size",
            type=ProjectFieldType.SINGLE_SELECT,
            config={"options": [{"id": f"size-{n}", "label": str(n)} for n in range(OPTIONS)]},
        )
    )
    tags = [
        Tag(organization_id=env.org_id, name=f"t{n}", slug=f"t{n}-{generate_id().hex[:6]}")
        for n in range(TAGS)
    ]
    session.add_all(tags)
    await session.flush()
    project_id = project.id
    tag_ids = [tag.id for tag in tags]

    people = [str(generate_id()) for _ in range(PEOPLE)]
    now = datetime.now(UTC)
    rows = [
        {
            "id": generate_id(),
            "project_id": project.id,
            "organization_id": env.org_id,
            "owner_id": env.admin_id,
            "title": f"Task {n}",
            "number": n + 1,
            "sort_order": n,
            "assignee_ids": [people[n % PEOPLE]],
            "field_values": {"size": f"size-{n % OPTIONS}"},
            "due_date": f"2026-{(n % 12) + 1:02d}-{(n % 28) + 1:02d}",
            "created_at": now,
            "updated_at": now,
        }
        for n in range(TASKS)
    ]
    strangers = [str(generate_id()) for _ in range(PEOPLE)]
    other_rows = [
        {
            "id": generate_id(),
            "project_id": other.id,
            "organization_id": env.org_id,
            "owner_id": env.member_id,
            "title": f"Other {n}",
            "number": n + 1,
            "sort_order": n,
            "assignee_ids": [strangers[n % PEOPLE]],
            "field_values": {"size": f"size-{n % OPTIONS}"},
            "due_date": f"2026-{(n % 12) + 1:02d}-{(n % 28) + 1:02d}",
            "created_at": now,
            "updated_at": now,
        }
        for n in range(OTHER_TASKS)
    ]
    # Interleaved as tasks of many projects are in production: a project's rows are not one run
    # of pages, so reading the whole project is not a cheap sequential read.
    mixed = rows + other_rows
    random.Random(7).shuffle(mixed)
    await session.execute(insert(Task), mixed)
    await session.execute(
        insert(TagAssignment),
        [
            {
                "tag_id": tag_ids[n % TAGS],
                "content_urn": build_content_urn(ContentType.TASK, row["id"]),
                "content_type": ContentType.TASK.value,
                "sources": [],
                "assigned_at": now,
            }
            for n, row in enumerate(rows)
        ],
    )
    await session.commit()
    await session.execute(text("ANALYZE projects_tasks"))
    await session.execute(text("ANALYZE tag_assignments"))
    await session.commit()

    conditions = {
        "field": _condition(TaskFieldRef(field_id="size"), ["size-3"]),
        "tag": _condition(
            TaskFieldRef(pseudo=TaskPseudoField.TASK_PSEUDO_FIELD_TAGS), [str(tag_ids[3])]
        ),
        "assignee": _condition(TaskFieldRef(field_id="field_assignee"), [people[3]]),
        "due": TaskFilterNode(
            condition=TaskFilterCondition(
                field=TaskFieldRef(field_id="field_due_date"),
                operator=TaskFilterOperator.TASK_FILTER_OPERATOR_BETWEEN,
                value=TaskFilterValue(
                    date_range=TaskFilterDateRange(
                        start=TaskFilterDate(fixed="2026-03-01"),
                        end=TaskFilterDate(fixed="2026-03-07"),
                    )
                ),
            )
        ),
    }
    return SimpleNamespace(env=env, project_id=project_id, conditions=conditions)


async def _cleanup_large(session, env) -> None:
    """Everything the org holds, so a seed that stopped halfway is cleaned up too."""
    await session.rollback()
    org_tags = select(Tag.id).where(Tag.organization_id == env.org_id)
    org_projects = select(Project.id).where(Project.organization_id == env.org_id)
    await session.execute(delete(TagAssignment).where(TagAssignment.tag_id.in_(org_tags)))
    await session.execute(delete(Tag).where(Tag.organization_id == env.org_id))
    await session.execute(delete(Task).where(Task.organization_id == env.org_id))
    await session.execute(
        delete(FieldDefinition).where(FieldDefinition.project_id.in_(org_projects))
    )
    await session.execute(delete(Project).where(Project.organization_id == env.org_id))
    await session.commit()


def _view(large: SimpleNamespace, *names: str) -> TaskFilterGroup:
    return TaskFilterGroup(
        logic=FilterLogic.FILTER_LOGIC_AND, nodes=[large.conditions[name] for name in names]
    )


async def test_a_three_condition_view_keeps_where_all_three_meet(session, large_project) -> None:
    large = large_project
    tasks, total = await TaskReader(session).list_tasks(
        user_id=large.env.admin_id,
        organization_id=large.env.org_id,
        project_id=large.project_id,
        task_filter=_view(large, "assignee", "field", "tag"),
    )
    # The person, the option and the tag coincide on every 500th task.
    assert total == TASKS // PEOPLE
    assert len(tasks) == total


def _plan_nodes(plan: dict) -> list[dict]:
    nodes = [plan]
    for child in plan.get("Plans", []):
        nodes.extend(_plan_nodes(child))
    return nodes


async def _plan(session, large: SimpleNamespace, *names: str) -> list[dict]:
    """The plan of the statement the reader sends, bound parameters and all."""
    query = await TaskReader(session).list_query(
        large.env.admin_id, large.env.org_id, large.project_id, task_filter=_view(large, *names)
    )
    connection = await session.connection()
    compiled = query.compile(dialect=connection.dialect, compile_kwargs={"render_postcompile": True})
    params = compiled.construct_params()
    explained = await connection.exec_driver_sql(
        f"EXPLAIN (FORMAT JSON) {compiled}",
        # exec_driver_sql skips the JSONB bind processor, so the objects go as JSON text.
        tuple(
            dumps_str(params[name]) if isinstance(params[name], dict) else params[name]
            for name in compiled.positiontup or ()
        ),
    )
    raw = explained.scalar_one()
    return _plan_nodes((loads(raw) if isinstance(raw, str) else raw)[0]["Plan"])


def _indexes(nodes: list[dict]) -> set[str]:
    return {node["Index Name"] for node in nodes if "Index Name" in node}  # noqa: PLR2004


def _task_table_scans(nodes: list[dict]) -> set[str]:
    return {node["Node Type"] for node in nodes if node.get("Relation Name") == TASK_TABLE}


async def test_the_combined_view_reads_each_condition_from_an_index(session, large_project) -> None:
    nodes = await _plan(session, large_project, "assignee", "field", "tag")
    indexes = _indexes(nodes)
    # Whichever of the two narrows more by the sampled statistics leads; either is right.
    assert indexes & {ASSIGNEE_INDEX, FIELD_VALUES_INDEX}
    assert indexes & TAG_INDEXES
    assert SEQ_SCAN not in _task_table_scans(nodes)


@pytest.mark.parametrize(
    ("condition", "index"),
    [
        ("assignee", ASSIGNEE_INDEX),
        ("field", FIELD_VALUES_INDEX),
        ("due", DUE_DATE_INDEX),
        ("tag", TAG_BY_TAG_INDEX),
    ],
)
async def test_a_narrowing_condition_reads_its_index(
    session, large_project, condition: str, index: str
) -> None:
    assert index in _indexes(await _plan(session, large_project, condition))


# A tag narrows on the tag side; which way the task side is read is a costing choice.
@pytest.mark.parametrize("condition", ["assignee", "field", "due"])
async def test_a_narrowing_condition_never_reads_past_the_project(
    session, large_project, condition: str
) -> None:
    nodes = await _plan(session, large_project, condition)
    assert SEQ_SCAN not in _task_table_scans(nodes)
