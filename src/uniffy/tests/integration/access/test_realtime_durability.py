"""Realtime edits stay durable through admission, checkpoint, projection and their effects."""

import asyncio
import contextlib
from collections.abc import Awaitable, Callable, Iterator
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any
from uuid import UUID

import pycrdt
import pytest
import pytest_asyncio
from sqlalchemy import delete, select, update

from uniffy.core.database import SESSION_FACTORY_CTX_KEY
from uniffy.core.events.bus import emit_notification, event_from_json, stage_notification_events
from uniffy.core.events.types import NotificationEvent
from uniffy.core.models.files.attachment import Attachment
from uniffy.core.models.files.file import File
from uniffy.core.models.files.reconciliation import InlineAttachmentReconciliation
from uniffy.core.models.notifications.notification import Notification
from uniffy.core.models.notifications.outbox import NotificationOutbox
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.sprint import Sprint as _Sprint  # noqa: F401
from uniffy.core.models.projects.task import Task
from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime.adapter import RealtimeRenderConflict, register_realtime_adapter
from uniffy.core.realtime.buffer_keys import Receipt
from uniffy.core.realtime.job_contracts import SAVE_REALTIME_SNAPSHOT
from uniffy.core.realtime.lifecycle import stage_replacement
from uniffy.core.realtime.live import accept_seed, claim_seed
from uniffy.core.realtime.markdown import markdown_text
from uniffy.core.realtime.rename import stage_mention_rename
from uniffy.core.realtime.snapshot import SnapshotOutcome, persist_snapshot
from uniffy.core.realtime.state import WSSession
from uniffy.core.realtime.storage import (
    EditDenied,
    GenerationConflict,
    SeedConflict,
    decode_snapshot,
    load_snapshot,
    lock_document,
    stage_seed,
)
from uniffy.core.realtime.ydoc_manager import YDocManager
from uniffy.core.search.engine import SearchEngineError
from uniffy.core.types import (
    AccessMode,
    ContentRole,
    ContentType,
    NotificationType,
    SubjectType,
    generate_id,
)
from uniffy.domains.files.attachments.inline import stage_inline_reconciliation
from uniffy.domains.files.jobs.attachments import INLINE_UPLOAD_GRACE, reconcile_inline_item
from uniffy.domains.notifications.delivery import DELIVERY_ADAPTERS_CTX_KEY, NotificationChannel
from uniffy.domains.notifications.delivery.app import InAppAdapter
from uniffy.domains.notifications.jobs.events import deliver_notification_outbox
from uniffy.domains.projects.realtime import TaskRealtimeAdapter
from uniffy.infrastructure.database.session import open_session
from uniffy.tests.integration.access.realtime_live import Recorder, buffered, stored, text_of
from uniffy.tests.integration.access.realtime_sockets import Socket
from uniffy.tests.integration.access.recording_search import (
    RecordingSearchEngine,
    recording_indexer,
)
from uniffy.vendor.arq import Retry
from uniffy.workers.registry import CORE_JOB_REGISTRATIONS

pytestmark = pytest.mark.asyncio(loop_scope="session")


@pytest_asyncio.fixture(loop_scope="session")
async def document(session, access, valkey_namespace):
    project = Project(
        organization_id=access.org_id,
        owner_id=access.member_id,
        name="Durability",
        access_mode=AccessMode.OWNER_ONLY,
        slug=f"dur-{generate_id().hex[-12:]}",
    )
    session.add(project)
    await session.flush()
    task = Task(
        organization_id=access.org_id,
        owner_id=access.member_id,
        project_id=project.id,
        title="Durability",
        number=1,
        description="base",
    )
    session.add(task)
    await session.commit()
    engine = RecordingSearchEngine()
    indexer = recording_indexer(engine)
    adapter = TaskRealtimeAdapter(indexer)
    register_realtime_adapter(adapter)
    key = ContentType.TASK, task.id
    live = await buffered(key, access, valkey_namespace)
    yield SimpleNamespace(
        key=key,
        seed=await stored(key),
        access=access,
        adapter=adapter,
        engine=engine,
        indexer=indexer,
        live=live,
    )
    await session.rollback()
    await session.execute(
        delete(RealtimeYjsSnapshot).where(RealtimeYjsSnapshot.content_id == task.id)
    )
    await session.execute(delete(Task).where(Task.id == task.id))
    await session.execute(delete(Project).where(Project.id == project.id))
    await session.commit()


