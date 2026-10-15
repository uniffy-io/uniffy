import asyncio
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pycrdt
import pytest
import pytest_asyncio
from sqlalchemy import delete, select, update

from uniffy.core.errors import StaleContentVersionError
from uniffy.core.events.bus import emit_notification, event_from_json, stage_notification_events
from uniffy.core.events.types import NotificationEvent
from uniffy.core.models.files.reconciliation import InlineAttachmentReconciliation
from uniffy.core.models.notes.note import Note
from uniffy.core.models.notifications.notification import Notification
from uniffy.core.models.notifications.outbox import NotificationOutbox
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.sprint import Sprint as _Sprint  # noqa: F401
from uniffy.core.models.projects.task import Task
from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime.markdown import markdown_text
from uniffy.core.realtime.rename import stage_mention_rename
from uniffy.core.realtime.snapshot import persist_snapshot
from uniffy.core.realtime.storage import (
    DocumentTooLarge,
    EditDenied,
    GenerationConflict,
    SeedConflict,
    accept_update,
    claim_seed,
    decode_snapshot,
    load_snapshot,
    lock_document,
    stage_replacement,
    stage_seed,
)
from uniffy.core.realtime.ydoc_manager import YDocManager
from uniffy.core.types import (
    AccessMode,
    ContentRole,
    ContentType,
    NotificationType,
    SubjectType,
    generate_id,
)
from uniffy.domains.files.attachments.inline import stage_inline_reconciliation
from uniffy.domains.files.jobs.attachments import _reconcile
from uniffy.domains.notes.adapter import NoteRealtimeAdapter
from uniffy.domains.notes.operations import NoteOperations
from uniffy.domains.notifications.delivery.app import InAppAdapter
from uniffy.domains.notifications.jobs.events import deliver_notification_outbox
from uniffy.domains.projects.realtime import TaskRealtimeAdapter
from uniffy.domains.projects.tasks.notifications import TaskNotifications
from uniffy.domains.search.rename import propagate_rename
from uniffy.infrastructure.database.session import open_session

emit_mentions = TaskNotifications.emit_mention_notifications

pytestmark = pytest.mark.asyncio(loop_scope="session")


@pytest_asyncio.fixture(loop_scope="session")
async def document(session, access):
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
    adapter = TaskRealtimeAdapter(MagicMock())
    key = ContentType.TASK, task.id
    with (
        patch("uniffy.core.realtime.storage.get_realtime_adapter", return_value=adapter),
        patch("uniffy.core.realtime.snapshot.get_realtime_adapter", return_value=adapter),
        patch(
            "uniffy.domains.projects.tasks.realtime.TaskContentOperations._index_for_search",
            new_callable=AsyncMock,
        ),
        patch(
            "uniffy.domains.projects.tasks.realtime.TaskNotifications.emit_mention_notifications",
            new_callable=AsyncMock,
        ),
    ):
        async with open_session() as db:
            await lock_document(db, key)
            seed = await stage_seed(db, key, access.org_id)
            await db.commit()
        yield SimpleNamespace(key=key, seed=seed, access=access, adapter=adapter)
    await session.rollback()
    await session.execute(
        delete(RealtimeYjsSnapshot).where(RealtimeYjsSnapshot.content_id == task.id)
    )
    await session.execute(delete(Task).where(Task.id == task.id))
    await session.execute(delete(Project).where(Project.id == project.id))
    await session.commit()


async def accepted(document, doc):
    return await accept_update(
        document.key,
        document.access.org_id,
        document.access.member_id,
        document.seed.generation,
        doc.get_update(),
    )


async def project(document):
    await persist_snapshot(*document.key, document.access.org_id, b"", b"")


async def test_replica_updates_survive_without_pubsub(document):
    left, right = decode_snapshot(document.seed), decode_snapshot(document.seed)
    markdown_text(left).insert(4, " Alice")
    markdown_text(right).insert(4, " Bob")
    await asyncio.gather(accepted(document, left), accepted(document, right))
    await project(document)
    async with open_session() as db:
        snapshot = await load_snapshot(db, document.key)
        text = str(markdown_text(decode_snapshot(snapshot)))
        task = await db.get(Task, document.key[1])
        assert "Alice" in text and "Bob" in text
        assert task.description == text
        assert snapshot.rendered_revision == snapshot.revision


