"""Accepted realtime edits stay durable through admission, checkpoint and projection."""

import asyncio
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import delete, update

from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.task import Task
from uniffy.core.realtime.adapter import RealtimeRenderConflict
from uniffy.core.realtime.buffer_keys import Receipt
from uniffy.core.realtime.job_contracts import PROJECT_REALTIME_DOCUMENT
from uniffy.core.realtime.lifecycle import stage_replacement
from uniffy.core.realtime.markdown import markdown_text
from uniffy.core.realtime.snapshot import SnapshotOutcome
from uniffy.core.realtime.storage import (
    EditDenied,
    GenerationConflict,
    decode_snapshot,
    load_snapshot,
    lock_document,
)
from uniffy.core.types import ContentRole, ContentType, SubjectType
from uniffy.infrastructure.database.session import open_session
from uniffy.tests.integration.access.realtime_live import stored, text_of
from uniffy.tests.integration.access.realtime_tasks import (
    accepted,
    document,  # noqa: F401 - fixture
    gated_render,
    project,
)
from uniffy.vendor.arq import Retry
from uniffy.workers.registry import CORE_JOB_REGISTRATIONS

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_admissions_from_two_replicas_both_reach_projection_without_pubsub(document):
    left, right = decode_snapshot(document.seed), decode_snapshot(document.seed)
    markdown_text(left).insert(4, " Alice")
    markdown_text(right).insert(4, " Bob")
    await asyncio.gather(
        document.live.admit_live("u-left", left.get_update()),
        document.live.admit_live("u-right", right.get_update()),
    )
    await document.live.checkpointed()
    await project(document)
    async with open_session() as db:
        snapshot = await load_snapshot(db, document.key)
        text = str(markdown_text(decode_snapshot(snapshot)))
        task = await db.get(Task, document.key[1])
        assert "Alice" in text and "Bob" in text
        assert task.description == text
        assert snapshot.rendered_revision == snapshot.revision


async def test_delete_only_update_is_buffered_once_and_its_replay_appends_nothing(document):
    doc = decode_snapshot(document.seed)
    before = doc.get_state()
    del markdown_text(doc)[0:4]
    assert doc.get_state() == before
    deletion = doc.get_update(before)
    first = await document.live.admit_live("u-delete", deletion)
    replay = await document.live.admit_live("u-replay", deletion)
    assert first.applied and first.receipt is not None
    scope = document.live.head.scope
    assert (replay.applied, replay.receipt) == (
        False,
        Receipt(scope.generation, scope.epoch, first.receipt.seq, "u-replay"),
    )
    assert await document.live.stream_ids() == [b"1-0"]
    assert text_of((await document.live.checkpointed()).updates) == ""


async def test_metadata_write_does_not_supersede_content(document):
    doc = decode_snapshot(document.seed)
    markdown_text(doc).insert(4, " edits")
    await accepted(document, doc)
    async with open_session() as db:
        await db.execute(update(Task).where(Task.id == document.key[1]).values(title="renamed"))
        await db.commit()
    await project(document)
    async with open_session() as db:
        task = await db.get(Task, document.key[1])
        assert task.description == "base edits"
        assert task.title == "renamed"


async def test_external_replacement_fences_stale_admission_and_projection(document):
    stale = decode_snapshot(document.seed)
    markdown_text(stale).insert(4, " stale")
    async with open_session() as db:
        await lock_document(db, document.key)
        task = await db.get(Task, document.key[1])
        task.description = "external replacement"
        after_commit = await stage_replacement(
            document.live.buffer, db, document.key, document.access.org_id
        )
        await db.commit()
    await after_commit()
    with pytest.raises(GenerationConflict):
        await document.live.admit_live("u-stale", stale.get_update())
    await project(document)
    async with open_session() as db:
        snapshot = await load_snapshot(db, document.key)
        task = await db.get(Task, document.key[1])
        assert (
            task.description
            == str(markdown_text(decode_snapshot(snapshot)))
            == "external replacement"
        )


async def test_failed_projection_keeps_accepted_bytes_for_retry(document):
    doc = decode_snapshot(document.seed)
    markdown_text(doc).insert(4, " durable")
    await accepted(document, doc)

    async def interrupted() -> None:
        raise OSError("database interrupted")

    with gated_render(document, interrupted), pytest.raises(OSError):
        await project(document)
    async with open_session() as db:
        snapshot = await load_snapshot(db, document.key)
        assert snapshot.revision > snapshot.rendered_revision
        assert str(markdown_text(decode_snapshot(snapshot))) == "base durable"
    await project(document)


