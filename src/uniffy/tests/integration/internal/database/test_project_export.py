"""Task exports on real rows: volume, outline order, bundle integrity and the read snapshot."""

import csv
import io
import zipfile
from types import SimpleNamespace

import pytest
import pytest_asyncio
from protobuf import Oneof
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from uniffy_proto.projects.v1.projects_pb import (
    FilterLogic,
    TaskFieldRef,
    TaskFilterCondition,
    TaskFilterGroup,
    TaskFilterIdSet,
    TaskFilterNode,
    TaskFilterOperator,
    TaskFilterValue,
)

from uniffy.core.audit.actions import Action
from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.comments.comment import Comment, CommentAnchorType
from uniffy.core.models.projects.activity import TaskActivity
from uniffy.core.models.projects.field_definition import FieldDefinition
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.sprint import Sprint
from uniffy.core.models.projects.task import Task
from uniffy.core.types import AccessMode, ContentRole, ContentType, generate_id
from uniffy.domains.projects.defaults import stage_default_project_fields
from uniffy.domains.projects.export.operations import ProjectExportOperations, record_export
from uniffy.domains.projects.export.plan import ExportLayout, ExportRequest
from uniffy.domains.projects.registration import register_project_content
from uniffy.infrastructure.database import open_session

pytestmark = pytest.mark.asyncio(loop_scope="session")

TASK_COUNT = 1_200


async def _seed(session: AsyncSession, env: SimpleNamespace) -> SimpleNamespace:
    register_project_content()
    slug = f"EX{generate_id().hex[-6:].upper()}"
    project = Project(
        organization_id=env.org_id,
        owner_id=env.admin_id,
        access_mode=AccessMode.OPEN_TO_ORG,
        baseline_role=ContentRole.VIEWER,
        name=f"Export {slug}",
        slug=slug,
    )
    session.add(project)
    await session.flush()
    await stage_default_project_fields(session, project.id)
    # Ten roots of 120 tasks: eleven children under each root, the rest one level further down.
    tasks: list[Task] = []
    for number in range(1, TASK_COUNT + 1):
        offset = (number - 1) % 120
        root = number - offset
        if offset == 0:
            parent = None
        elif offset <= 11:
            parent = tasks[root - 1]
        else:
            parent = tasks[root - 1 + (offset - 12) % 11 + 1]
        tasks.append(
            Task(
                project_id=project.id,
                organization_id=env.org_id,
                owner_id=env.admin_id,
                title=f"Task {number}",
                number=number,
                sort_order=number,
                status="status_done" if number % 4 == 0 else "status_todo",
                parent_id=parent.id if parent else None,
            )
        )
    for task in tasks:
        session.add(task)
    await session.flush()
    session.add_all([
        TaskActivity(task_id=task.id, actor_id=env.admin_id, action="created")
        for task in tasks
    ])
    session.add_all([
        Comment(
            organization_id=env.org_id,
            content_type=ContentType.TASK,
            content_id=task.id,
            author_id=env.member_id,
            body=f"=note on {task.number}",
            anchor_type=CommentAnchorType.PAGE,
        )
        for task in tasks[:40]
    ])
    await session.commit()
    return SimpleNamespace(project_id=project.id, slug=slug, tasks=tasks)


async def _cleanup(session: AsyncSession, env: SimpleNamespace, seeded: SimpleNamespace) -> None:
    await session.rollback()
    task_ids = select(Task.id).where(Task.project_id == seeded.project_id)
    await session.execute(delete(Comment).where(Comment.organization_id == env.org_id))
    await session.execute(delete(TaskActivity).where(TaskActivity.task_id.in_(task_ids)))
    await session.execute(
        update(Task).where(Task.project_id == seeded.project_id).values(parent_id=None)
    )
    await session.execute(delete(Task).where(Task.project_id == seeded.project_id))
    await session.execute(delete(Sprint).where(Sprint.project_id == seeded.project_id))
    await session.execute(
        delete(FieldDefinition).where(FieldDefinition.project_id == seeded.project_id)
    )
    await session.execute(delete(Project).where(Project.id == seeded.project_id))
    await session.commit()


@pytest_asyncio.fixture(loop_scope="session")
async def seeded(session, env):
    data = await _seed(session, env)
    try:
        yield data
    finally:
        await _cleanup(session, env, data)


async def _export(env, seeded, **kwargs) -> list[bytes]:
    request = ExportRequest(env.org_id, (seeded.project_id,), **kwargs)
    async with open_session() as export_session:
        ops = ProjectExportOperations(export_session)
        plan = await ops.prepare(env.member_id, request)
        return [chunk async for chunk in ops.stream(plan)]


def _rows(data: bytes) -> list[list[str]]:
    return list(csv.reader(io.StringIO(data.decode("utf-8-sig"))))


