"""Live sockets keep permission, tenant and parent-privacy behavior for notes, tasks and events."""

import asyncio
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock
from uuid import UUID

import pytest
import pytest_asyncio
from sqlalchemy import delete

from uniffy.core.auth.tokens import create_access_token
from uniffy.core.jobs.types import QueueName
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.notes.note import Note
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.sprint import Sprint as _Sprint  # noqa: F401 - FK metadata
from uniffy.core.models.projects.task import Task
from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime import ws_routes
from uniffy.core.realtime.adapter import register_realtime_adapter
from uniffy.core.realtime.auth import WS_CLOSE_FORBIDDEN
from uniffy.core.realtime.buffer import UpdateBuffer
from uniffy.core.realtime.markdown import markdown_text
from uniffy.core.realtime.session import run_multiplexed_session
from uniffy.core.realtime.state import DocKey, WSSession
from uniffy.core.realtime.storage import lock_document, stage_seed
from uniffy.core.realtime.wire import (
    MESSAGE_ACCEPTED_RECEIPT,
    MESSAGE_ACK,
    MESSAGE_SEED_REJECTED,
    Y_MESSAGE_AUTH,
    YMessageType,
    YSyncMessageType,
    handle_sync_message,
)
from uniffy.core.realtime.ydoc_manager import YDocManager
from uniffy.core.search.indexer import SearchIndexer
from uniffy.core.types import AccessMode, ContentRole, ContentType, SubjectType, generate_id
from uniffy.domains.calls.channels import CallsLifecycle
from uniffy.domains.notes.adapter import NoteRealtimeAdapter
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.domains.permissions.members import ContentMembersOperations
from uniffy.domains.projects.realtime import TaskRealtimeAdapter
from uniffy.domains.scheduling.calendar.events.registration import register_calendar_content
from uniffy.domains.scheduling.calendar.realtime import EventRealtimeAdapter
from uniffy.infrastructure.database.session import open_session
from uniffy.infrastructure.valkey.queue import close_queue
from uniffy.tests.integration.access.realtime_live import (
    BUDGET,
    BufferedDocument,
    establish,
    fragment_edit,
    stored,
    text_of,
    typed,
)
from uniffy.tests.integration.access.test_realtime_live_routing import (
    Client,
    Socket,
    attach,
    denial,
    evicted,
    kinds,
    replica,
    resident_text,
    seed_proposal,
    session_state,
    upgrade_socket,
)

pytestmark = pytest.mark.asyncio(loop_scope="session")

LIVE_TYPES = (ContentType.NOTE, ContentType.TASK, ContentType.CALENDAR_EVENT)
_ADAPTERS = {
    ContentType.NOTE: NoteRealtimeAdapter,
    ContentType.TASK: TaskRealtimeAdapter,
    ContentType.CALENDAR_EVENT: EventRealtimeAdapter,
}


@dataclass
class SharedDocument:
    """A live document and the row whose members govern it: the project for a task."""

    doc: BufferedDocument
    policy: DocKey


async def create_document(
    access: Any, buffer: UpdateBuffer, content_type: ContentType, access_mode: AccessMode
) -> SharedDocument:
    """The member's note, task or event, seeded with ``base`` and bound to a fresh buffer epoch."""
    register_realtime_adapter(_ADAPTERS[content_type](AsyncMock(spec=SearchIndexer)))
    register_calendar_content()
    org, owner = access.org_id, access.member_id
    slug = f"parity-{generate_id().hex[-12:]}"
    policy: DocKey | None = None
    async with open_session() as db:
        row: Note | Task | CalendarEvent
        if content_type is ContentType.TASK:
            project = Project(
                organization_id=org,
                owner_id=owner,
                name="Parity",
                slug=slug,
                access_mode=access_mode,
                task_counter=1,
            )
            db.add(project)
            await db.flush()
            row = Task(
                organization_id=org,
                project_id=project.id,
                owner_id=owner,
                title="Parity",
                number=1,
                description="base",
            )
            policy = (ContentType.PROJECT, project.id)
        elif content_type is ContentType.CALENDAR_EVENT:
            calendar = Calendar(organization_id=org, owner_id=owner, name="Parity")
            db.add(calendar)
            await db.flush()
            start = datetime.now(UTC)
            row = CalendarEvent(
                organization_id=org,
                organizer_id=owner,
                calendar_id=calendar.id,
                title="Parity",
                description="base",
                start_time=start,
                end_time=start + timedelta(hours=1),
                access_mode=access_mode,
            )
        else:
            row = Note(
                organization_id=org,
                owner_id=owner,
                title="Parity",
                slug=slug,
                content="base",
                access_mode=access_mode,
            )
        db.add(row)
        await db.commit()
        key = (content_type, row.id)
        await lock_document(db, key, org)
        seeded = await stage_seed(db, key, org)
        await db.commit()
        base, generation = seeded.updates, seeded.generation
    assert generation is not None
    document = BufferedDocument(
        key=key,
        org=org,
        owner=owner,
        peer=access.peer_id,
        namespace=buffer.namespace,
        buffer=buffer,
        base=base,
        generation=generation,
        head=await establish(buffer, key, org),
    )
    return SharedDocument(document, policy or key)


