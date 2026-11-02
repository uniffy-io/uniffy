from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import delete, event, select

from uniffy.core.auth.acting_agent import acting_agent
from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.projects.activity import TaskActivity, TaskActivityAction
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.task import Task
from uniffy.core.realtime.adapter import register_realtime_adapter
from uniffy.core.realtime.admission import RoleRefused
from uniffy.core.realtime.checkpoint import checkpoint_document
from uniffy.core.realtime.live import stage_text_merge
from uniffy.core.realtime.storage import lock_document
from uniffy.core.types import AccessMode, ContentRole
from uniffy.domains.projects.recurrence import serialize_recurrence_config
from uniffy.domains.projects.tasks.activity import TaskActivityRecorder
from uniffy.domains.projects.tasks.content import TaskContentOperations
from uniffy.domains.projects.tasks.creation import TaskCreateOperations
from uniffy.domains.projects.tasks.description_activity import stage_description_edits
from uniffy.domains.projects.tasks.mutations import TaskMutationOperations
from uniffy.domains.projects.tasks.notifications import TaskNotifications
from uniffy.infrastructure.database.session import open_session
from uniffy.tests.integration.access.realtime_live import (
    establish,
    fragment_edit,
    stored,
    typed,
    valkey,
)
from uniffy.tests.integration.access.realtime_tasks import document, project  # noqa: F401 - fixture
from uniffy.tests.integration.access.realtime_sockets import attached, routed
from uniffy.tests.integration.access.test_realtime_task_live import live_project  # noqa: F401 - fixture

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def activities(task_id):
    async with open_session() as db:
        return list(
            (
                await db.scalars(
                    select(TaskActivity)
                    .where(TaskActivity.task_id == task_id)
                    .order_by(TaskActivity.timestamp, TaskActivity.id)
                )
            ).all()
        )


async def test_description_sessions_ignore_other_editors_and_field_changes(document):
    live = document.live
    start = datetime.now(UTC) - timedelta(minutes=20)
    async with open_session() as db:
        await lock_document(db, live.key, live.org)
        await stage_description_edits(db, live.key[1], [(live.owner, start)], agent_id=None)
        await TaskNotifications(db).log_activity(
            live.key[1], live.owner, TaskActivityAction.TITLE_CHANGED
        )
        await stage_description_edits(
            db,
            live.key[1],
            [
                (live.peer, start + timedelta(minutes=1)),
                (live.owner, start + timedelta(minutes=2)),
                (live.owner, start + timedelta(minutes=8)),
                (live.peer, start + timedelta(minutes=9)),
            ],
            agent_id=None,
        )
        await db.commit()
    rows = [
        row
        for row in await activities(live.key[1])
        if row.action == TaskActivityAction.DESCRIPTION_EDITED
    ]
    assert [(row.actor_id, row.timestamp) for row in rows] == [
        (live.peer, start + timedelta(minutes=1)),
        (live.owner, start + timedelta(minutes=2)),
        (live.owner, start + timedelta(minutes=8)),
        (live.peer, start + timedelta(minutes=9)),
    ]


@pytest.mark.parametrize("path", ["checkpoint", "recovery", "plain_write"])
async def test_buffered_contributors_survive_every_checkpoint_path(document, path):
    live = document.live
    first = typed(live.base, suffix=" Alice")
    second = typed(live.base, first, suffix=" Bob")
    third = typed(live.base, first, second, suffix=" Alice again")
    for name, update, actor in [
        ("first", first, live.owner),
        ("second", second, live.peer),
        ("third", third, live.owner),
    ]:
        await live.admit(name, update, actor)
    if path == "checkpoint":
        await live.checkpointed()
        await checkpoint_document(live.buffer, live.head.scope, enqueue=live.jobs)
    elif path == "recovery":
        await valkey().delete(live.keys.control)
        await establish(live.buffer, live.key, live.org)
    else:
        async with open_session() as db:
            await lock_document(db, live.key, live.org)
            merged = await stage_text_merge(
                live.buffer,
                db,
                live.key,
                live.org,
                live.owner,
                base="base",
                stored="base",
                incoming="base",
            )
            assert not merged.contributed
            await db.commit()
            await merged.after_commit()
    rows = await activities(live.key[1])
    assert {row.actor_id for row in rows} == {live.owner, live.peer}
    assert len(rows) == 2
    assert all(row.agent_id is None for row in rows)
    await project(document)
    assert {row.id for row in await activities(live.key[1])} == {row.id for row in rows}


