"""Live sockets keep permission, tenant and parent-privacy behavior for notes, tasks and events."""

import asyncio
from collections.abc import AsyncIterator
from typing import Any
from uuid import UUID

import pytest
import pytest_asyncio
from sqlalchemy import update

from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.realtime import ws_routes
from uniffy.core.realtime.adapter import get_realtime_adapter, register_realtime_adapter
from uniffy.core.realtime.auth import WS_CLOSE_FORBIDDEN
from uniffy.core.realtime.buffer import UpdateBuffer
from uniffy.core.realtime.markdown import markdown_text
from uniffy.core.realtime.publisher import publish_perm_change
from uniffy.core.realtime.wire import (
    MESSAGE_ACCEPTED_RECEIPT,
    MESSAGE_COMMITTED,
    MESSAGE_QUERY_AWARENESS,
    MESSAGE_SEED_REJECTED,
    Y_MESSAGE_AUTH,
    YMessageType,
    create_update_message,
)
from uniffy.core.realtime.ydoc_manager import YDocManager
from uniffy.core.types import AccessMode, ContentRole, ContentType
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.infrastructure.database.session import open_session
from uniffy.tests.integration.access.realtime_documents import (
    SharedDocument,
    change_role,
    create_document,
    discard,
    leave_organization,
    share,
    unshare,
)
from uniffy.tests.integration.access.realtime_live import (
    BufferedDocument,
    fragment_edit,
    stored,
    text_of,
    typed,
)
from uniffy.tests.integration.access.realtime_sockets import (
    FRAME_TIMEOUT,
    Client,
    attach,
    attached,
    bearer,
    connect,
    denial,
    evicted,
    kinds,
    replica,
    resident_text,
    routed,
    seed_proposal,
    session_state,
    subscribed,
    upgrade_socket,
)
from uniffy.tests.integration.access.recording_search import recording_indexer

pytestmark = pytest.mark.asyncio(loop_scope="session")


@pytest_asyncio.fixture(loop_scope="session")
async def manager(shared: SharedDocument) -> AsyncIterator[YDocManager]:
    manager = replica(shared.doc.buffer)
    yield manager
    await manager.drain_for_shutdown()
    await evicted(manager, shared.doc.key)


async def refused(
    manager: YDocManager, document: BufferedDocument, user: UUID, organization: UUID | None = None
) -> tuple[Client, tuple[int, str]]:
    """Attempt an attach and return the denial, after proving nothing else reached the client."""
    client = connect(manager, document.key, organization or document.org, user)
    client.sync()
    frame, seen = await client.until(Y_MESSAGE_AUTH)
    assert seen == []
    return client, denial(frame)


@pytest.mark.parametrize("write", ["update", "seed_proposal"])
async def test_viewer_write_is_refused_and_appends_nothing(
    shared: SharedDocument, manager: YDocManager, write: str
) -> None:
    doc = shared.doc
    await share(shared, ContentRole.VIEWER)
    before = await stored(doc.key)
    async with attached(manager, doc, doc.peer) as (viewer, frames):
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
        assert {MESSAGE_ACCEPTED_RECEIPT, MESSAGE_COMMITTED, MESSAGE_SEED_REJECTED}.isdisjoint(
            kinds(seen)
        )
        assert await doc.stream_ids() == []
        assert resident_text(manager, doc.key) == "base"
        after = await stored(doc.key)
        assert (after.revision, after.updates, after.seed_owner) == (
            before.revision,
            before.updates,
            before.seed_owner,
        )