async def discard(key: DocKey) -> None:
    async with open_session() as db:
        await db.execute(
            delete(RealtimeYjsSnapshot).where(
                RealtimeYjsSnapshot.content_type == key[0],
                RealtimeYjsSnapshot.content_id == key[1],
            )
        )
        await db.commit()


@pytest_asyncio.fixture(loop_scope="session", autouse=True)
async def without_job_queues() -> AsyncIterator[None]:
    """Permission changes enqueue notifications; the shared dev worker must never run them.

    An earlier test in the session may have opened the process queue pools on demand.
    """
    for name in QueueName:
        await close_queue(name)
    yield
    for name in QueueName:
        await close_queue(name)


@pytest_asyncio.fixture(loop_scope="session")
async def buffer(valkey_namespace: str) -> UpdateBuffer:
    return UpdateBuffer(namespace=valkey_namespace, pending_budget_bytes=BUDGET)


@pytest_asyncio.fixture(
    loop_scope="session", params=LIVE_TYPES, ids=[kind.value.lower() for kind in LIVE_TYPES]
)
async def shared(
    request: pytest.FixtureRequest, access: Any, buffer: UpdateBuffer
) -> AsyncIterator[SharedDocument]:
    """An explicitly shared document; the test grants the peer its role."""
    document = await create_document(access, buffer, request.param, AccessMode.EXPLICIT_MEMBERS)
    try:
        yield document
    finally:
        await discard(document.doc.key)


@pytest_asyncio.fixture(loop_scope="session")
async def manager(shared: SharedDocument) -> AsyncIterator[YDocManager]:
    manager = replica(shared.doc.buffer)
    yield manager
    await manager.stop_for_shutdown()
    await evicted(manager, shared.doc.key)


def _members(db: Any) -> ContentMembersOperations:
    return ContentMembersOperations(db, AsyncMock(spec=SearchIndexer))


async def share(document: SharedDocument, role: ContentRole) -> None:
    async with open_session() as db:
        await _members(db).add_member(
            document.doc.owner,
            document.doc.org,
            *document.policy,
            SubjectType.USER,
            document.doc.peer,
            role,
        )


async def change_role(document: SharedDocument, role: ContentRole) -> None:
    async with open_session() as db:
        await _members(db).update_member_role(
            document.doc.owner,
            document.doc.org,
            *document.policy,
            SubjectType.USER,
            document.doc.peer,
            role,
        )


async def unshare(document: SharedDocument) -> None:
    async with open_session() as db:
        await _members(db).remove_member(
            document.doc.owner,
            document.doc.org,
            *document.policy,
            SubjectType.USER,
            document.doc.peer,
        )


async def make_private(document: SharedDocument) -> None:
    async with open_session() as db:
        await _members(db).set_access_mode(
            document.doc.owner,
            document.doc.org,
            *document.policy,
            AccessMode.OWNER_ONLY,
            remove_members_on_narrow=True,
        )


async def leave_organization(access: Any, user: UUID) -> None:
    async with open_session() as db:
        assert await OrganizationOperations(db).remove_member(
            access.owner_id,
            access.org_id,
            user,
            search_indexer=AsyncMock(spec=SearchIndexer),
            call_lifecycle=CallsLifecycle(open_session),
        )


