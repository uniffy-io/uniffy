"""Lifecycle, seed, rename and attachment barriers over a live buffered tail."""

from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from sqlalchemy import delete, select, update

from uniffy.core.models.notes.note import Note
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.realtime.buffer import UpdateBuffer
from uniffy.core.realtime.buffer_keys import AdmissionStatus
from uniffy.core.realtime.checkpoint import (
    CheckpointCapture,
    CheckpointStatus,
    capture_checkpoint,
    checkpoint_document,
    commit_checkpoint,
    stage_recovered,
)
from uniffy.core.realtime.epoch import ensure_epoch
from uniffy.core.realtime.job_contracts import SAVE_REALTIME_SNAPSHOT
from uniffy.core.realtime.lifecycle import (
    stage_hard_delete,
    stage_replacement,
    stage_restore,
    stage_trash,
)
from uniffy.core.realtime.live import (
    AfterCommit,
    LiveStateUnavailable,
    accept_seed,
    claim_seed,
    may_have_unprojected_edits,
    stage_text_merge,
)
from uniffy.core.realtime.rename import stage_mention_rename
from uniffy.core.realtime.snapshot import SnapshotOutcome, persist_snapshot
from uniffy.core.realtime.storage import (
    EditDenied,
    GenerationConflict,
    SeedConflict,
    load_snapshot,
    lock_document,
)
from uniffy.core.types import AccessMode, ContentRole, ContentType, SubjectType
from uniffy.infrastructure.database.session import open_session
from uniffy.tests.integration.access.realtime_live import (
    BufferedDocument,
    doc_messages,  # noqa: F401 - fixture
    fragment_edit,
    fragment_of,
    live_note,  # noqa: F401 - fixture
    published_progress,
    stored,
    text_of,
    typed,
    unreachable_buffer,  # noqa: F401 - fixture
)

pytestmark = pytest.mark.asyncio(loop_scope="session")


def projection_job(note: BufferedDocument, revision: int) -> tuple[str, str, tuple[str, ...]]:
    return (
        SAVE_REALTIME_SNAPSHOT.name,
        f"{note.namespace}projection:{ContentType.NOTE.value}:{note.key[1]}:{revision}",
        (ContentType.NOTE.value, str(note.key[1]), str(note.org), "", ""),
    )


async def test_replacement_retires_the_older_generation_tail_after_commit(
    live_note: BufferedDocument,
) -> None:
    alice = typed(live_note.base, suffix=" Alice")
    await live_note.admit("u-alice", alice)
    before = await stored(live_note.key)

    async with open_session() as db:
        await lock_document(db, live_note.key, live_note.org)
        note = await db.get(Note, live_note.key[1])
        assert note is not None
        note.content = "replaced"
        after_commit = await stage_replacement(live_note.buffer, db, live_note.key, live_note.org)
        uncommitted = await live_note.buffer_state()
        await db.commit()
    await after_commit()

    assert uncommitted["stream"] == [b"1-0"]
    row = await stored(live_note.key)
    assert text_of(row.updates) == "replaced"
    assert row.generation not in (None, live_note.generation)
    assert (row.buffer_epoch, row.valkey_run_id, row.checkpoint_seq) == (None, None, 0)
    assert row.rendered_revision == row.revision == before.revision + 1
    assert await live_note.buffer_state() == {
        "stream": [],
        "control": 0,
        "receipts": [],
        "due": None,
    }
    late = await live_note.buffer.admit(
        live_note.head,
        update_id="u-late",
        update=typed(alice, suffix=" late"),
        actor_id=live_note.owner,
    )
    assert late.status is AdmissionStatus.RECOVERY_REQUIRED
    with pytest.raises(GenerationConflict):
        await live_note.admit_live("u-stale", alice)


async def test_checkpoint_captured_before_replacement_never_commits_into_the_new_generation(
    live_note: BufferedDocument,
) -> None:
    await live_note.admit("u-alice", typed(live_note.base, suffix=" Alice"))
    capture = await capture_checkpoint(live_note.buffer, live_note.head.scope)

    async with open_session() as db:
        await lock_document(db, live_note.key, live_note.org)
        note = await db.get(Note, live_note.key[1])
        assert note is not None
        note.content = "replaced"
        retire = await stage_replacement(live_note.buffer, db, live_note.key, live_note.org)
        await db.commit()
    replaced = await stored(live_note.key)
    result = await commit_checkpoint(live_note.buffer, capture)
    await retire()

    assert isinstance(capture, CheckpointCapture)
    assert result.status is CheckpointStatus.OBSOLETE
    row = await stored(live_note.key)
    assert (row.updates, row.revision, row.generation) == (
        replaced.updates,
        replaced.revision,
        replaced.generation,
    )
    assert text_of(row.updates) == "replaced"
    assert await live_note.buffer_state() == {
        "stream": [],
        "control": 0,
        "receipts": [],
        "due": None,
    }