def _done_only() -> TaskFilterGroup:
    return TaskFilterGroup(
        logic=FilterLogic.AND,
        nodes=[
            TaskFilterNode(
                node=Oneof(
                    field="condition",
                    value=TaskFilterCondition(
                        field=TaskFieldRef(ref=Oneof(field="field_id", value="field_status")),
                        operator=TaskFilterOperator.IS_ANY_OF,
                        value=TaskFilterValue(
                            value=Oneof(field="ids", value=TaskFilterIdSet(ids=["status_done"]))
                        ),
                    ),
                )
            )
        ],
    )


async def test_every_task_streams_past_the_list_page_size(session, env, seeded) -> None:
    chunks = await _export(env, seeded)
    rows = _rows(b"".join(chunks))

    assert len(chunks) > 1
    assert len(rows) == TASK_COUNT + 1
    assert [row[2] for row in rows[1:4]] == [f"{seeded.slug}-1", f"{seeded.slug}-2", f"{seeded.slug}-3"]


async def test_subtasks_carry_their_parent_key_and_depth(session, env, seeded) -> None:
    rows = {row[2]: row for row in _rows(b"".join(await _export(env, seeded)))[1:]}

    root, child, grandchild = (rows[f"{seeded.slug}-{n}"] for n in (1, 2, 13))
    assert (root[15], root[16]) == ("", "0")
    assert (child[15], child[16]) == (f"{seeded.slug}-1", "1")
    assert (grandchild[15], grandchild[16]) == (f"{seeded.slug}-2", "2")


async def test_outline_lists_each_root_then_its_descendants_depth_first(
    session, env, seeded
) -> None:
    rows = _rows(b"".join(await _export(env, seeded, layout=ExportLayout.OUTLINE)))[1:]
    by_id = {task.id: task for task in seeded.tasks}
    children: dict = {}
    for task in seeded.tasks:
        children.setdefault(task.parent_id, []).append(task)

    def walk(task: Task) -> list[str]:
        keys = [f"{seeded.slug}-{task.number}"]
        for child in sorted(children.get(task.id, []), key=lambda t: t.number):
            keys.extend(walk(child))
        return keys

    roots = sorted(children[None], key=lambda task: task.sort_order)
    expected = [key for root in roots for key in walk(root)]
    assert [row[2] for row in rows] == expected
    assert len(by_id) == len(expected)


async def test_a_filtered_bundle_only_names_tasks_its_tasks_file_has(session, env, seeded) -> None:
    archive = zipfile.ZipFile(
        io.BytesIO(b"".join(await _export(env, seeded, task_filter=_done_only(), include_bundle=True)))
    )
    assert archive.testzip() is None
    assert archive.namelist() == [
        "tasks.csv",
        "sprints.csv",
        "activities.csv",
        "comments.csv",
        "fields.csv",
    ]
    keys = {row[2] for row in _rows(archive.read("tasks.csv"))[1:]}
    activities = _rows(archive.read("activities.csv"))[1:]
    comments = _rows(archive.read("comments.csv"))[1:]

    assert len(keys) == TASK_COUNT // 4
    assert {row[0] for row in activities} == keys
    assert comments and {row[0] for row in comments} <= keys
    assert all(row[2].startswith("'=note") for row in comments)


async def test_a_task_created_mid_export_stays_out_of_every_file(session, env, seeded) -> None:
    request = ExportRequest(env.org_id, (seeded.project_id,), include_bundle=True)
    async with open_session() as export_session:
        ops = ProjectExportOperations(export_session)
        plan = await ops.prepare(env.member_id, request)
        stream = ops.stream(plan)
        chunks = [await anext(stream)]
        late = Task(
            project_id=seeded.project_id,
            organization_id=env.org_id,
            owner_id=env.admin_id,
            title="late",
            number=TASK_COUNT + 1,
        )
        async with open_session() as writer:
            writer.add(late)
            await writer.flush()
            writer.add(TaskActivity(task_id=late.id, actor_id=env.admin_id, action="created"))
            await writer.commit()
        chunks.extend([chunk async for chunk in stream])

    archive = zipfile.ZipFile(io.BytesIO(b"".join(chunks)))
    late_key = f"{seeded.slug}-{TASK_COUNT + 1}"
    assert late_key not in {row[2] for row in _rows(archive.read("tasks.csv"))[1:]}
    assert late_key not in {row[0] for row in _rows(archive.read("activities.csv"))[1:]}


async def test_an_export_records_one_audit_event_per_project(session, env, seeded) -> None:
    request = ExportRequest(env.org_id, (seeded.project_id,), include_bundle=True)
    async with open_session() as export_session:
        plan = await ProjectExportOperations(export_session).prepare(env.member_id, request)
    async with open_session() as audit_session:
        await record_export(audit_session, env.member_id, plan)

    events = (
        await session.execute(
            select(AuditEvent).where(
                AuditEvent.organization_id == env.org_id,
                AuditEvent.action == Action.PROJECT_EXPORTED,
            )
        )
    ).scalars().all()
    assert len(events) == 1
    assert events[0].resource_id == seeded.project_id
    assert events[0].details == {"rows": TASK_COUNT, "projects": 1, "scope": "project", "bundle": True}