def connect(manager: YDocManager, key: DocKey, organization: UUID, user: UUID) -> Client:
    """A socket that has not attached ``key`` yet; its first frame for it attaches."""
    socket = Socket()
    session = WSSession(
        user_id=user,
        organization_id=organization,
        token_version=1,
        conn_id=id(socket),
        ws=socket,
    )
    task = asyncio.create_task(run_multiplexed_session(socket, session, manager))
    return Client(socket, task, key)


async def refused(
    manager: YDocManager, document: BufferedDocument, user: UUID, organization: UUID | None = None
) -> tuple[Client, tuple[int, str]]:
    """Attempt an attach and return the denial, after proving nothing else reached the client."""
    client = connect(manager, document.key, organization or document.org, user)
    client.sync()
    frame, seen = await client.until(Y_MESSAGE_AUTH)
    assert seen == []
    return client, denial(frame)


def text(client: Client) -> str:
    return str(markdown_text(client.doc))


def write_own(client: Client, update_id: str, update: bytes, generation: str) -> None:
    """Send an edit the way an editor does: it is already in the client's own document."""
    client.doc.apply_update(update)
    client.write(update_id, update, generation)


def sync_steps(frames: list[bytes]) -> list[int]:
    return [frame[1] for frame in frames if frame[0] == YMessageType.SYNC]


@pytest.mark.parametrize("write", ["durable_update", "seed_proposal"])
async def test_viewer_write_is_refused_and_appends_nothing(
    shared: SharedDocument, manager: YDocManager, write: str
) -> None:
    doc = shared.doc
    await share(shared, ContentRole.VIEWER)
    before = await stored(doc.key)
    viewer, frames = await attach(manager, doc, doc.peer)
    try:
        assert [denial(frame) for frame in frames if frame[0] == Y_MESSAGE_AUTH] == [
            (0, "read only")
        ]
        if write == "seed_proposal":
            proposal = fragment_edit(doc.base, text="base", claim="viewer")
            viewer.send(seed_proposal(doc.generation, "seed-1", "token", "base", proposal))
        else:
            viewer.write("edit-1", typed(doc.base, suffix=" viewer"), doc.generation)
        refusal, seen = await viewer.until(Y_MESSAGE_AUTH)

        assert denial(refusal) == (0, "edit denied")
        assert {MESSAGE_ACCEPTED_RECEIPT, MESSAGE_ACK, MESSAGE_SEED_REJECTED}.isdisjoint(kinds(seen))
        assert await doc.stream_ids() == []
        assert resident_text(manager, doc.key) == "base"
        after = await stored(doc.key)
        assert (after.revision, after.updates, after.seed_owner) == (
            before.revision,
            before.updates,
            before.seed_owner,
        )
    finally:
        await viewer.leave()


async def test_tail_reaches_a_later_viewer_through_sync_and_never_through_admission(
    shared: SharedDocument, manager: YDocManager
) -> None:
    doc = shared.doc
    await share(shared, ContentRole.VIEWER)
    before = await stored(doc.key)
    # The viewer's replica never admitted or heard of the edit; only the buffer holds it.
    elsewhere = replica(doc.buffer)
    editor, _ = await attach(manager, doc)
    try:
        editor.write("edit-1", typed(doc.base, suffix=" typed"), doc.generation)
        assert (await editor.receipt()).accepted_sequence == 1
        viewer, frames = await attach(elsewhere, doc, doc.peer)
        try:
            # The tail arrives in the answer to the viewer's own SyncStep1, not as a live update.
            assert text(viewer) == "base typed"
            assert session_state(frames).head_sequence == 1
            assert sync_steps(frames) == [YSyncMessageType.SYNC_STEP1]
            assert MESSAGE_ACCEPTED_RECEIPT not in kinds(frames)

            server_step1 = next(frame for frame in frames if frame[0] == YMessageType.SYNC)
            draft = markdown_text(viewer.doc)
            draft.insert(len(str(draft)), " viewer")
            reply = handle_sync_message(server_step1[1:], viewer.doc)
            assert reply is not None
            viewer.send(reply)
            refusal, seen = await viewer.until(Y_MESSAGE_AUTH)

            assert denial(refusal) == (0, "edit denied")
            assert MESSAGE_ACCEPTED_RECEIPT not in kinds(seen)
            assert await doc.stream_ids() == [b"1-0"]
            assert resident_text(elsewhere, doc.key) == "base typed"
            after = await stored(doc.key)
            assert (after.revision, after.updates) == (before.revision, before.updates)
        finally:
            await viewer.leave()
            await evicted(elsewhere, doc.key)
    finally:
        await editor.leave()