async def test_delete_only_update_is_durable_and_idempotent(document):
    doc = decode_snapshot(document.seed)
    before = doc.get_state()
    del markdown_text(doc)[0:4]
    assert doc.get_state() == before
    first = await accepted(document, doc)
    second = await accepted(document, doc)
    assert first.revision == second.revision
    assert str(markdown_text(decode_snapshot(second))) == ""


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


async def test_external_replacement_fences_resident_and_queued_state(document):
    stale = decode_snapshot(document.seed)
    markdown_text(stale).insert(4, " stale")
    async with open_session() as db:
        await lock_document(db, document.key)
        task = await db.get(Task, document.key[1])
        task.description = "external replacement"
        await stage_replacement(db, document.key, document.access.org_id)
        await db.commit()
    with pytest.raises(GenerationConflict):
        await accepted(document, stale)
    await persist_snapshot(
        *document.key, document.access.org_id, stale.get_update(), stale.get_state()
    )
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
    with patch.object(document.adapter, "stage_render", side_effect=OSError("database interrupted")):
        with pytest.raises(OSError):
            await project(document)
    async with open_session() as db:
        snapshot = await load_snapshot(db, document.key)
        assert snapshot.revision > snapshot.rendered_revision
        assert str(markdown_text(decode_snapshot(snapshot))) == "base durable"
    await project(document)


async def test_projection_lock_prevents_older_render_from_finishing_last(document):
    first = decode_snapshot(document.seed)
    markdown_text(first).insert(4, " first")
    await accepted(document, first)
    entered, release = asyncio.Event(), asyncio.Event()
    original = document.adapter.stage_render

    async def paused(*args, **kwargs):
        entered.set()
        await release.wait()
        return await original(*args, **kwargs)

    with patch.object(document.adapter, "stage_render", side_effect=paused):
        rendering = asyncio.create_task(project(document))
        await entered.wait()
        second = decode_snapshot(document.seed)
        markdown_text(second).insert(4, " second")
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


async def test_seed_lease_has_one_owner_and_recovers_after_expiry(document):
    org = document.access.org_id
    assert (await claim_seed(document.key, org, ["left:1"], "left")).owner == "left:1"
    assert (await claim_seed(document.key, org, ["right:2"], "right")).owner == "left:1"
    async with open_session() as db:
        snapshot = await load_snapshot(db, document.key)
        snapshot.seed_expires_at = datetime.now(UTC) - timedelta(seconds=1)
        await db.commit()
    assert (await claim_seed(document.key, org, ["right:2"], "right")).owner == "right:2"


async def test_deleted_parent_rejects_update_without_pubsub(document):
    doc = decode_snapshot(document.seed)
    markdown_text(doc).insert(4, " denied")
    async with open_session() as db:
        task = await db.get(Task, document.key[1])
        parent = await db.get(Project, task.project_id)
        parent.is_deleted = True
        await db.commit()
    with pytest.raises(EditDenied):
        await accepted(document, doc)
    async with open_session() as db:
        snapshot = await load_snapshot(db, document.key)
        assert snapshot.updates == document.seed.updates


async def test_failed_external_replacement_rolls_back_domain_and_generation(document):
    async with open_session() as db:
        await lock_document(db, document.key)
        task = await db.get(Task, document.key[1])
        task.description = "never committed"
        await stage_replacement(db, document.key, document.access.org_id)
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


async def test_expired_editor_grant_cannot_commit_without_revocation_fanout(document):
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
        await accept_update(
            document.key,
            document.access.org_id,
            document.access.peer_id,
            document.seed.generation,
            doc.get_update(),
        )
        grant.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        await db.commit()
        markdown_text(doc).insert(len(markdown_text(doc)), " forbidden")
        with pytest.raises(EditDenied):
            await accept_update(
                document.key,
                document.access.org_id,
                document.access.peer_id,
                document.seed.generation,
                doc.get_update(),
            )
        snapshot = await load_snapshot(db, document.key)
        assert str(markdown_text(decode_snapshot(snapshot))) == "base allowed"
        await db.delete(grant)
        await db.commit()


