import asyncio
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pycrdt
import pytest
import pytest_asyncio
from sqlalchemy import delete, select, update

from uniffy.core.errors import StaleContentVersionError
from uniffy.core.models.notes.note import Note
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.task import Task
from uniffy.core.models.projects.sprint import Sprint as _Sprint  # noqa: F401
from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime.markdown import markdown_text
from uniffy.core.realtime.snapshot import persist_snapshot
from uniffy.core.realtime.storage import (
    EditDenied,
    claim_seed,
    GenerationConflict,
    accept_update,
    decode_snapshot,
    load_snapshot,
    lock_document,
    stage_seed,
    stage_replacement,
)
from uniffy.core.types import AccessMode, ContentType, ContentRole, SubjectType, generate_id
from uniffy.domains.notes.adapter import NoteRealtimeAdapter
from uniffy.domains.notes.operations import NoteOperations
from uniffy.domains.projects.realtime import TaskRealtimeAdapter
from uniffy.infrastructure.database.session import open_session

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
    assert await claim_seed(document.key, org, ["left:1"], "left") == "left:1"
    assert await claim_seed(document.key, org, ["right:2"], "right") == "left:1"
    async with open_session() as db:
        snapshot = await load_snapshot(db, document.key)
        snapshot.seed_expires_at = datetime.now(UTC) - timedelta(seconds=1)
        await db.commit()
    assert await claim_seed(document.key, org, ["right:2"], "right") == "right:2"


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
