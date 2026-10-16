"""Note trash, restore, deletion and inline cleanup while accepted edits wait in the buffer."""

import asyncio
import contextlib
import dataclasses
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

import pytest
import pytest_asyncio
import valkey.asyncio as aioredis
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit.actions import Action
from uniffy.core.events.realtime import (
    ContentAccessAction,
    NotificationPayloadType,
    notification_channel,
)
from uniffy.core.json_codec import loads
from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.files.attachment import Attachment
from uniffy.core.models.files.file import File
from uniffy.core.models.files.reconciliation import InlineAttachmentReconciliation
from uniffy.core.models.notes.note import Note
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime.buffer import UpdateBuffer
from uniffy.core.realtime.buffer_keys import AdmissionStatus
from uniffy.core.realtime.checkpoint import CheckpointStatus, checkpoint_document, stage_recovered
from uniffy.core.realtime.epoch import ensure_epoch
from uniffy.core.realtime.job_contracts import SAVE_REALTIME_SNAPSHOT
from uniffy.core.realtime.live import LiveStateUnavailable
from uniffy.core.realtime.publisher import perm_channel
from uniffy.core.realtime.snapshot import SnapshotOutcome, persist_snapshot
from uniffy.core.realtime.storage import load_snapshot, lock_document, stage_seed
from uniffy.core.search.indexer import SEARCH_INDEXER_CTX_KEY, SearchIndexer, build_content_urn
from uniffy.core.storage import OBJECT_STORAGE_CTX_KEY
from uniffy.core.types import (
    AccessMode,
    ContentRole,
    ContentType,
    NodeType,
    SubjectType,
    generate_id,
)
from uniffy.domains.files.attachments.inline import stage_inline_reconciliation
from uniffy.domains.files.jobs.attachments import INLINE_UPLOAD_GRACE, _reconcile
from uniffy.domains.notes.content.updates import NoteUpdates
from uniffy.domains.notes.hierarchy.operations import NoteHierarchy
from uniffy.domains.notes.operations import NoteOperations
from uniffy.infrastructure.database.session import open_session
from uniffy.infrastructure.valkey.config import ValkeyConfig
from uniffy.infrastructure.valkey.pubsub import close_pubsub, init_pubsub
from uniffy.tests.integration.access.realtime_live import (
    BufferedDocument,
    doc_messages,  # noqa: F401 - fixture
    establish,
    live_note,  # noqa: F401 - fixture
    published_progress,
    stored,
    text_of,
    typed,
    unreachable_buffer,  # noqa: F401 - fixture
)

pytestmark = pytest.mark.asyncio(loop_scope="session")

RETIRED = {"stream": [], "control": 0, "receipts": [], "due": None}


def hierarchy(
    db: AsyncSession, note: BufferedDocument, buffer: UpdateBuffer | None = None
) -> NoteHierarchy:
    operations = NoteOperations(db, AsyncMock(), MagicMock(spec=SearchIndexer))
    return NoteHierarchy(operations, buffer or note.buffer, note.jobs)


def projection_job(note: BufferedDocument, revision: int) -> tuple[str, str, tuple[str, ...]]:
    return (
        SAVE_REALTIME_SNAPSHOT.name,
        f"{note.namespace}projection:{ContentType.NOTE.value}:{note.key[1]}:{revision}",
        (ContentType.NOTE.value, str(note.key[1]), str(note.org), "", ""),
    )


async def note_row(note: BufferedDocument) -> Note | None:
    async with open_session() as db:
        return await db.get(Note, note.key[1])


async def audited(note: BufferedDocument, resource_id: UUID) -> list[tuple[str, int | None]]:
    """Actions recorded for one note with their descendant counts, oldest first."""
    async with open_session() as db:
        rows = await db.execute(
            select(AuditEvent.action, AuditEvent.details)
            .where(AuditEvent.organization_id == note.org, AuditEvent.resource_id == resource_id)
            .order_by(AuditEvent.created_at)
        )
    return [(action, details.get("descendant_count")) for action, details in rows]