async def accepted(document, doc):
    """Admit the editor's whole state like a live socket, then checkpoint it unprojected."""
    admitted = await document.live.admit_live(f"u-{generate_id().hex}", doc.get_update())
    assert admitted.applied
    return await document.live.checkpointed()


async def project(document):
    await persist_snapshot(*document.key, document.access.org_id)


class _RenderGate:
    """The registered task adapter with a hook that runs before every render."""

    def __init__(self, inner: Any, before: Callable[[], Awaitable[None]]) -> None:
        self._inner = inner
        self._before = before
        self.content_type = inner.content_type

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)

    async def stage_render(self, *args: Any, **kwargs: Any) -> Any:
        await self._before()
        return await self._inner.stage_render(*args, **kwargs)


@contextlib.contextmanager
def gated_render(document, before: Callable[[], Awaitable[None]]) -> Iterator[None]:
    register_realtime_adapter(_RenderGate(document.adapter, before))
    try:
        yield
    finally:
        register_realtime_adapter(document.adapter)


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
        if registration.ref is SAVE_REALTIME_SNAPSHOT
    )

    async def contended() -> None:
        raise RealtimeRenderConflict("a metadata write committed first")

    with gated_render(document, contended), pytest.raises(Retry) as retry:
        await project_job({"job_try": 2}, *payload)
    pending = await stored(document.key)
    result = await project_job({"job_try": 3}, *payload)

    assert name == SAVE_REALTIME_SNAPSHOT.name
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


async def test_replicas_hydrate_one_shared_seed(document):
    async with open_session() as db:
        await lock_document(db, document.key)
        second = await stage_seed(db, document.key, document.access.org_id)
        assert second.generation == document.seed.generation
        assert second.updates == document.seed.updates


async def lease(document, candidate: str):
    replica = candidate.split(":")[0]
    return await claim_seed(
        document.live.buffer, document.key, document.access.org_id, [candidate], replica
    )


async def test_seed_lease_has_one_owner_and_recovers_after_expiry(document):
    assert (await lease(document, "left:1")).owner == "left:1"
    assert (await lease(document, "right:2")).owner == "left:1"
    async with open_session() as db:
        snapshot = await load_snapshot(db, document.key)
        snapshot.seed_expires_at = datetime.now(UTC) - timedelta(seconds=1)
        await db.commit()
    assert (await lease(document, "right:2")).owner == "right:2"


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


def fragment_proposal(snapshot):
    proposal = decode_snapshot(snapshot)
    proposal["prosemirror"] = pycrdt.XmlFragment([
        pycrdt.XmlElement("paragraph", contents=[pycrdt.XmlText("base")])
    ])
    proposal.get("markdown_mirror", type=pycrdt.Map)["seeded_by:proposal"] = [0]
    return proposal.get_update()


async def propose(document, update: bytes, held, *, token: str | None = None):
    return await accept_seed(
        document.live.buffer,
        document.key,
        document.access.org_id,
        document.access.member_id,
        document.seed.generation,
        update,
        seed_owner=held.owner,
        seed_token=held.token if token is None else token,
        seed_base="base",
        enqueue=document.live.jobs,
    )


async def test_expired_seed_cannot_duplicate_successor_content(document):
    first = await lease(document, "left:1")
    stale = fragment_proposal(document.seed)
    async with open_session() as db:
        snapshot = await load_snapshot(db, document.key)
        snapshot.seed_expires_at = datetime.now(UTC) - timedelta(seconds=1)
        await db.commit()
    second = await lease(document, "right:2")
    winner = fragment_proposal(document.seed)
    accepted = await propose(document, winner, second)
    with pytest.raises(SeedConflict):
        await propose(document, stale, first)
    replay = await propose(document, winner, second)
    assert replay.revision == accepted.revision
    assert (
        str(decode_snapshot(replay).get("prosemirror", type=pycrdt.XmlFragment))
        == "<paragraph>base</paragraph>"
    )


async def test_seed_checks_source_and_live_updates_cannot_bypass_the_lease(document):
    held = await lease(document, "left:1")
    proposal = fragment_proposal(document.seed)
    with pytest.raises(SeedConflict):
        await document.live.admit_live("u-claim", proposal)
    edit = decode_snapshot(document.seed)
    markdown_text(edit).insert(4, " mobile edit")
    assert (await document.live.admit_live("u-mobile", edit.get_update())).applied
    with pytest.raises(SeedConflict):
        await propose(document, proposal, held)
    assert (await stored(document.key)).updates == document.seed.updates
    assert await document.live.stream_ids() == [b"1-0"]
    assert text_of((await document.live.checkpointed()).updates) == "base mobile edit"