async def test_guarded_note_replacement_rejects_accepted_unprojected_human_edits(session, access):
    note = Note(
        organization_id=access.org_id,
        owner_id=access.member_id,
        title="Guarded",
        slug=f"guard-{generate_id().hex}",
        content="base",
    )
    session.add(note)
    await session.commit()
    key = ContentType.NOTE, note.id
    adapter = NoteRealtimeAdapter(MagicMock())
    with patch("uniffy.core.realtime.storage.get_realtime_adapter", return_value=adapter):
        await lock_document(session, key)
        seed = await stage_seed(session, key, access.org_id)
        await session.commit()
        doc = decode_snapshot(seed)
        markdown_text(doc).insert(4, " human work")
        await accept_update(key, access.org_id, access.member_id, seed.generation, doc.get_update())
        operations = NoteOperations(session, MagicMock(), MagicMock())
        with pytest.raises(StaleContentVersionError):
            await operations.update(
                access.member_id,
                access.org_id,
                note.id,
                content="stale agent output",
                expected_content_version=note.version,
            )
        await session.rollback()
        snapshot = await load_snapshot(session, key)
        assert str(markdown_text(decode_snapshot(snapshot))) == "base human work"
        await session.delete(snapshot)
        await session.execute(delete(Note).where(Note.id == key[1]))
        await session.commit()


async def test_missing_causal_predecessor_survives_durable_acceptance(document):
    doc = decode_snapshot(document.seed)
    before = doc.get_state()
    markdown_text(doc).insert(4, " first")
    predecessor = doc.get_update(before)
    middle = doc.get_state()
    markdown_text(doc).insert(len(markdown_text(doc)), " second")
    successor = doc.get_update(middle)
    await accept_update(
        document.key,
        document.access.org_id,
        document.access.member_id,
        document.seed.generation,
        successor,
    )
    accepted = await accept_update(
        document.key,
        document.access.org_id,
        document.access.member_id,
        document.seed.generation,
        predecessor,
    )
    assert str(markdown_text(decode_snapshot(accepted))) == "base first second"


def fragment_proposal(snapshot):
    proposal = decode_snapshot(snapshot)
    proposal["prosemirror"] = pycrdt.XmlFragment([
        pycrdt.XmlElement("paragraph", contents=[pycrdt.XmlText("base")])
    ])
    proposal.get("markdown_mirror", type=pycrdt.Map)["seeded_by:proposal"] = [0]
    return proposal.get_update()


async def test_expired_seed_cannot_duplicate_successor_content(document):
    org = document.access.org_id
    actor = document.access.member_id
    first = await claim_seed(document.key, org, ["left:1"], "left")
    stale = fragment_proposal(document.seed)
    async with open_session() as db:
        snapshot = await load_snapshot(db, document.key)
        snapshot.seed_expires_at = datetime.now(UTC) - timedelta(seconds=1)
        await db.commit()
    second = await claim_seed(document.key, org, ["right:2"], "right")
    winner = fragment_proposal(document.seed)
    accepted = await accept_update(
        document.key,
        org,
        actor,
        document.seed.generation,
        winner,
        seed_owner=second.owner,
        seed_token=second.token,
        seed_base="base",
    )
    with pytest.raises(SeedConflict):
        await accept_update(
            document.key,
            org,
            actor,
            document.seed.generation,
            stale,
            seed_owner=first.owner,
            seed_token=first.token,
            seed_base="base",
        )
    replay = await accept_update(
        document.key,
        org,
        actor,
        document.seed.generation,
        winner,
        seed_owner=second.owner,
        seed_token=second.token,
        seed_base="base",
    )
    assert replay.revision == accepted.revision
    assert (
        str(decode_snapshot(replay).get("prosemirror", type=pycrdt.XmlFragment))
        == "<paragraph>base</paragraph>"
    )


async def test_seed_checks_source_and_normal_updates_cannot_bypass_lease(document):
    org = document.access.org_id
    actor = document.access.member_id
    lease = await claim_seed(document.key, org, ["left:1"], "left")
    proposal = fragment_proposal(document.seed)
    with pytest.raises(SeedConflict):
        await accept_update(document.key, org, actor, document.seed.generation, proposal)
    edit = decode_snapshot(document.seed)
    markdown_text(edit).insert(4, " mobile edit")
    accepted = await accept_update(
        document.key, org, actor, document.seed.generation, edit.get_update()
    )
    with pytest.raises(SeedConflict):
        await accept_update(
            document.key,
            org,
            actor,
            document.seed.generation,
            proposal,
            seed_owner=lease.owner,
            seed_token=lease.token,
            seed_base="base",
        )
    async with open_session() as db:
        saved = await load_snapshot(db, document.key)
        assert saved.updates == accepted.updates
        assert str(markdown_text(decode_snapshot(saved))) == "base mobile edit"


