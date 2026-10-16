"""Task description writes, recurring copies and deletions over live buffered tails."""

from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from typing import Any
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

import pytest
import pytest_asyncio
from connectrpc.code import Code
from connectrpc.errors import ConnectError
from sqlalchemy import delete, select
from uniffy_proto.projects.v1.projects_pb import UpdateTaskRequest

from uniffy.core.models.projects.field_definition import FieldDefinition, TaskStatusSemantic
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.sprint import Sprint as _Sprint  # noqa: F401 - FK metadata
from uniffy.core.models.projects.task import Task
from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime.adapter import register_realtime_adapter
from uniffy.core.realtime.buffer import UpdateBuffer
from uniffy.core.realtime.buffer_keys import AdmissionStatus
from uniffy.core.realtime.live import LiveStateUnavailable
from uniffy.core.realtime.storage import EditDenied, load_snapshot, lock_document, stage_seed
from uniffy.core.search.indexer import SearchIndexer
from uniffy.core.storage import ObjectStorage
from uniffy.core.types import AccessMode, ContentType, generate_id
from uniffy.domains.projects.defaults import stage_default_project_fields
from uniffy.domains.projects.projects import ProjectOperations
from uniffy.domains.projects.realtime import TaskRealtimeAdapter
from uniffy.domains.projects.recurrence import serialize_recurrence_config
from uniffy.domains.projects.service import ProjectsServiceImpl
from uniffy.domains.projects.statuses import load_task_status_semantics
from uniffy.domains.projects.tasks.content import TaskContentOperations
from uniffy.domains.projects.tasks.mutations import TaskMutationOperations
from uniffy.infrastructure.database.session import open_session
from uniffy.tests.integration.access.realtime_live import (
    BUDGET,
    BufferedDocument,
    buffering_disabled,
    doc_subscription,
    establish,
    published_progress,
    stored,
    text_of,
    typed,
    unreachable,
)
from uniffy.tests.integration.access.rpc_calls import call_rpc

pytestmark = pytest.mark.asyncio(loop_scope="session")


@dataclass
class LiveProject:
    id: UUID
    tasks: list[BufferedDocument]

    @property
    def buffer(self) -> UpdateBuffer:
        return self.tasks[0].buffer


@pytest_asyncio.fixture(loop_scope="session")
async def live_project(access, valkey_namespace) -> AsyncIterator[LiveProject]:
    """A member's project whose two task descriptions are seeded and bound to buffer epochs."""
    register_realtime_adapter(TaskRealtimeAdapter(AsyncMock()))
    async with open_session() as db:
        project = Project(
            organization_id=access.org_id,
            owner_id=access.member_id,
            name="Live project",
            slug=f"live-{generate_id().hex[-12:]}",
            access_mode=AccessMode.OWNER_ONLY,
            task_counter=2,
        )
        db.add(project)
        await db.flush()
        await stage_default_project_fields(db, project.id)
        rows = [
            Task(
                organization_id=access.org_id,
                project_id=project.id,
                owner_id=access.member_id,
                title=f"Task {number}",
                number=number,
                description="base",
            )
            for number in (1, 2)
        ]
        db.add_all(rows)
        await db.commit()
        project_id, task_ids = project.id, [row.id for row in rows]
    buffer = UpdateBuffer(namespace=valkey_namespace, pending_budget_bytes=BUDGET)
    tasks = []
    for task_id in task_ids:
        key = (ContentType.TASK, task_id)
        async with open_session() as db:
            await lock_document(db, key, access.org_id)
            seeded = await stage_seed(db, key, access.org_id)
            await db.commit()
            base, generation = seeded.updates, seeded.generation
        assert generation is not None
        tasks.append(
            BufferedDocument(
                key=key,
                org=access.org_id,
                owner=access.member_id,
                peer=access.peer_id,
                namespace=valkey_namespace,
                buffer=buffer,
                base=base,
                generation=generation,
                head=await establish(buffer, key, access.org_id),
            )
        )
    try:
        yield LiveProject(project_id, tasks)
    finally:
        async with open_session() as db:
            await db.execute(
                delete(RealtimeYjsSnapshot).where(
                    RealtimeYjsSnapshot.content_type == ContentType.TASK,
                    RealtimeYjsSnapshot.content_id.in_(task_ids),
                )
            )
            await db.execute(delete(FieldDefinition).where(FieldDefinition.project_id == project_id))
            await db.execute(delete(Task).where(Task.project_id == project_id))
            await db.execute(delete(Project).where(Project.id == project_id))
            await db.commit()


@pytest_asyncio.fixture(loop_scope="session")
async def project_outage(live_project) -> AsyncIterator[UpdateBuffer]:
    async with unreachable(live_project.buffer.namespace) as buffer:
        yield buffer


@pytest_asyncio.fixture(loop_scope="session")
async def task_messages(live_project) -> AsyncIterator[Any]:
    async with doc_subscription(live_project.tasks[0].key) as subscription:
        yield subscription