async def test_checkpoint_failure_rolls_back_history_and_watermark(document):
    live = document.live
    await live.admit("edit", typed(live.base, suffix=" edit"))
    before = await stored(live.key)

    async def fail_after_history(*args):
        await document.adapter.stage_edits(*args)
        raise RuntimeError("checkpoint failed")

    register_realtime_adapter(document.adapter, stage_edits=fail_after_history)
    try:
        with pytest.raises(RuntimeError, match="checkpoint failed"):
            await live.checkpointed()
    finally:
        register_realtime_adapter(document.adapter, stage_edits=document.adapter.stage_edits)
    assert await activities(live.key[1]) == []
    assert (await stored(live.key)).checkpoint_seq == before.checkpoint_seq
    assert await live.stream_ids() == [b"1-0"]
    await live.checkpointed()
    assert len(await activities(live.key[1])) == 1


async def test_fragment_hydration_records_no_description_editor(document):
    live = document.live
    hydration = fragment_edit(live.base, text="base")
    assert (await live.admit_live("hydrate", hydration)).applied
    await live.checkpointed()
    assert await activities(live.key[1]) == []
    update = typed(live.base, hydration, suffix=" typed")
    assert (await live.admit_live("type", update)).applied
    await live.checkpointed()
    rows = await activities(live.key[1])
    assert [(row.actor_id, row.action) for row in rows] == [
        (live.owner, TaskActivityAction.DESCRIPTION_EDITED)
    ]


async def test_derived_text_repair_persists_without_crediting_passive_editor(document):
    live = document.live
    repair = typed(live.base, suffix=" repaired")
    async with routed(live, 1) as (manager,), attached(manager, live) as (client, _):
        client.write("repair", repair, live.generation, authored=False)
        assert (await client.receipt()).accepted_sequence == 1
    await live.checkpointed()
    await project(document)
    async with open_session() as db:
        task = await db.get(Task, live.key[1])
        assert task.description == "base repaired"
    assert await activities(live.key[1]) == []
    with pytest.raises(RoleRefused):
        await live.admit_live(
            "denied", typed(live.base, repair, suffix=" forbidden"), live.peer, authored=False
        )


async def test_agent_merge_credits_buffered_human_and_actual_rpc_contribution(live_project):
    live = live_project.tasks[0]
    async with open_session() as db:
        agent = Agent(organization_id=live.org, owner_id=live.owner, name="Activity test")
        db.add(agent)
        await db.commit()
        agent_id = agent.id
    try:
        await live.admit("peer", typed(live.base, suffix=" peer"), live.peer)
        async with open_session() as db:
            content = TaskContentOperations(db, storage=MagicMock(), search_indexer=AsyncMock())
            with acting_agent(agent_id):
                await TaskMutationOperations(db, content, live.buffer).update(
                    live.owner,
                    live.org,
                    live.key[1],
                    description="base peer",
                    base_description="base",
                )
        rows = await activities(live.key[1])
        assert [(row.actor_id, row.agent_id) for row in rows] == [(live.peer, None)]
        async with open_session() as db:
            content = TaskContentOperations(db, storage=MagicMock(), search_indexer=AsyncMock())
            with acting_agent(agent_id):
                await TaskMutationOperations(db, content, live.buffer).update(
                    live.owner,
                    live.org,
                    live.key[1],
                    description="base peer agent",
                    base_description="base peer",
                )
        rows = await activities(live.key[1])
        assert [(row.actor_id, row.agent_id) for row in rows] == [
            (live.peer, None),
            (live.owner, agent_id),
        ]
    finally:
        async with open_session() as db:
            await db.execute(delete(Agent).where(Agent.id == agent_id))
            await db.commit()