async def test_trash_folds_the_tail_without_projecting_and_restore_schedules_projection(
    live_note: BufferedDocument, doc_messages
) -> None:
    await live_note.admit("u-alice", typed(live_note.base, suffix=" Alice"), live_note.peer)
    before = await stored(live_note.key)

    async with open_session() as db:
        await lock_document(db, live_note.key, live_note.org)
        trashed = await stage_trash(live_note.buffer, db, live_note.key, live_note.org)
        note = await db.get(Note, live_note.key[1])
        assert note is not None
        note.is_deleted = True
        await db.commit()
    await trashed()

    row = await stored(live_note.key)
    assert text_of(row.updates) == "base Alice"
    assert (row.checkpoint_seq, row.revision, row.actor_id) == (
        1,
        before.revision + 1,
        live_note.peer,
    )
    assert (row.rendered_revision, row.effects_pending) == (
        before.rendered_revision,
        before.effects_pending,
    )
    assert (await live_note.buffer_state())["stream"] == []
    assert live_note.jobs.jobs == []

    async with open_session() as db:
        await lock_document(db, live_note.key, live_note.org)
        restored = await stage_restore(
            live_note.buffer, db, live_note.key, live_note.org, enqueue=live_note.jobs
        )
        note = await db.get(Note, live_note.key[1])
        assert note is not None
        note.is_deleted = False
        await db.commit()
    await restored()

    assert live_note.jobs.jobs == [projection_job(live_note, row.revision)]
    progress = {
        "generation": live_note.generation,
        "epoch": live_note.head.scope.epoch,
        "covered_sequence": 1,
        "checkpoint_revision": row.revision,
    }
    assert await published_progress(doc_messages) == [progress, progress]


async def test_hard_delete_retires_the_buffer_and_refuses_later_appends(
    live_note: BufferedDocument,
) -> None:
    alice = typed(live_note.base, suffix=" Alice")
    await live_note.admit("u-alice", alice)

    async with open_session() as db:
        await lock_document(db, live_note.key, live_note.org)
        after_commit = await stage_hard_delete(live_note.buffer, db, live_note.key)
        await db.execute(delete(Note).where(Note.id == live_note.key[1]))
        uncommitted = await live_note.buffer_state()
        await db.commit()
    await after_commit()

    assert uncommitted["stream"] == [b"1-0"]
    assert await live_note.buffer_state() == {
        "stream": [],
        "control": 0,
        "receipts": [],
        "due": None,
    }
    late = typed(live_note.base, alice, suffix=" late")
    refused = await live_note.buffer.admit(
        live_note.head, update_id="u-late", update=late, actor_id=live_note.owner
    )
    assert refused.status is AdmissionStatus.RECOVERY_REQUIRED
    async with open_session() as db:
        await lock_document(db, live_note.key, live_note.org)
        assert await load_snapshot(db, live_note.key) is None
        with pytest.raises(LookupError):
            await ensure_epoch(
                live_note.buffer, db, live_note.key, live_note.org, stage_recovered=stage_recovered
            )
    with pytest.raises(EditDenied):
        await live_note.admit_live("u-late", late)


async def test_seed_proposal_validates_against_the_tail_and_commits_it_before_acknowledgment(
    live_note: BufferedDocument, doc_messages
) -> None:
    alice = typed(live_note.base, suffix=" Alice")
    await live_note.admit("u-alice", alice)
    lease = await claim_seed(live_note.buffer, live_note.key, live_note.org, ["left:1"], "left")
    assert lease is not None and lease.owner == "left:1"
    before = await stored(live_note.key)

    async def propose(proposal: bytes, base: str) -> Any:
        return await accept_seed(
            live_note.buffer,
            live_note.key,
            live_note.org,
            live_note.owner,
            live_note.generation,
            proposal,
            seed_owner=lease.owner,
            seed_token=lease.token,
            seed_base=base,
            enqueue=live_note.jobs,
        )

    # Built from the checkpoint alone, the proposal would hide the buffered edit.
    with pytest.raises(SeedConflict):
        await propose(fragment_edit(live_note.base, text="base", claim="left"), "base")
    assert (await stored(live_note.key)).updates == before.updates
    assert (await live_note.buffer_state())["stream"] == [b"1-0"]

    proposal = fragment_edit(live_note.base, alice, text="base Alice", claim="left")
    committed = await propose(proposal, "base Alice")

    row = await stored(live_note.key)
    assert (row.revision, row.checkpoint_seq) == (committed.revision, 1) == (before.revision + 1, 1)
    assert fragment_of(row.updates) == "<paragraph>base Alice</paragraph>"
    assert text_of(row.updates) == "base Alice"
    assert (await live_note.buffer_state())["stream"] == []
    assert live_note.jobs.jobs == [projection_job(live_note, row.revision)]
    assert await published_progress(doc_messages) == [
        {
            "generation": live_note.generation,
            "epoch": live_note.head.scope.epoch,
            "covered_sequence": 1,
            "checkpoint_revision": row.revision,
        }
    ]
    replay = await propose(proposal, "base Alice")
    assert replay.revision == row.revision