async def update_task(task: BufferedDocument, buffer: UpdateBuffer, **fields: Any) -> Task:
    async with open_session() as db:
        content = TaskContentOperations(db, storage=MagicMock(), search_indexer=AsyncMock())
        updated, _ = await TaskMutationOperations(db, content, buffer).update(
            task.owner, task.org, task.key[1], **fields
        )
    return updated


async def update_task_rpc(task: BufferedDocument, **fields: Any) -> None:
    """Call the UpdateTask RPC as the task's owner, against the task's buffer."""
    service = ProjectsServiceImpl(MagicMock(spec=ObjectStorage), AsyncMock(spec=SearchIndexer))
    service.buffer = task.buffer
    request = UpdateTaskRequest(task_id=str(task.key[1]), organization_id=str(task.org), **fields)
    await call_rpc(service.update_task, request, user_id=task.owner, organization_id=task.org)


async def task_row(task: BufferedDocument) -> Task:
    async with open_session() as db:
        row = await db.scalar(select(Task).where(Task.id == task.key[1]))
    assert row is not None
    return row


def checkpoint_of(row: RealtimeYjsSnapshot) -> tuple:
    return (
        row.updates,
        row.revision,
        row.rendered_revision,
        row.checkpoint_seq,
        row.buffer_epoch,
        row.actor_id,
    )


async def test_description_write_with_a_stale_base_merges_into_the_buffered_tail(
    live_project: LiveProject, task_messages
) -> None:
    task = live_project.tasks[0]
    bob = typed(task.base, suffix=" Bob")
    await task.admit("u-bob", bob, task.peer)
    before = await stored(task.key)

    updated = await update_task(task, task.buffer, description="Intro base", base_description="base")

    assert updated.description == "Intro base Bob"
    row = await stored(task.key)
    assert text_of(row.updates) == "Intro base Bob"
    assert (row.generation, row.checkpoint_seq, row.actor_id) == (task.generation, 1, task.owner)
    assert row.revision == row.rendered_revision == before.revision + 1
    assert (await task.buffer_state())["stream"] == []
    assert await published_progress(task_messages) == [
        {
            "generation": task.generation,
            "epoch": task.head.scope.epoch,
            "covered_sequence": 1,
            "checkpoint_revision": row.revision,
        }
    ]
    # Editors that saw the merged text keep appending to the same epoch.
    assert await task.admit("u-later", typed(row.updates, suffix=" later")) == 2


@pytest.mark.parametrize(
    "fields",
    [
        {"due_date": "2026-12-01", "is_milestone": True},
        {"due_date": "2026-12-01", "description": "base", "base_description": "base"},
    ],
    ids=["metadata", "unchanged-description"],
)
@pytest.mark.parametrize("reachable", [True, False], ids=["valkey", "valkey-down"])
async def test_metadata_save_leaves_the_tail_and_checkpoint_untouched(
    live_project: LiveProject, project_outage: UpdateBuffer, fields: dict, reachable: bool
) -> None:
    task = live_project.tasks[0]
    await task.admit("u-bob", typed(task.base, suffix=" Bob"), task.peer)
    before = await stored(task.key)
    buffered = await task.buffer_state()

    await update_task(task, task.buffer if reachable else project_outage, **fields)

    saved = await task_row(task)
    assert (saved.due_date, saved.description) == ("2026-12-01", "base")
    assert checkpoint_of(await stored(task.key)) == checkpoint_of(before)
    assert await task.buffer_state() == buffered


async def test_unreachable_valkey_refuses_description_writes_and_keeps_task_and_tail(
    live_project: LiveProject, project_outage: UpdateBuffer
) -> None:
    task = live_project.tasks[0]
    await task.admit("u-bob", typed(task.base, suffix=" Bob"), task.peer)
    before_task = await task_row(task)
    before = await stored(task.key)
    buffered = await task.buffer_state()

    with pytest.raises(LiveStateUnavailable):
        await update_task(
            task, project_outage, title="Renamed", description="Intro base", base_description="base"
        )

    saved = await task_row(task)
    assert (saved.title, saved.description, saved.version) == (
        before_task.title,
        "base",
        before_task.version,
    )
    assert checkpoint_of(await stored(task.key)) == checkpoint_of(before)
    assert await task.buffer_state() == buffered


async def test_update_task_rpc_answers_retryably_while_live_edits_cannot_be_verified(
    live_project: LiveProject,
) -> None:
    task = live_project.tasks[0]
    await task.admit("u-bob", typed(task.base, suffix=" Bob"), task.peer)
    before_task = await task_row(task)
    before = await stored(task.key)
    buffered = await task.buffer_state()

    async with buffering_disabled():
        with pytest.raises(ConnectError) as refused:
            await update_task_rpc(
                task, title="Renamed", description="Intro base", base_description="base"
            )

    assert refused.value.code is Code.UNAVAILABLE
    saved = await task_row(task)
    assert (saved.title, saved.description, saved.version) == (
        before_task.title,
        "base",
        before_task.version,
    )
    assert checkpoint_of(await stored(task.key)) == checkpoint_of(before)
    assert await task.buffer_state() == buffered