async def assert_purged(note: BufferedDocument) -> None:
    """No row, no buffered edit, and nothing can append or establish a new epoch."""
    late = await note.buffer.admit(
        note.head,
        update_id="u-late",
        update=typed(note.base, suffix=" late"),
        actor_id=note.owner,
    )
    assert late.status is AdmissionStatus.RECOVERY_REQUIRED
    assert await note.buffer_state() == RETIRED
    assert await note_row(note) is None
    async with open_session() as db:
        await lock_document(db, note.key, note.org)
        assert await load_snapshot(db, note.key) is None
        with pytest.raises(LookupError):
            await ensure_epoch(note.buffer, db, note.key, note.org, stage_recovered=stage_recovered)


@contextlib.asynccontextmanager
async def listening(*channels: str) -> AsyncIterator[aioredis.client.PubSub]:
    """Everything published on these channels from now on."""
    await init_pubsub()
    client = aioredis.from_url(ValkeyConfig.from_env().to_url())
    subscription = client.pubsub()
    await subscription.subscribe(*channels)
    try:
        yield subscription
    finally:
        await subscription.aclose()
        await client.aclose()
        await close_pubsub()


async def heard(subscription: aioredis.client.PubSub) -> list[tuple[str, dict]]:
    """Channel and payload of each message so far, oldest first."""
    found = []
    for _ in range(20):
        message = await subscription.get_message(ignore_subscribe_messages=True, timeout=0.1)
        if message is not None:
            found.append((message["channel"].decode(), loads(message["data"])))
    return found


def access_changes(messages: list[tuple[str, dict]]) -> set[tuple[str, str, str]]:
    return {
        (channel, payload["content_id"], payload["action"])
        for channel, payload in messages
        if payload.get("_type") == NotificationPayloadType.CONTENT_ACCESS_CHANGED
    }


def access_rechecks(messages: list[tuple[str, dict]], note_id: UUID) -> list[str | None]:
    channel = perm_channel(ContentType.NOTE, note_id)
    return [payload["user_id"] for name, payload in messages if name == channel]


async def share_with_peer(note: BufferedDocument) -> None:
    async with open_session() as db:
        await db.execute(
            update(Note)
            .where(Note.id == note.key[1])
            .values(access_mode=AccessMode.EXPLICIT_MEMBERS)
        )
        db.add(
            ContentMember(
                organization_id=note.org,
                content_type=ContentType.NOTE,
                content_id=note.key[1],
                subject_type=SubjectType.USER,
                subject_id=note.peer,
                role=ContentRole.EDITOR,
                added_by_user_id=note.owner,
            )
        )
        await db.commit()


@dataclass
class Tree:
    folder: UUID
    first: BufferedDocument
    second: BufferedDocument


@pytest_asyncio.fixture(loop_scope="session")
async def tree(live_note) -> AsyncIterator[Tree]:
    """A folder holding the live note and a second live note on the same buffer."""
    async with open_session() as db:
        folder = Note(
            organization_id=live_note.org,
            owner_id=live_note.owner,
            title="Folder",
            slug=f"folder-{generate_id().hex}",
            node_type=NodeType.FOLDER,
        )
        db.add(folder)
        await db.flush()
        second = Note(
            organization_id=live_note.org,
            owner_id=live_note.owner,
            title="Second",
            slug=f"second-{generate_id().hex}",
            content="base",
            parent_id=folder.id,
        )
        db.add(second)
        await db.execute(update(Note).where(Note.id == live_note.key[1]).values(parent_id=folder.id))
        await db.commit()
        folder_id, key = folder.id, (ContentType.NOTE, second.id)
        await lock_document(db, key, live_note.org)
        row = await stage_seed(db, key, live_note.org)
        await db.commit()
    assert row.generation is not None
    sibling = dataclasses.replace(
        live_note,
        key=key,
        base=row.updates,
        generation=row.generation,
        head=await establish(live_note.buffer, key, live_note.org),
    )
    try:
        yield Tree(folder_id, live_note, sibling)
    finally:
        async with open_session() as db:
            await db.execute(
                delete(RealtimeYjsSnapshot).where(RealtimeYjsSnapshot.content_id == key[1])
            )
            await db.execute(update(Note).where(Note.parent_id == folder_id).values(parent_id=None))
            await db.execute(delete(Note).where(Note.id.in_([key[1], folder_id])))
            await db.commit()