@pytest.mark.parametrize("expired", [True, False])
async def test_seed_checks_lease_expiry_and_identity_before_any_peer_seed(document, expired):
    held = await lease(document, "left:1")
    if expired:
        async with open_session() as db:
            snapshot = await load_snapshot(db, document.key)
            snapshot.seed_expires_at = datetime.now(UTC) - timedelta(seconds=1)
            await db.commit()
    with pytest.raises(SeedConflict):
        await propose(
            document,
            fragment_proposal(document.seed),
            held,
            token=None if expired else "expired-lease-token",
        )
    async with open_session() as db:
        snapshot = await load_snapshot(db, document.key)
        assert snapshot.updates == document.seed.updates
        assert snapshot.revision == document.seed.revision


@pytest.mark.parametrize("proposal_kind", ["text_edit", "missing_claim", "missing_predecessor"])
async def test_seed_rejects_text_edits_and_incomplete_initialization(document, proposal_kind):
    held = await lease(document, "left:1")
    proposal = decode_snapshot(document.seed)
    proposal.apply_update(fragment_proposal(document.seed))
    if proposal_kind == "text_edit":
        markdown_text(proposal).insert(4, " bundled typing")
        update = proposal.get_update()
    elif proposal_kind == "missing_claim":
        del proposal.get("markdown_mirror", type=pycrdt.Map)["seeded_by:proposal"]
        update = proposal.get_update()
    else:
        proposal.get("markdown_mirror", type=pycrdt.Map)["predecessor"] = True
        before = proposal.get_state()
        proposal.get("markdown_mirror", type=pycrdt.Map)["seeded_by:incomplete"] = [0]
        update = proposal.get_update(before)
    with pytest.raises(SeedConflict):
        await propose(document, update, held)
    async with open_session() as db:
        snapshot = await load_snapshot(db, document.key)
        assert snapshot.updates == document.seed.updates
        assert snapshot.revision == document.seed.revision