async def test_tail_reaches_a_later_viewer_through_sync_and_never_through_admission(
    shared: SharedDocument, manager: YDocManager
) -> None:
    doc = shared.doc
    await share(shared, ContentRole.VIEWER)
    before = await stored(doc.key)
    # The viewer's replica never admitted or heard of the edit; only the buffer holds it.
    elsewhere = replica(doc.buffer)
    async with attached(manager, doc) as (editor, _):
        editor.write("edit-1", typed(doc.base, suffix=" typed"), doc.generation)
        assert (await editor.receipt()).accepted_sequence == 1
        async with attached(elsewhere, doc, doc.peer) as (viewer, frames):
            # The tail arrives in the answer to the viewer's own SyncStep1, not as a live update,
            # and nothing asks a viewer for its state.
            assert viewer.markdown == "base typed"
            assert session_state(frames).head_sequence == 1
            assert YMessageType.SYNC not in kinds(frames)
            assert MESSAGE_ACCEPTED_RECEIPT not in kinds(frames)

            draft = markdown_text(viewer.doc)
            before_draft = viewer.doc.get_state()
            draft.insert(len(str(draft)), " viewer")
            viewer.send(create_update_message(viewer.doc.get_update(before_draft)))
            refusal, seen = await viewer.until(Y_MESSAGE_AUTH)

            assert denial(refusal) == (0, "edit denied")
            assert MESSAGE_ACCEPTED_RECEIPT not in kinds(seen)
            assert await doc.stream_ids() == [b"1-0"]
            assert resident_text(elsewhere, doc.key) == "base typed"
            after = await stored(doc.key)
            assert (after.revision, after.updates) == (before.revision, before.updates)
        await evicted(elsewhere, doc.key)


@pytest.mark.parametrize("loss", ["downgraded", "removed", "blocked"])
async def test_editor_losing_access_mid_session_is_cut_off_without_pubsub(
    shared: SharedDocument, manager: YDocManager, loss: str
) -> None:
    doc = shared.doc
    await share(shared, ContentRole.EDITOR)
    async with (
        attached(manager, doc) as (author, _),
        attached(manager, doc) as (observer, _),
        attached(manager, doc, doc.peer) as (editor, frames),
    ):
        assert Y_MESSAGE_AUTH not in kinds(frames)
        mine = typed(doc.base, suffix=" mine")
        editor.write_own("edit-1", mine, doc.generation)
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
            assert editor.markdown == "base mine later"
            editor.write("edit-2", retry, doc.generation)
            refusal, seen = await editor.until(Y_MESSAGE_AUTH)
            assert denial(refusal) == (0, "edit denied")
            assert MESSAGE_ACCEPTED_RECEIPT not in kinds(seen)
        else:
            assert denial(refusal) == (1, "access revoked")
            assert YMessageType.SYNC not in kinds(seen)
            assert editor.markdown == "base mine"
            editor.write("edit-2", retry, doc.generation)
            assert await editor.drain() == []

        assert await doc.stream_ids() == [b"1-0", b"2-0"]
        assert resident_text(manager, doc.key) == "base mine later"
        # Only the document detached; the socket stays open for others.
        assert editor.socket.closes == []


@pytest.mark.parametrize("loss", ["downgraded", "removed", "membership_removed"])
async def test_retained_replay_after_losing_access_is_refused_and_appends_nothing(
    shared: SharedDocument, manager: YDocManager, access: Any, loss: str
) -> None:
    doc = shared.doc
    await share(shared, ContentRole.EDITOR)
    accepted = typed(doc.base, suffix=" accepted")
    async with attached(manager, doc, doc.peer) as (editor, _):
        editor.write("edit-1", accepted, doc.generation)
        assert (await editor.receipt()).accepted_sequence == 1
    # The client keeps both edits on the device: one accepted, one never sent.
    retained = typed(doc.base, accepted, suffix=" retained")
    await evicted(manager, doc.key)
    before = await stored(doc.key)

    if loss == "downgraded":
        await change_role(shared, ContentRole.VIEWER)
    elif loss == "removed":
        await unshare(shared)
    else:
        await leave_organization(access, doc.peer)

    if loss == "membership_removed":
        socket = upgrade_socket(bearer(doc.peer, doc.org))
        await ws_routes.serve_realtime(socket, doc.org, manager)
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
    async with attached(manager, doc, doc.peer) as (editor, _):
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
                search_indexer=recording_indexer(),
            )
    async with attached(manager, doc) as (owner, _):
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


async def test_task_under_a_private_project_is_not_disclosed(
    access: Any, buffer: UpdateBuffer
) -> None:
    task = (await create_document(access, buffer, ContentType.TASK, AccessMode.OWNER_ONLY)).doc
    manager = replica(buffer)
    try:
        async with attached(manager, task) as (owner, _):
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
        await evicted(manager, task.key)
    finally:
        await discard(task.key)