@pytest.mark.parametrize("expired", [True, False])
async def test_seed_checks_lease_expiry_and_identity_before_any_peer_seed(document, expired):
    org = document.access.org_id
    lease = await claim_seed(document.key, org, ["left:1"], "left")
    if expired:
        async with open_session() as db:
            snapshot = await load_snapshot(db, document.key)
            snapshot.seed_expires_at = datetime.now(UTC) - timedelta(seconds=1)
            await db.commit()
    with pytest.raises(SeedConflict):
        await accept_update(
            document.key,
            org,
            document.access.member_id,
            document.seed.generation,
            fragment_proposal(document.seed),
            seed_owner=lease.owner,
            seed_token=lease.token if expired else "expired-lease-token",
            seed_base="base",
        )
    async with open_session() as db:
        snapshot = await load_snapshot(db, document.key)
        assert snapshot.updates == document.seed.updates
        assert snapshot.revision == document.seed.revision


@pytest.mark.parametrize("proposal_kind", ["text_edit", "missing_claim", "missing_predecessor"])
async def test_seed_rejects_text_edits_and_incomplete_initialization(document, proposal_kind):
    org = document.access.org_id
    lease = await claim_seed(document.key, org, ["left:1"], "left")
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
        await accept_update(
            document.key,
            org,
            document.access.member_id,
            document.seed.generation,
            update,
            seed_owner=lease.owner,
            seed_token=lease.token,
            seed_base="base",
        )
    async with open_session() as db:
        snapshot = await load_snapshot(db, document.key)
        assert snapshot.updates == document.seed.updates
        assert snapshot.revision == document.seed.revision


async def test_projection_failure_retains_original_mentions_and_retries_search(document):
    doc = decode_snapshot(document.seed)
    mention = f" [[[Peer|urn:uniffy:content:USER:{document.access.peer_id}]]]"
    markdown_text(doc).insert(4, mention)
    await accepted(document, doc)
    with (
        patch.object(TaskNotifications, "emit_mention_notifications", new=emit_mentions),
        patch(
            "uniffy.domains.projects.tasks.realtime.TaskContentOperations._index_for_search",
            AsyncMock(side_effect=OSError("search down")),
        ),
    ):
        with pytest.raises(OSError, match="search down"):
            await project(document)
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


async def test_rename_grafts_live_text_and_survives_late_typing(document):
    urn = f"urn:uniffy:content:USER:{document.access.peer_id}"
    doc = decode_snapshot(document.seed)
    markdown_text(doc).insert(4, f" [[[Old|{urn}]]] human")
    await accepted(document, doc)
    # Column references have not projected yet; rename must still discover this document.
    async with open_session() as db:
        with (
            patch("uniffy.domains.search.rename.enqueue_job", AsyncMock()),
            patch("uniffy.domains.search.rename.publish_content_replace", AsyncMock()),
        ):
            assert await propagate_rename(db, document.access.org_id, urn, "Renamed") == 1
    markdown_text(doc).insert(len(markdown_text(doc)), " offline")
    snapshot = await accepted(document, doc)
    assert snapshot.generation == document.seed.generation
    await project(document)
    async with open_session() as db:
        task = await db.get(Task, document.key[1])
        assert task.description == f"base [[[Renamed|{urn}]]] human offline"