@pytest.mark.parametrize("loss", ["downgraded", "removed", "blocked"])
async def test_editor_losing_access_mid_session_is_cut_off_without_pubsub(
    shared: SharedDocument, manager: YDocManager, loss: str
) -> None:
    doc = shared.doc
    await share(shared, ContentRole.EDITOR)
    author, _ = await attach(manager, doc)
    observer, _ = await attach(manager, doc)
    editor, frames = await attach(manager, doc, doc.peer)
    try:
        assert Y_MESSAGE_AUTH not in kinds(frames)
        mine = typed(doc.base, suffix=" mine")
        write_own(editor, "edit-1", mine, doc.generation)
        assert (await editor.receipt()).accepted_sequence == 1
        await observer.text("base mine")

        if loss == "downgraded":
            await change_role(shared, ContentRole.VIEWER)
        elif loss == "blocked":
            await change_role(shared, ContentRole.BLOCKED)
        else:
            await unshare(shared)
        # No router runs here; the next disclosure reads PostgreSQL afresh for every recipient.
        later = typed(doc.base, mine, suffix=" later")
        author.write("author-1", later, doc.generation)
        assert (await author.receipt()).accepted_sequence == 2
        await observer.text("base mine later")
        refusal, seen = await editor.until(Y_MESSAGE_AUTH)
        retry = typed(doc.base, mine, later, suffix=" again")

        if loss == "downgraded":
            assert denial(refusal) == (0, "edit access removed")
            assert text(editor) == "base mine later"
            editor.write("edit-2", retry, doc.generation)
            refusal, seen = await editor.until(Y_MESSAGE_AUTH)
            assert denial(refusal) == (0, "edit denied")
            assert MESSAGE_ACCEPTED_RECEIPT not in kinds(seen)
        else:
            assert denial(refusal) == (1, "access revoked")
            assert YMessageType.SYNC not in kinds(seen)
            assert text(editor) == "base mine"
            editor.write("edit-2", retry, doc.generation)
            assert await editor.drain() == []

        assert await doc.stream_ids() == [b"1-0", b"2-0"]
        assert resident_text(manager, doc.key) == "base mine later"
        # Only the document detached; the socket stays open for others.
        assert editor.socket.closes == []
    finally:
        await editor.leave()
        await observer.leave()
        await author.leave()


@pytest.mark.parametrize("loss", ["downgraded", "removed", "membership_removed"])
async def test_retained_replay_after_losing_access_is_refused_and_appends_nothing(
    shared: SharedDocument, manager: YDocManager, access: Any, loss: str
) -> None:
    doc = shared.doc
    await share(shared, ContentRole.EDITOR)
    editor, _ = await attach(manager, doc, doc.peer)
    accepted = typed(doc.base, suffix=" accepted")
    editor.write("edit-1", accepted, doc.generation)
    assert (await editor.receipt()).accepted_sequence == 1
    # The client keeps both edits on the device: one accepted, one never sent.
    retained = typed(doc.base, accepted, suffix=" retained")
    await editor.leave()
    await evicted(manager, doc.key)
    before = await stored(doc.key)

    if loss == "downgraded":
        await change_role(shared, ContentRole.VIEWER)
    elif loss == "removed":
        await unshare(shared)
    else:
        await leave_organization(access, doc.peer)

    if loss == "membership_removed":
        socket = upgrade_socket(create_access_token(doc.peer, doc.org, token_version=1))
        await ws_routes.realtime(socket, doc.org)
        assert socket.subprotocols == []
        assert socket.closes == [(WS_CLOSE_FORBIDDEN, "not a member")]
    else:
        client = connect(manager, doc.key, doc.org, doc.peer)
        try:
            client.sync()
            client.write("edit-1", accepted, doc.generation)
            client.write("edit-2", retained, doc.generation)
            if loss == "downgraded":
                frames: list[bytes] = []
                for _ in range(2):
                    refusal, seen = await client.until(
                        Y_MESSAGE_AUTH, lambda payload: denial(payload)[1] == "edit denied"
                    )
                    frames += seen
                assert MESSAGE_ACCEPTED_RECEIPT not in kinds(frames)
                assert (0, "read only") in [denial(f) for f in frames if f[0] == Y_MESSAGE_AUTH]
                assert resident_text(manager, doc.key) == "base accepted"
            else:
                refusal, seen = await client.until(Y_MESSAGE_AUTH)
                assert (denial(refusal), seen) == ((1, "no view access"), [])
                assert await client.drain() == []
                assert manager.resident(doc.key) is None
        finally:
            await client.leave()

    assert await doc.stream_ids() == [b"1-0"]
    after = await stored(doc.key)
    assert (after.revision, after.updates) == (before.revision, before.updates)
    assert text_of(after.updates) == "base"