@pytest.mark.parametrize("loss", ["downgraded", "removed"])
async def test_editor_learns_lost_access_from_the_role_its_own_write_reads(
    shared: SharedDocument, manager: YDocManager, loss: str
) -> None:
    doc = shared.doc
    await share(shared, ContentRole.EDITOR)
    async with attached(manager, doc, doc.peer) as (editor, frames):
        assert Y_MESSAGE_AUTH not in kinds(frames)
        # PostgreSQL changes alone: no signal, no disclosure and no watchdog pass in between.
        if loss == "downgraded":
            await change_role(shared, ContentRole.VIEWER)
        else:
            await unshare(shared)
        editor.write("edit-1", typed(doc.base, suffix=" late"), doc.generation)

        first, seen = await editor.until(Y_MESSAGE_AUTH)
        if loss == "downgraded":
            assert denial(first) == (0, "edit access removed")
            second, _ = await editor.until(Y_MESSAGE_AUTH)
            assert denial(second) == (0, "edit denied")
        else:
            assert denial(first) == (1, "access revoked")
            assert Y_MESSAGE_AUTH not in kinds(await editor.drain())
        assert MESSAGE_ACCEPTED_RECEIPT not in kinds(seen)
        assert await doc.stream_ids() == []


async def test_published_role_is_reread_instead_of_trusted(shared: SharedDocument) -> None:
    doc = shared.doc
    await share(shared, ContentRole.EDITOR)
    async with (
        routed(doc, 1) as (manager,),
        attached(manager, doc, doc.peer) as (editor, frames),
    ):
        await subscribed(editor, session_state(frames))
        await editor.drain()
        # The role drops in PostgreSQL alone; the only signal claims the old role.
        async with open_session() as db:
            await db.execute(
                update(ContentMember)
                .where(
                    ContentMember.content_id == shared.policy[1],
                    ContentMember.subject_id == doc.peer,
                )
                .values(role=ContentRole.VIEWER)
            )
            await db.commit()
        await publish_perm_change(*shared.policy, doc.peer, ContentRole.EDITOR.value)

        refusal, _ = await editor.until(Y_MESSAGE_AUTH)
        assert denial(refusal) == (0, "edit access removed")
        editor.write("edit-1", typed(doc.base, suffix=" forged"), doc.generation)
        refusal, seen = await editor.until(Y_MESSAGE_AUTH)
        assert denial(refusal) == (0, "edit denied")
        assert MESSAGE_ACCEPTED_RECEIPT not in kinds(seen)
        assert await doc.stream_ids() == []


async def test_org_default_change_reaches_a_task_that_inherits_it(
    access: Any, buffer: UpdateBuffer
) -> None:
    task = (await create_document(access, buffer, ContentType.TASK, None)).doc
    try:
        async with (
            routed(task, 1) as (manager,),
            attached(manager, task, task.peer) as (peer, frames),
        ):
            # The project inherits the organization's default, which lets every member edit.
            assert Y_MESSAGE_AUTH not in kinds(frames)
            await subscribed(peer, session_state(frames))
            await peer.drain()
            async with open_session() as db:
                await OrganizationOperations(db).update_permission_defaults(
                    access.owner_id, access.org_id, ContentType.PROJECT, AccessMode.OWNER_ONLY
                )

            refusal, seen = await peer.until(Y_MESSAGE_AUTH)
            assert denial(refusal) == (1, "access revoked")
            assert YMessageType.SYNC not in kinds(seen)
    finally:
        await discard(task.key)


class _AuthorizationOutage:
    """The registered adapter, except that every authorization read fails."""

    def __init__(self, inner: Any) -> None:
        self._inner = inner
        self.content_type = inner.content_type

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)

    async def authorize(self, *args: Any, **kwargs: Any) -> None:
        raise OSError("database unavailable")


async def test_authorization_outage_closes_for_retry_instead_of_denying(
    shared: SharedDocument, manager: YDocManager
) -> None:
    client, _ = await attach(manager, shared.doc)
    adapter = get_realtime_adapter(shared.doc.key[0])
    register_realtime_adapter(_AuthorizationOutage(adapter))
    try:
        client.send(bytes([MESSAGE_QUERY_AWARENESS]))
        await asyncio.wait_for(client.task, FRAME_TIMEOUT)
    finally:
        register_realtime_adapter(adapter)
    assert client.socket.closes == [(1011, "session ended")]
    assert Y_MESSAGE_AUTH not in kinds(await client.drain())