async def test_notification_delivery_failure_keeps_original_outbox(document):
    doc = decode_snapshot(document.seed)
    markdown_text(doc).insert(4, f" [[[Peer|urn:uniffy:content:USER:{document.access.peer_id}]]]")
    await accepted(document, doc)
    with patch.object(TaskNotifications, "emit_mention_notifications", new=emit_mentions):
        await project(document)
    async with open_session() as db:
        event = (
            await db.execute(
                select(NotificationOutbox).where(
                    NotificationOutbox.organization_id == document.access.org_id
                )
            )
        ).scalar_one()
        event_id, payload = event.event_id, event.payload
    with patch(
        "uniffy.domains.notifications.jobs.events.process_notification_event",
        AsyncMock(return_value={"status": "error"}),
    ):
        with pytest.raises(RuntimeError):
            await deliver_notification_outbox({}, str(event_id))
    async with open_session() as db:
        assert (await db.get(NotificationOutbox, event_id)).payload == payload
    delivered = AsyncMock(return_value={"status": "success"})
    with patch("uniffy.domains.notifications.jobs.events.process_notification_event", delivered):
        await deliver_notification_outbox({}, str(event_id))
        await deliver_notification_outbox({}, str(event_id))
    delivered.assert_awaited_once_with({}, payload)


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


async def test_inline_cleanup_waits_for_projection_and_retries_failed_effect(document):
    file_id = generate_id()
    doc = decode_snapshot(document.seed)
    markdown_text(doc).insert(4, f" ![image](/api/files/{document.access.org_id}/{file_id})")
    await accepted(document, doc)
    async with open_session() as db:
        await stage_inline_reconciliation(db, *document.key, document.access.org_id)
        await db.rollback()
        assert (
            await db.get(InlineAttachmentReconciliation, (document.key[0].value, document.key[1]))
            is None
        )
        await stage_inline_reconciliation(db, *document.key, document.access.org_id)
        await db.commit()
        item = await db.get(InlineAttachmentReconciliation, (document.key[0].value, document.key[1]))
    from_ctx = {"object_storage": MagicMock(), "search_indexer": MagicMock()}
    effect = AsyncMock()
    with patch("uniffy.domains.files.jobs.attachments.reconcile_inline_attachments", effect):
        await _reconcile(from_ctx, item)
        effect.assert_not_awaited()
        await project(document)
        effect.side_effect = OSError("storage down")
        with pytest.raises(OSError):
            await _reconcile(from_ctx, item)
        async with open_session() as db:
            assert (
                await db.get(InlineAttachmentReconciliation, (item.content_type, item.content_id))
                is not None
            )
        effect.side_effect = None
        await _reconcile(from_ctx, item)
        assert effect.await_args.kwargs["referenced_file_ids"] == {file_id}
        async with open_session() as db:
            assert (
                await db.get(InlineAttachmentReconciliation, (item.content_type, item.content_id))
                is None
            )


async def test_locked_hydration_refuses_deleted_content_without_orphan(document):
    async with open_session() as db:
        await db.execute(
            delete(RealtimeYjsSnapshot).where(RealtimeYjsSnapshot.content_id == document.key[1])
        )
        task = await db.get(Task, document.key[1])
        task.is_deleted = True
        await db.commit()
    with patch(
        "uniffy.core.realtime.ydoc_manager.get_realtime_adapter", return_value=document.adapter
    ):
        with pytest.raises(EditDenied):
            await YDocManager()._hydrate(
                document.key, document.access.org_id, document.access.member_id
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
    async with open_session() as db:
        await lock_document(db, document.key)
        assert await stage_mention_rename(db, document.key, document.access.org_id, urn, "Renamed")
        await db.commit()
    node = doc.get("nodes", type=pycrdt.Map)["node"]
    node["data"]["content"].insert(len(node["data"]["content"]), " peer")
    snapshot = await accepted(document, doc)
    merged = decode_snapshot(snapshot).get("nodes", type=pycrdt.Map)["node"]
    assert str(merged["data"]["content"]) == f"é [[[Renamed|{urn}]]] peer"
    assert merged["data"]["color"] == "red"
    assert merged["x"] == 22


async def test_document_limit_rejection_keeps_previous_durable_bytes(document):
    doc = decode_snapshot(document.seed)
    before = doc.get_state()
    markdown_text(doc).insert(0, "oversized")
    with patch("uniffy.core.realtime.storage.MAX_DOCUMENT_BYTES", 4):
        with pytest.raises(DocumentTooLarge):
            await accept_update(
                document.key,
                document.access.org_id,
                document.access.member_id,
                document.seed.generation,
                doc.get_update(before),
            )
    async with open_session() as db:
        stored = await load_snapshot(db, document.key)
        assert stored.updates == document.seed.updates
        assert stored.revision == document.seed.revision