async def test_projection_job_retries_soon_after_its_render_loses_a_version_race(document):
    doc = decode_snapshot(document.seed)
    markdown_text(doc).insert(4, " contended")
    await accepted(document, doc)
    name, _, payload = document.live.jobs.jobs[-1]
    project_job = next(
        registration.handler
        for registration in CORE_JOB_REGISTRATIONS
        if registration.ref is PROJECT_REALTIME_DOCUMENT
    )

    async def contended() -> None:
        raise RealtimeRenderConflict("a metadata write committed first")

    with gated_render(document, contended), pytest.raises(Retry) as retry:
        await project_job({"job_try": 2}, *payload)
    pending = await stored(document.key)
    result = await project_job({"job_try": 3}, *payload)

    assert name == PROJECT_REALTIME_DOCUMENT.name
    # Seconds per try: only the competing metadata write has to land first.
    assert retry.value.defer_score == 2000
    assert pending.revision > pending.rendered_revision
    assert result == {"status": SnapshotOutcome.RENDERED.value, "content_id": str(document.key[1])}
    async with open_session() as db:
        task = await db.get(Task, document.key[1])
    assert task is not None and task.description == "base contended"


async def test_projection_lock_prevents_older_render_from_finishing_last(document):
    first = decode_snapshot(document.seed)
    markdown_text(first).insert(4, " first")
    await accepted(document, first)
    entered, release = asyncio.Event(), asyncio.Event()

    async def paused() -> None:
        entered.set()
        await release.wait()

    with gated_render(document, paused):
        rendering = asyncio.create_task(project(document))
        await entered.wait()
        second = decode_snapshot(document.seed)
        markdown_text(second).insert(4, " second")
        # Admission takes the document lock that projection holds while it renders.
        accepting = asyncio.create_task(accepted(document, second))
        await asyncio.sleep(0.05)
        assert not accepting.done()
        release.set()
        await rendering
        await accepting
    await project(document)
    async with open_session() as db:
        snapshot = await load_snapshot(db, document.key)
        task = await db.get(Task, document.key[1])
        assert task.description == str(markdown_text(decode_snapshot(snapshot)))
        assert "first" in task.description and "second" in task.description


async def test_deleted_parent_refuses_admission_without_pubsub(document):
    doc = decode_snapshot(document.seed)
    markdown_text(doc).insert(4, " denied")
    async with open_session() as db:
        task = await db.get(Task, document.key[1])
        parent = await db.get(Project, task.project_id)
        parent.is_deleted = True
        await db.commit()
    with pytest.raises(EditDenied):
        await document.live.admit_live("u-denied", doc.get_update())
    assert await document.live.stream_ids() == []
    assert (await stored(document.key)).updates == document.seed.updates


async def test_failed_external_replacement_rolls_back_domain_and_generation(document):
    async with open_session() as db:
        await lock_document(db, document.key)
        task = await db.get(Task, document.key[1])
        task.description = "never committed"
        await stage_replacement(document.live.buffer, db, document.key, document.access.org_id)
        await db.rollback()
    async with open_session() as db:
        task = await db.get(Task, document.key[1])
        snapshot = await load_snapshot(db, document.key)
        assert task.description == "base"
        assert snapshot.generation == document.seed.generation


async def test_missing_target_removes_pending_snapshot(document):
    doc = decode_snapshot(document.seed)
    markdown_text(doc).insert(4, " pending")
    await accepted(document, doc)
    async with open_session() as db:
        await db.execute(delete(Task).where(Task.id == document.key[1]))
        await db.commit()
    await project(document)
    async with open_session() as db:
        assert await load_snapshot(db, document.key) is None


async def test_expired_editor_grant_cannot_append_without_revocation_fanout(document):
    async with open_session() as db:
        task = await db.get(Task, document.key[1])
        grant = ContentMember(
            organization_id=document.access.org_id,
            content_type=ContentType.PROJECT,
            content_id=task.project_id,
            subject_type=SubjectType.USER,
            subject_id=document.access.peer_id,
            role=ContentRole.EDITOR,
            added_by_user_id=document.access.member_id,
            expires_at=datetime.now(UTC) + timedelta(minutes=1),
        )
        db.add(grant)
        await db.commit()
        doc = decode_snapshot(document.seed)
        markdown_text(doc).insert(4, " allowed")
        peer = document.access.peer_id
        assert (await document.live.admit_live("u-allowed", doc.get_update(), peer)).applied
        grant.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        await db.commit()
        markdown_text(doc).insert(len(markdown_text(doc)), " forbidden")
        with pytest.raises(EditDenied):
            await document.live.admit_live("u-forbidden", doc.get_update(), peer)
        assert await document.live.stream_ids() == [b"1-0"]
        assert text_of((await document.live.checkpointed()).updates) == "base allowed"
        await db.delete(grant)
        await db.commit()


async def test_successor_admitted_before_its_predecessor_is_appended_not_dropped(document):
    doc = decode_snapshot(document.seed)
    before = doc.get_state()
    markdown_text(doc).insert(4, " first")
    predecessor = doc.get_update(before)
    middle = doc.get_state()
    markdown_text(doc).insert(len(markdown_text(doc)), " second")
    successor = doc.get_update(middle)

    early = await document.live.admit_live("u-successor", successor)
    late = await document.live.admit_live("u-predecessor", predecessor)

    assert (early.applied, late.applied) == (True, True)
    assert await document.live.stream_ids() == [b"1-0", b"2-0"]
    assert text_of((await document.live.checkpointed()).updates) == "base first second"