async def test_trash_keeps_a_buffered_edit_off_the_note_until_restore_projects_it(
    live_note: BufferedDocument, doc_messages
) -> None:
    await live_note.admit("u-alice", typed(live_note.base, suffix=" Alice"), live_note.peer)

    async with open_session() as db:
        await hierarchy(db, live_note).delete(live_note.owner, live_note.org, live_note.key[1])

    trashed = await stored(live_note.key)
    assert text_of(trashed.updates) == "base Alice"
    assert (trashed.checkpoint_seq, trashed.actor_id) == (1, live_note.peer)
    assert trashed.revision > trashed.rendered_revision
    assert (await live_note.buffer_state())["stream"] == []
    outcome = await persist_snapshot(*live_note.key, live_note.org, b"", b"")
    assert outcome is SnapshotOutcome.SNAPSHOT_ONLY
    note = await note_row(live_note)
    assert note is not None and (note.is_deleted, note.content) == (True, "base")
    assert live_note.jobs.jobs == []

    async with open_session() as db:
        await hierarchy(db, live_note).restore(live_note.owner, live_note.org, live_note.key[1])

    assert live_note.jobs.jobs == [projection_job(live_note, trashed.revision)]
    outcome = await persist_snapshot(*live_note.key, live_note.org, b"", b"")
    assert outcome is SnapshotOutcome.RENDERED
    note = await note_row(live_note)
    assert note is not None and (note.is_deleted, note.content) == (False, "base Alice")
    assert await audited(live_note, live_note.key[1]) == [
        (Action.NOTE_DELETED, 0),
        (Action.NOTE_RESTORED, None),
    ]
    progress = {
        "generation": live_note.generation,
        "epoch": live_note.head.scope.epoch,
        "covered_sequence": 1,
        "checkpoint_revision": trashed.revision,
    }
    assert await published_progress(doc_messages) == [progress, progress]


async def test_trash_fails_retryably_while_buffered_edits_cannot_be_verified(
    live_note: BufferedDocument, unreachable_buffer
) -> None:
    await live_note.admit("u-alice", typed(live_note.base, suffix=" Alice"))
    before = await stored(live_note.key)
    buffered = await live_note.buffer_state()

    async with open_session() as db:
        with pytest.raises(LiveStateUnavailable):
            await hierarchy(db, live_note, unreachable_buffer).delete(
                live_note.owner, live_note.org, live_note.key[1]
            )

    note = await note_row(live_note)
    assert note is not None and not note.is_deleted
    row = await stored(live_note.key)
    assert (row.updates, row.revision, row.checkpoint_seq) == (
        before.updates,
        before.revision,
        before.checkpoint_seq,
    )
    assert await live_note.buffer_state() == buffered
    assert await audited(live_note, live_note.key[1]) == []


async def test_permanent_delete_retires_the_buffered_tail_with_the_note(
    live_note: BufferedDocument,
) -> None:
    await live_note.admit("u-alice", typed(live_note.base, suffix=" Alice"))

    async with open_session() as db:
        await hierarchy(db, live_note).delete(
            live_note.owner, live_note.org, live_note.key[1], permanent=True
        )

    await assert_purged(live_note)
    assert await audited(live_note, live_note.key[1]) == [(Action.NOTE_PERMANENTLY_DELETED, 0)]