async def test_retained_edit_sent_after_membership_loss_on_an_open_socket_is_refused(
    shared: SharedDocument, manager: YDocManager, access: Any
) -> None:
    doc = shared.doc
    await share(shared, ContentRole.EDITOR)
    editor, _ = await attach(manager, doc, doc.peer)
    try:
        accepted = typed(doc.base, suffix=" accepted")
        editor.write("edit-1", accepted, doc.generation)
        assert (await editor.receipt()).accepted_sequence == 1
        before = await stored(doc.key)
        await leave_organization(access, doc.peer)

        editor.write("edit-2", typed(doc.base, accepted, suffix=" retained"), doc.generation)
        refusal, seen = await editor.until(Y_MESSAGE_AUTH)

        assert denial(refusal) == (1, "access revoked")
        assert MESSAGE_ACCEPTED_RECEIPT not in kinds(seen)
        editor.write("edit-3", typed(doc.base, accepted, suffix=" again"), doc.generation)
        assert await editor.drain() == []
        assert await doc.stream_ids() == [b"1-0"]
        after = await stored(doc.key)
        assert (after.revision, after.updates) == (before.revision, before.updates)
    finally:
        await editor.leave()


@pytest.mark.parametrize("intruder", ["other_org_owner", "document_owner"])
async def test_document_of_another_organization_is_unreachable(
    shared: SharedDocument, manager: YDocManager, access: Any, intruder: str
) -> None:
    doc = shared.doc
    user = access.outsider_id
    if intruder == "document_owner":
        # The document's own owner joins the other organization; that socket stays bound there.
        user = doc.owner
        async with open_session() as db:
            await OrganizationOperations(db).add_member(
                doc.owner,
                access.other_org_id,
                actor_user_id=access.outsider_id,
                search_indexer=AsyncMock(spec=SearchIndexer),
            )
    owner, _ = await attach(manager, doc)
    try:
        owner.write("edit-1", typed(doc.base, suffix=" private"), doc.generation)
        await owner.receipt()
        foreign, refusal = await refused(manager, doc, user, access.other_org_id)
        try:
            assert refusal == (1, "no view access")
            foreign.write("edit-2", typed(doc.base, suffix=" foreign"), doc.generation)
            assert await foreign.drain() == []
            assert await doc.stream_ids() == [b"1-0"]
            assert resident_text(manager, doc.key) == "base private"
        finally:
            await foreign.leave()
    finally:
        await owner.leave()


async def test_task_under_a_private_project_is_not_disclosed(
    access: Any, buffer: UpdateBuffer
) -> None:
    task = (await create_document(access, buffer, ContentType.TASK, AccessMode.OWNER_ONLY)).doc
    manager = replica(buffer)
    try:
        owner, _ = await attach(manager, task)
        try:
            owner.write("edit-1", typed(task.base, suffix=" private"), task.generation)
            await owner.receipt()
            # A member, an org admin and the org owner: none reaches a private project's task.
            for user in (access.peer_id, access.admin_id, access.owner_id):
                client, refusal = await refused(manager, task, user)
                try:
                    assert refusal == (1, "no view access")
                    client.write("edit-2", typed(task.base, suffix=" leak"), task.generation)
                    assert await client.drain() == []
                finally:
                    await client.leave()
            assert await task.stream_ids() == [b"1-0"]
            assert resident_text(manager, task.key) == "base private"
        finally:
            await owner.leave()
            await evicted(manager, task.key)
    finally:
        await discard(task.key)