async def test_seed_lease_sees_fragment_content_that_only_the_tail_holds(
    live_note: BufferedDocument,
) -> None:
    async def claim() -> Any:
        return await claim_seed(live_note.buffer, live_note.key, live_note.org, ["left:1"], "left")

    assert await claim() is not None
    await live_note.admit("u-rich", fragment_edit(live_note.base, text="typed"))

    assert await claim() is None
    assert (await stored(live_note.key)).seed_owner is None


async def test_attachment_cleanup_defers_until_the_columns_show_every_accepted_edit(
    live_note: BufferedDocument, unreachable_buffer
) -> None:
    reference = f" ![image](/api/files/{live_note.org}/{live_note.key[1]})"

    async def pending(buffer: UpdateBuffer) -> bool:
        async with open_session() as db:
            await lock_document(db, live_note.key, live_note.org)
            return await may_have_unprojected_edits(buffer, db, live_note.key)

    async def projected() -> str:
        async with open_session() as db:
            return await db.scalar(select(Note.content).where(Note.id == live_note.key[1])) or ""

    assert not await pending(live_note.buffer)
    await live_note.admit("u-image", typed(live_note.base, suffix=reference))

    assert reference not in await projected()
    assert await pending(live_note.buffer)
    assert await pending(unreachable_buffer)
    result = await checkpoint_document(
        live_note.buffer, live_note.head.scope, enqueue=live_note.jobs
    )
    assert result.status is CheckpointStatus.COMMITTED
    # The tail is checkpointed but the column still lacks the reference until projection.
    assert reference not in await projected()
    assert await pending(live_note.buffer)
    outcome = await persist_snapshot(*live_note.key, live_note.org, b"", b"")
    assert outcome is SnapshotOutcome.RENDERED
    assert reference in await projected()
    assert not await pending(live_note.buffer)


async def test_rename_merges_into_the_tail_and_keeps_the_generation(
    live_note: BufferedDocument,
) -> None:
    urn = f"urn:uniffy:content:USER:{live_note.peer}"
    mention = typed(live_note.base, suffix=f" [[[Old|{urn}]]] human")
    await live_note.admit("u-mention", mention, live_note.peer)

    assert live_note.key in await live_note.buffer.pending_documents(live_note.org)
    async with open_session() as db:
        await lock_document(db, live_note.key, live_note.org)
        after_commit = await stage_mention_rename(
            live_note.buffer,
            db,
            live_note.key,
            live_note.org,
            urn,
            "Renamed",
            enqueue=live_note.jobs,
        )
        assert after_commit is not None
        await db.commit()
    await after_commit()

    row = await stored(live_note.key)
    assert text_of(row.updates) == f"base [[[Renamed|{urn}]]] human"
    assert (row.generation, row.checkpoint_seq) == (live_note.generation, 1)
    assert row.revision > row.rendered_revision
    assert live_note.jobs.jobs == [projection_job(live_note, row.revision)]
    assert (await live_note.buffer_state())["stream"] == []
    # The peer keeps typing on top of the label it saw; both survive.
    await live_note.admit("u-offline", typed(live_note.base, mention, suffix=" offline"))
    result = await checkpoint_document(
        live_note.buffer, live_note.head.scope, enqueue=live_note.jobs
    )
    assert result.status is CheckpointStatus.COMMITTED
    assert (
        text_of((await stored(live_note.key)).updates) == f"base [[[Renamed|{urn}]]] human offline"
    )