async def test_empty_trash_retires_the_epoch_a_trashed_note_kept(
    live_note: BufferedDocument,
) -> None:
    await live_note.admit("u-alice", typed(live_note.base, suffix=" Alice"))
    async with open_session() as db:
        await hierarchy(db, live_note).delete(live_note.owner, live_note.org, live_note.key[1])
    kept = await live_note.buffer_state()
    assert (kept["stream"], kept["control"]) == ([], 1)

    async with open_session() as db:
        assert await hierarchy(db, live_note).empty_trash(live_note.owner, live_note.org) == 1

    await assert_purged(live_note)
    assert await audited(live_note, live_note.key[1]) == [
        (Action.NOTE_DELETED, 0),
        (Action.NOTE_PERMANENTLY_DELETED, None),
    ]


async def test_folder_trash_folds_every_child_tail(tree: Tree) -> None:
    await tree.first.admit("u-first", typed(tree.first.base, suffix=" first"))
    await tree.second.admit("u-second", typed(tree.second.base, suffix=" second"))

    async with open_session() as db:
        await hierarchy(db, tree.first).delete(tree.first.owner, tree.first.org, tree.folder)

    for child, text in ((tree.first, "base first"), (tree.second, "base second")):
        row = await stored(child.key)
        assert (text_of(row.updates), row.checkpoint_seq) == (text, 1)
        assert row.revision > row.rendered_revision
        assert (await child.buffer_state())["stream"] == []
        note = await note_row(child)
        assert note is not None and (note.is_deleted, note.content) == (True, "base")
    assert await audited(tree.first, tree.folder) == [(Action.NOTE_DELETED, 2)]


@pytest.mark.parametrize("permanent", [False, True])
async def test_deleting_a_shared_note_rechecks_live_sessions_and_tells_only_its_audience(
    live_note: BufferedDocument, access, permanent: bool
) -> None:
    await share_with_peer(live_note)
    note_id = live_note.key[1]
    org_channel = f"content:{live_note.org}"
    owner, peer, outsider = (
        notification_channel(live_note.owner),
        notification_channel(live_note.peer),
        notification_channel(access.admin_id),
    )

    async with listening(
        perm_channel(ContentType.NOTE, note_id), org_channel, owner, peer, outsider
    ) as subscription:
        async with open_session() as db:
            await hierarchy(db, live_note).delete(
                live_note.owner, live_note.org, note_id, permanent=permanent
            )
        messages = await heard(subscription)

    assert access_rechecks(messages, note_id) == [None]
    revoked = str(ContentAccessAction.REVOKED)
    assert access_changes(messages) == {
        (owner, str(note_id), revoked),
        (peer, str(note_id), revoked),
    }


async def test_restoring_a_shared_note_tells_its_audience_it_is_back(
    live_note: BufferedDocument, access
) -> None:
    await share_with_peer(live_note)
    note_id = live_note.key[1]
    async with open_session() as db:
        await hierarchy(db, live_note).delete(live_note.owner, live_note.org, note_id)
    owner, peer, outsider = (
        notification_channel(live_note.owner),
        notification_channel(live_note.peer),
        notification_channel(access.admin_id),
    )

    async with listening(f"content:{live_note.org}", owner, peer, outsider) as subscription:
        async with open_session() as db:
            await hierarchy(db, live_note).restore(live_note.owner, live_note.org, note_id)
        messages = await heard(subscription)

    granted = str(ContentAccessAction.GRANTED)
    assert access_changes(messages) == {
        (owner, str(note_id), granted),
        (peer, str(note_id), granted),
    }


async def test_deleting_an_org_wide_note_announces_it_on_the_org_channel(
    live_note: BufferedDocument,
) -> None:
    note_id = live_note.key[1]
    org_channel = f"content:{live_note.org}"

    async with listening(
        perm_channel(ContentType.NOTE, note_id), org_channel, notification_channel(live_note.peer)
    ) as subscription:
        async with open_session() as db:
            await hierarchy(db, live_note).delete(live_note.owner, live_note.org, note_id)
        messages = await heard(subscription)

    assert access_rechecks(messages, note_id) == [None]
    assert access_changes(messages) == {
        (org_channel, str(note_id), str(ContentAccessAction.REVOKED))
    }