async def test_initial_blockers_record_both_ends(live_project):
    live = live_project.tasks[0]
    async with open_session() as db:
        content = TaskContentOperations(db, storage=MagicMock(), search_indexer=AsyncMock())
        task = await TaskCreateOperations(db, content).create(
            live.owner,
            live.org,
            live_project.id,
            "Blocked at creation",
            blocked_by_task_ids=[str(live.key[1])],
        )
    assert [(row.action, row.new_value) for row in await activities(task.id)] == [
        (TaskActivityAction.CREATED, None),
        (TaskActivityAction.BLOCKED_BY_ADDED, str(live.key[1])),
    ]
    assert [(row.action, row.new_value) for row in await activities(live.key[1])] == [
        (TaskActivityAction.BLOCKING_ADDED, str(task.id)),
    ]


async def test_recurring_creation_credits_completing_person_and_agent(live_project):
    live = live_project.tasks[0]
    async with open_session() as db:
        project_row = await db.get(Project, live_project.id)
        project_row.access_mode = AccessMode.OPEN_TO_ORG
        project_row.baseline_role = ContentRole.EDITOR
        task = await db.get(Task, live.key[1])
        task.recurrence_rule = serialize_recurrence_config({"pattern": "daily"})
        agent = Agent(organization_id=live.org, owner_id=live.peer, name="Completing agent")
        db.add(agent)
        await db.commit()
        agent_id = agent.id
    try:
        async with open_session() as db:
            content = TaskContentOperations(db, storage=MagicMock(), search_indexer=AsyncMock())
            with acting_agent(agent_id):
                _, spawned = await TaskMutationOperations(db, content, live.buffer).update(
                    live.peer, live.org, live.key[1], status="status_done"
                )
        assert spawned is not None
        assert spawned.owner_id == live.owner
        created = [
            row for row in await activities(spawned.id) if row.action == TaskActivityAction.CREATED
        ]
        assert [(row.actor_id, row.agent_id) for row in created] == [(live.peer, agent_id)]
    finally:
        async with open_session() as db:
            await db.execute(delete(Agent).where(Agent.id == agent_id))
            await db.commit()


@pytest.mark.parametrize("kind", ["custom_fields", "blockers"])
async def test_many_changes_commit_in_one_insert_batch(live_project, kind):
    live = live_project.tasks[0]
    inserts = []
    async with open_session() as db:
        blockers = []
        if kind == "blockers":
            blockers = [
                Task(
                    organization_id=live.org,
                    owner_id=live.owner,
                    project_id=live_project.id,
                    title=f"Blocker {i}",
                    number=i + 3,
                )
                for i in range(100)
            ]
            db.add_all(blockers)
            await db.flush()
        connection = await db.connection()

        def record_insert(_conn, _cursor, _statement, _params, context, _many):
            if context.isinsert:
                inserts.append(context)

        event.listen(connection.sync_connection, "after_cursor_execute", record_insert)
        recorder = TaskActivityRecorder(db)
        if kind == "custom_fields":
            await recorder.custom_fields(
                live.key[1], live.owner, {}, {f"field_{i}": str(i) for i in range(100)}
            )
        else:
            await recorder.blockers(live.key[1], live.owner, [], [str(task.id) for task in blockers])
        await db.commit()
    rows = await activities(live.key[1])
    assert len(rows) == 100
    if kind == "custom_fields":
        assert {row.field_id for row in rows} == {f"field_{i}" for i in range(100)}
    else:
        assert {row.new_value for row in rows} == {str(task.id) for task in blockers}
        async with open_session() as db:
            far_end = list(
                (
                    await db.scalars(
                        select(TaskActivity).where(
                            TaskActivity.task_id.in_([task.id for task in blockers])
                        )
                    )
                ).all()
            )
        assert len(far_end) == 100
        assert all(row.action == TaskActivityAction.BLOCKING_ADDED for row in far_end)
    assert len(inserts) == 1