async def test_projection_failure_retains_original_mentions_and_retries_search(document):
    doc = decode_snapshot(document.seed)
    mention = f" [[[Peer|urn:uniffy:content:USER:{document.access.peer_id}]]]"
    markdown_text(doc).insert(4, mention)
    await accepted(document, doc)
    document.engine.available = False
    with pytest.raises(SearchEngineError):
        await project(document)
    document.engine.available = True
    async with open_session() as db:
        snapshot = await load_snapshot(db, document.key)
        assert snapshot.effects_pending
        assert snapshot.rendered_revision == snapshot.revision
        task = await db.get(Task, document.key[1])
        assert task.description == "base" + mention
        outbox = (
            (
                await db.execute(
                    select(NotificationOutbox).where(
                        NotificationOutbox.organization_id == document.access.org_id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(outbox) == 1
        event = event_from_json(outbox[0].payload)
        assert event.target_user_ids == [document.access.peer_id]
        event_id = event.event_id
    await project(document)
    assert "Peer" in (document.engine.indexed_text(*document.key) or "")
    async with open_session() as db:
        snapshot = await load_snapshot(db, document.key)
        assert not snapshot.effects_pending
        outbox = (
            (
                await db.execute(
                    select(NotificationOutbox).where(
                        NotificationOutbox.organization_id == document.access.org_id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert [row.event_id for row in outbox] == [event_id]
        adapter = InAppAdapter()
        first = await adapter.deliver_with_session(db, document.access.peer_id, event)
        await db.commit()
        duplicate = await adapter.deliver_with_session(db, document.access.peer_id, event)
        await db.commit()
        assert first is not None
        assert duplicate is None
        rows = (
            (await db.execute(select(Notification).where(Notification.event_id == event_id)))
            .scalars()
            .all()
        )
        assert len(rows) == 1
        await db.delete(rows[0])
        await db.commit()


async def rename(document, urn: str) -> Recorder:
    jobs = Recorder()
    async with open_session() as db:
        await lock_document(db, document.key)
        after_commit = await stage_mention_rename(
            document.live.buffer,
            db,
            document.key,
            document.access.org_id,
            urn,
            "Renamed",
            enqueue=jobs,
        )
        assert after_commit is not None
        await db.commit()
    await after_commit()
    return jobs


async def test_rename_grafts_unprojected_text_and_survives_late_typing(document):
    urn = f"urn:uniffy:content:USER:{document.access.peer_id}"
    doc = decode_snapshot(document.seed)
    markdown_text(doc).insert(4, f" [[[Old|{urn}]]] human")
    await accepted(document, doc)
    # The column has not projected the mention yet; the rename lands in the live state.
    jobs = await rename(document, urn)
    assert [job[0] for job in jobs.jobs] == [SAVE_REALTIME_SNAPSHOT.name]
    markdown_text(doc).insert(len(markdown_text(doc)), " offline")
    snapshot = await accepted(document, doc)
    assert snapshot.generation == document.seed.generation
    await project(document)
    async with open_session() as db:
        task = await db.get(Task, document.key[1])
        assert task.description == f"base [[[Renamed|{urn}]]] human offline"


def _database_down() -> Any:
    raise OSError("database unavailable")


async def test_notification_delivery_failure_keeps_original_outbox(document):
    access = document.access
    async with open_session() as db:
        task = await db.get(Task, document.key[1])
        db.add(
            ContentMember(
                organization_id=access.org_id,
                content_type=ContentType.PROJECT,
                content_id=task.project_id,
                subject_type=SubjectType.USER,
                subject_id=access.peer_id,
                role=ContentRole.VIEWER,
                added_by_user_id=access.member_id,
            )
        )
        await db.commit()
    doc = decode_snapshot(document.seed)
    markdown_text(doc).insert(4, f" [[[Peer|urn:uniffy:content:USER:{access.peer_id}]]]")
    await accepted(document, doc)
    await project(document)
    async with open_session() as db:
        event = (
            await db.execute(
                select(NotificationOutbox).where(NotificationOutbox.organization_id == access.org_id)
            )
        ).scalar_one()
        event_id, payload = event.event_id, event.payload
    adapters = {NotificationChannel.IN_APP: InAppAdapter()}

    unavailable = {SESSION_FACTORY_CTX_KEY: _database_down, DELIVERY_ADAPTERS_CTX_KEY: adapters}
    with pytest.raises(OSError):
        await deliver_notification_outbox(unavailable, str(event_id))
    async with open_session() as db:
        assert (await db.get(NotificationOutbox, event_id)).payload == payload

    available = {SESSION_FACTORY_CTX_KEY: open_session, DELIVERY_ADAPTERS_CTX_KEY: adapters}
    await deliver_notification_outbox(available, str(event_id))
    await deliver_notification_outbox(available, str(event_id))
    async with open_session() as db:
        assert await db.get(NotificationOutbox, event_id) is None
        rows = (
            await db.scalars(select(Notification).where(Notification.event_id == event_id))
        ).all()
        assert [row.user_id for row in rows] == [access.peer_id]
        for row in rows:
            await db.delete(row)
        await db.commit()


async def test_continuous_edit_notifications_coalesce_per_actor(document):
    access = document.access
    async with open_session() as db:
        for actor in (access.member_id, access.member_id, access.peer_id):
            with stage_notification_events(db):
                await emit_notification(
                    NotificationEvent(
                        notification_type=NotificationType.CONTENT_EDITED,
                        organization_id=access.org_id,
                        actor_id=actor,
                        title="Edited",
                        source_urn=f"urn:uniffy:content:TASK:{document.key[1]}",
                    )
                )
            await db.commit()
        rows = (
            await db.scalars(
                select(NotificationOutbox).where(
                    NotificationOutbox.organization_id == access.org_id,
                )
            )
        ).all()
        assert len(rows) == 2
        assert {event_from_json(row.payload).actor_id for row in rows} == {
            access.member_id,
            access.peer_id,
        }


class _Storage:
    """Object storage that records deletions and fails every call while unavailable."""

    def __init__(self) -> None:
        self.deleted: list[str] = []
        self.available = True

    async def delete_object(self, key: str) -> None:
        if not self.available:
            raise OSError("storage down")
        self.deleted.append(key)


async def inline_upload(document, name: str) -> File:
    """An editor upload on the task, attached before any upload grace would protect it."""
    access = document.access
    async with open_session() as db:
        file = File(
            organization_id=access.org_id,
            owner_id=access.member_id,
            access_mode=AccessMode.OWNER_ONLY,
            filename=name,
            original_filename=name,
            mime_type="image/png",
            size_bytes=10,
            storage_key=f"itdb/{generate_id().hex}",
            storage_bucket="itdb",
        )
        db.add(file)
        await db.flush()
        db.add(
            Attachment(
                organization_id=access.org_id,
                file_id=file.id,
                source_file_id=file.id,
                content_type=ContentType.TASK,
                content_id=document.key[1],
                attached_by_user_id=access.member_id,
                attached_at=datetime.now(UTC) - 2 * INLINE_UPLOAD_GRACE,
            )
        )
        await db.commit()
    return file


async def attached_files(document) -> set[UUID]:
    async with open_session() as db:
        return set(
            await db.scalars(
                select(Attachment.file_id).where(Attachment.content_id == document.key[1])
            )
        )


async def test_inline_cleanup_waits_for_projection_and_retries_failed_storage(document):
    org = document.access.org_id
    row_key = (document.key[0].value, document.key[1])
    kept, dropped = (
        await inline_upload(document, "kept.png"),
        await inline_upload(document, "gone.png"),
    )
    storage = _Storage()

    async def pending() -> bool:
        async with open_session() as db:
            return await db.get(InlineAttachmentReconciliation, row_key) is not None

    try:
        doc = decode_snapshot(document.seed)
        markdown_text(doc).insert(4, f" ![image](/api/files/{org}/{kept.id})")
        await accepted(document, doc)
        async with open_session() as db:
            await stage_inline_reconciliation(db, *document.key, org)
            await db.rollback()
            assert await db.get(InlineAttachmentReconciliation, row_key) is None
            await stage_inline_reconciliation(db, *document.key, org)
            await db.commit()
            item = await db.get(InlineAttachmentReconciliation, row_key)

        async def reconcile() -> None:
            await reconcile_inline_item(
                item, buffer=document.live.buffer, storage=storage, search_indexer=document.indexer
            )

        # The column does not show the accepted reference yet, so nothing may go.
        await reconcile()
        assert await attached_files(document) == {kept.id, dropped.id}
        assert await pending()

        await project(document)
        storage.available = False
        with pytest.raises(OSError):
            await reconcile()
        assert await attached_files(document) == {kept.id, dropped.id}
        assert await pending()

        storage.available = True
        await reconcile()
        assert await attached_files(document) == {kept.id}
        assert storage.deleted == [dropped.storage_key]
        assert not await pending()
    finally:
        async with open_session() as db:
            await db.execute(
                delete(InlineAttachmentReconciliation).where(
                    InlineAttachmentReconciliation.content_id == document.key[1]
                )
            )
            await db.execute(delete(Attachment).where(Attachment.content_id == document.key[1]))
            await db.execute(delete(File).where(File.id.in_([kept.id, dropped.id])))
            await db.commit()


async def test_locked_hydration_refuses_deleted_content_without_orphan(document):
    async with open_session() as db:
        await db.execute(
            delete(RealtimeYjsSnapshot).where(RealtimeYjsSnapshot.content_id == document.key[1])
        )
        task = await db.get(Task, document.key[1])
        task.is_deleted = True
        await db.commit()
    socket = Socket()
    attaching = WSSession(
        user_id=document.access.member_id,
        organization_id=document.access.org_id,
        token_version=1,
        conn_id=id(socket),
        ws=socket,
    )
    with pytest.raises(EditDenied):
        await YDocManager(buffer=document.live.buffer).acquire(
            document.key, attaching, can_edit=True
        )
    async with open_session() as db:
        assert await load_snapshot(db, document.key) is None


async def test_canvas_rename_keeps_other_fields_and_concurrent_text(document):
    urn = f"urn:uniffy:content:USER:{document.access.peer_id}"
    doc = decode_snapshot(document.seed)
    doc.get("nodes", type=pycrdt.Map)["node"] = pycrdt.Map({
        "data": pycrdt.Map({"content": pycrdt.Text(f"é [[[Old|{urn}]]]"), "color": "red"}),
        "x": 22,
    })
    await accepted(document, doc)
    await rename(document, urn)
    node = doc.get("nodes", type=pycrdt.Map)["node"]
    node["data"]["content"].insert(len(node["data"]["content"]), " peer")
    snapshot = await accepted(document, doc)
    merged = decode_snapshot(snapshot).get("nodes", type=pycrdt.Map)["node"]
    assert str(merged["data"]["content"]) == f"é [[[Renamed|{urn}]]] peer"
    assert merged["data"]["color"] == "red"
    assert merged["x"] == 22