async def test_folder_trash_rechecks_every_descendant(tree: Tree) -> None:
    removed = [tree.folder, tree.first.key[1], tree.second.key[1]]

    async with listening(
        *(perm_channel(ContentType.NOTE, note_id) for note_id in removed)
    ) as subscription:
        async with open_session() as db:
            await hierarchy(db, tree.first).delete(tree.first.owner, tree.first.org, tree.folder)
        messages = await heard(subscription)

    assert sorted(channel for channel, _ in messages) == sorted(
        perm_channel(ContentType.NOTE, note_id) for note_id in removed
    )


async def _append_holding_lock(
    note: BufferedDocument, update: bytes, appended: asyncio.Event, release: asyncio.Event
) -> int:
    async with open_session() as db:
        await lock_document(db, note.key, note.org)
        seq = await note.admit("u-inflight", update)
        appended.set()
        await release.wait()
        await db.commit()
    return seq


async def test_folder_purge_waits_for_an_inflight_append_then_retires_it(tree: Tree) -> None:
    async with open_session() as db:
        await hierarchy(db, tree.second).delete(
            tree.second.owner, tree.second.org, tree.second.key[1]
        )
    appended, release = asyncio.Event(), asyncio.Event()
    appending = asyncio.create_task(
        _append_holding_lock(tree.first, typed(tree.first.base, suffix=" racing"), appended, release)
    )

    async def purge() -> None:
        async with open_session() as db:
            await hierarchy(db, tree.first).delete(
                tree.first.owner, tree.first.org, tree.folder, permanent=True
            )

    purging: asyncio.Task[None] | None = None
    try:
        await asyncio.wait_for(appended.wait(), timeout=5)
        purging = asyncio.create_task(purge())
        with pytest.raises(TimeoutError):
            await asyncio.wait_for(asyncio.shield(purging), timeout=0.2)
        assert (await tree.first.buffer_state())["stream"] == [b"1-0"]
    finally:
        release.set()
        seq = await asyncio.wait_for(appending, timeout=5)
        if purging is not None:
            await asyncio.wait_for(purging, timeout=10)

    assert seq == 1
    await assert_purged(tree.first)
    await assert_purged(tree.second)
    async with open_session() as db:
        assert await db.get(Note, tree.folder) is None
    # The descendant trashed earlier is destroyed with the folder.
    assert await audited(tree.first, tree.folder) == [(Action.NOTE_PERMANENTLY_DELETED, 2)]


@pytest_asyncio.fixture(loop_scope="session")
async def upload(live_note) -> AsyncIterator[UUID]:
    """An inline upload on the live note, attached before any upload grace would protect it."""
    async with open_session() as db:
        file = File(
            organization_id=live_note.org,
            owner_id=live_note.owner,
            access_mode=AccessMode.OWNER_ONLY,
            filename="inline.png",
            original_filename="inline.png",
            mime_type="image/png",
            size_bytes=10,
            storage_key=f"itdb/{generate_id().hex}",
            storage_bucket="itdb",
        )
        db.add(file)
        await db.flush()
        db.add(
            Attachment(
                organization_id=live_note.org,
                file_id=file.id,
                source_file_id=file.id,
                content_type=ContentType.NOTE,
                content_id=live_note.key[1],
                attached_by_user_id=live_note.owner,
                attached_at=datetime.now(UTC) - 2 * INLINE_UPLOAD_GRACE,
            )
        )
        await db.commit()
        file_id = file.id
    try:
        yield file_id
    finally:
        async with open_session() as db:
            await db.execute(
                delete(InlineAttachmentReconciliation).where(
                    InlineAttachmentReconciliation.content_id == live_note.key[1]
                )
            )
            await db.execute(delete(Attachment).where(Attachment.file_id == file_id))
            await db.execute(delete(File).where(File.id == file_id))
            await db.commit()