async def _merge(buffer: UpdateBuffer, note: BufferedDocument) -> AfterCommit:
    async with open_session() as db:
        await lock_document(db, note.key, note.org)
        merge = await stage_text_merge(
            buffer, db, note.key, note.org, note.owner, base="base", stored="base", incoming="x"
        )
        await db.commit()
    return merge.after_commit


async def _trash(buffer: UpdateBuffer, note: BufferedDocument) -> AfterCommit:
    async with open_session() as db:
        await lock_document(db, note.key, note.org)
        after_commit = await stage_trash(buffer, db, note.key, note.org)
        await db.commit()
    return after_commit


async def _rename(buffer: UpdateBuffer, note: BufferedDocument) -> AfterCommit:
    async with open_session() as db:
        await lock_document(db, note.key, note.org)
        after_commit = await stage_mention_rename(
            buffer, db, note.key, note.org, f"urn:uniffy:content:USER:{note.peer}", "Renamed"
        )
        await db.commit()
    assert after_commit is not None
    return after_commit


async def _seed(buffer: UpdateBuffer, note: BufferedDocument) -> AfterCommit:
    await accept_seed(
        buffer,
        note.key,
        note.org,
        note.owner,
        note.generation,
        fragment_edit(note.base, text="base", claim="left"),
        seed_owner="left:1",
        seed_token="token",
        seed_base="base",
    )
    raise AssertionError("an unverifiable tail must refuse the seed")


@pytest.mark.parametrize("barrier", [_merge, _trash, _rename, _seed])
async def test_unreachable_valkey_fails_content_barriers_retryably_and_leaves_the_row(
    live_note: BufferedDocument,
    unreachable_buffer,
    barrier: Callable[[UpdateBuffer, BufferedDocument], Awaitable[AfterCommit]],
) -> None:
    urn = f"urn:uniffy:content:USER:{live_note.peer}"
    await live_note.admit("u-alice", typed(live_note.base, suffix=f" [[[Old|{urn}]]]"))
    before = await stored(live_note.key)
    buffered = await live_note.buffer_state()

    with pytest.raises(LiveStateUnavailable):
        await barrier(unreachable_buffer, live_note)

    row = await stored(live_note.key)
    assert (row.updates, row.revision, row.checkpoint_seq, row.buffer_epoch) == (
        before.updates,
        before.revision,
        before.checkpoint_seq,
        before.buffer_epoch,
    )
    assert await live_note.buffer_state() == buffered


async def test_seed_replay_after_losing_edit_access_is_refused_and_changes_nothing(
    live_note: BufferedDocument,
) -> None:
    async def grant(role: ContentRole) -> None:
        async with open_session() as db:
            await db.execute(
                update(ContentMember)
                .where(ContentMember.content_id == live_note.key[1])
                .values(role=role)
            )
            await db.commit()

    async with open_session() as db:
        await db.execute(
            update(Note).where(Note.id == live_note.key[1]).values(access_mode=AccessMode.OWNER_ONLY)
        )
        db.add(
            ContentMember(
                organization_id=live_note.org,
                content_type=ContentType.NOTE,
                content_id=live_note.key[1],
                subject_type=SubjectType.USER,
                subject_id=live_note.peer,
                role=ContentRole.EDITOR,
                added_by_user_id=live_note.owner,
            )
        )
        await db.commit()
    try:
        alice = typed(live_note.base, suffix=" Alice")
        await live_note.admit("u-alice", alice, live_note.peer)
        lease = await claim_seed(live_note.buffer, live_note.key, live_note.org, ["left:1"], "left")
        assert lease is not None
        proposal = fragment_edit(live_note.base, alice, text="base Alice", claim="left")
        await grant(ContentRole.VIEWER)
        before = await stored(live_note.key)
        buffered = await live_note.buffer_state()

        with pytest.raises(EditDenied):
            await accept_seed(
                live_note.buffer,
                live_note.key,
                live_note.org,
                live_note.peer,
                live_note.generation,
                proposal,
                seed_owner=lease.owner,
                seed_token=lease.token,
                seed_base="base Alice",
                enqueue=live_note.jobs,
            )

        row = await stored(live_note.key)
        assert (row.updates, row.revision, row.checkpoint_seq, row.seed_owner) == (
            before.updates,
            before.revision,
            before.checkpoint_seq,
            before.seed_owner,
        )
        assert await live_note.buffer_state() == buffered
        assert live_note.jobs.jobs == []
    finally:
        async with open_session() as db:
            await db.execute(
                delete(ContentMember).where(ContentMember.content_id == live_note.key[1])
            )
            await db.commit()