async def delete_first_task(
    project: LiveProject, buffer: UpdateBuffer, permanent: bool
) -> list[BufferedDocument]:
    task = project.tasks[0]
    async with open_session() as db:
        content = TaskContentOperations(db, storage=MagicMock(), search_indexer=AsyncMock())
        await TaskMutationOperations(db, content, buffer).delete(
            task.owner, task.org, task.key[1], permanent=permanent
        )
    return [task]


async def delete_project(
    project: LiveProject, buffer: UpdateBuffer, permanent: bool
) -> list[BufferedDocument]:
    owner, org = project.tasks[0].owner, project.tasks[0].org
    async with open_session() as db:
        await ProjectOperations(db, MagicMock(), AsyncMock()).delete(
            owner, org, project.id, permanent=permanent, buffer=buffer
        )
    return project.tasks


Deleter = Callable[[LiveProject, UpdateBuffer, bool], Awaitable[list[BufferedDocument]]]


@pytest.mark.parametrize("permanent", [False, True], ids=["trash", "permanent"])
@pytest.mark.parametrize("deleter", [delete_first_task, delete_project], ids=["task", "project"])
async def test_deletion_retires_pending_task_tails_and_refuses_later_appends(
    live_project: LiveProject, deleter: Deleter, permanent: bool
) -> None:
    edits = {}
    for task in live_project.tasks:
        edits[task.key] = typed(task.base, suffix=" pending")
        await task.admit("u-pending", edits[task.key], task.peer)

    deleted = await deleter(live_project, live_project.buffer, permanent)

    for task in live_project.tasks:
        if task not in deleted:
            assert (await task.buffer_state())["stream"] == [b"1-0"]
            continue
        async with open_session() as db:
            assert await load_snapshot(db, task.key) is None
        assert await task.buffer_state() == {
            "stream": [],
            "control": 0,
            "receipts": [],
            "due": None,
        }
        late = typed(task.base, edits[task.key], suffix=" late")
        refused = await task.buffer.admit(
            task.head, update_id="u-late", update=late, actor_id=task.owner
        )
        assert refused.status is AdmissionStatus.RECOVERY_REQUIRED
        with pytest.raises(EditDenied):
            await task.admit_live("u-late", late)


@pytest.mark.parametrize("deleter", [delete_first_task, delete_project], ids=["task", "project"])
async def test_deletion_commits_while_valkey_is_unreachable(
    live_project: LiveProject, project_outage: UpdateBuffer, deleter: Deleter
) -> None:
    for task in live_project.tasks:
        await task.admit("u-pending", typed(task.base, suffix=" pending"), task.peer)

    deleted = await deleter(live_project, project_outage, False)

    for task in deleted:
        async with open_session() as db:
            assert await load_snapshot(db, task.key) is None
        # The tails could not be retired, so PostgreSQL authorization alone refuses the append.
        with pytest.raises(EditDenied):
            await task.admit_live("u-late", typed(task.base, suffix=" late"))


async def spawn_after(task: BufferedDocument, buffer: UpdateBuffer) -> Task:
    """Complete ``task`` as a daily series through an ordinary update against ``buffer``."""
    async with open_session() as db:
        series = await db.get(Task, task.key[1])
        assert series is not None
        series.recurrence_rule = serialize_recurrence_config({"pattern": "DAILY"})
        series.due_date = "2026-12-01"
        await db.commit()
        semantics = await load_task_status_semantics(db, series.project_id)
        content = TaskContentOperations(db, storage=MagicMock(), search_indexer=AsyncMock())
        _, spawned = await TaskMutationOperations(db, content, buffer).update(
            task.owner, task.org, task.key[1], status=semantics.id_for(TaskStatusSemantic.COMPLETED)
        )
    assert spawned is not None
    return spawned


async def test_recurring_spawn_copies_the_buffered_description_and_leaves_the_tail_pending(
    live_project: LiveProject,
) -> None:
    task = live_project.tasks[0]
    await task.admit("u-bob", typed(task.base, suffix=" Bob"), task.peer)
    before = await stored(task.key)
    buffered = await task.buffer_state()

    spawned = await spawn_after(task, task.buffer)

    assert (spawned.due_date, spawned.description) == ("2026-12-02", "base Bob")
    assert (await task_row(task)).description == "base"
    assert checkpoint_of(await stored(task.key)) == checkpoint_of(before)
    assert await task.buffer_state() == buffered


async def test_recurring_spawn_starts_from_the_stored_description_while_valkey_is_unreachable(
    live_project: LiveProject, project_outage: UpdateBuffer
) -> None:
    task = live_project.tasks[0]
    await task.admit("u-bob", typed(task.base, suffix=" Bob"), task.peer)
    buffered = await task.buffer_state()

    spawned = await spawn_after(task, project_outage)

    # The series continues; the completed task keeps Bob's edit for its own checkpoint.
    assert spawned.description == "base"
    assert await task.buffer_state() == buffered