async def test_inline_cleanup_keeps_an_upload_only_a_buffered_edit_references(
    live_note: BufferedDocument, upload: UUID, unreachable_buffer
) -> None:
    reference = f"![image](/api/files/{live_note.org}/{upload})"
    await live_note.admit("u-image", typed(live_note.base, suffix=f" {reference}"))
    key = (ContentType.NOTE.value, live_note.key[1])
    item = InlineAttachmentReconciliation(
        content_type=key[0], content_id=key[1], organization_id=live_note.org
    )
    ctx = {
        OBJECT_STORAGE_CTX_KEY: AsyncMock(),
        SEARCH_INDEXER_CTX_KEY: MagicMock(spec=SearchIndexer),
    }

    async def remaining() -> tuple[bool, bool]:
        async with open_session() as db:
            attached = await db.scalar(select(Attachment.id).where(Attachment.file_id == upload))
            pending = await db.get(InlineAttachmentReconciliation, key)
        return attached is not None, pending is not None

    async with open_session() as guard:
        await stage_inline_reconciliation(guard, ContentType.NOTE, live_note.key[1], live_note.org)
        await guard.commit()
        # A running worker's sweep skips locked rows, so it cannot decide this one meanwhile.
        await guard.execute(
            select(InlineAttachmentReconciliation)
            .where(InlineAttachmentReconciliation.content_id == live_note.key[1])
            .with_for_update()
        )
        await _reconcile(ctx, item, live_note.buffer)
        assert await remaining() == (True, True)
        await _reconcile(ctx, item, unreachable_buffer)
        assert await remaining() == (True, True)

    result = await checkpoint_document(
        live_note.buffer, live_note.head.scope, enqueue=live_note.jobs
    )
    assert result.status is CheckpointStatus.COMMITTED
    outcome = await persist_snapshot(*live_note.key, live_note.org, b"", b"")
    assert outcome is SnapshotOutcome.RENDERED
    await _reconcile(ctx, item, live_note.buffer)

    assert await remaining() == (True, False)
    note = await note_row(live_note)
    assert note is not None
    assert build_content_urn(ContentType.FILE, upload) in (note.outgoing_references or [])


async def test_content_write_leaves_inline_cleanup_to_a_sweep_that_sees_later_tail_edits(
    live_note: BufferedDocument, upload: UUID
) -> None:
    key = (ContentType.NOTE.value, live_note.key[1])
    item = InlineAttachmentReconciliation(
        content_type=key[0], content_id=key[1], organization_id=live_note.org
    )
    ctx = {
        OBJECT_STORAGE_CTX_KEY: AsyncMock(),
        SEARCH_INDEXER_CTX_KEY: MagicMock(spec=SearchIndexer),
    }

    async def remaining() -> tuple[bool, bool]:
        async with open_session() as db:
            attached = await db.scalar(select(Attachment.id).where(Attachment.file_id == upload))
            pending = await db.get(InlineAttachmentReconciliation, key)
        return attached is not None, pending is not None

    async with open_session() as guard:
        async with open_session() as db:
            operations = NoteOperations(db, AsyncMock(), MagicMock(spec=SearchIndexer))
            written = await NoteUpdates(operations, live_note.buffer).update(
                live_note.owner,
                live_note.org,
                live_note.key[1],
                content="base agent",
                base_content="base",
            )
        # A running worker's sweep skips locked rows, so it cannot decide this one meanwhile.
        await guard.execute(
            select(InlineAttachmentReconciliation)
            .where(InlineAttachmentReconciliation.content_id == live_note.key[1])
            .with_for_update()
        )
        assert written.content == "base agent"
        assert await remaining() == (True, True)

        # Bob's edit referencing the upload is accepted after the write committed.
        reference = f"![image](/api/files/{live_note.org}/{upload})"
        merged = (await stored(live_note.key)).updates
        await live_note.admit("u-image", typed(merged, suffix=f" {reference}"), live_note.peer)
        await _reconcile(ctx, item, live_note.buffer)
        assert await remaining() == (True, True)
