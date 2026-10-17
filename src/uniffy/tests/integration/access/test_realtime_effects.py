"""Projection effects of accepted edits: mentions, search, renames, notifications, inline uploads."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import pycrdt
import pytest
from sqlalchemy import delete, select

from uniffy.core.database import SESSION_FACTORY_CTX_KEY
from uniffy.core.events.bus import emit_notification, event_from_json, stage_notification_events
from uniffy.core.events.types import NotificationEvent
from uniffy.core.models.files.attachment import Attachment
from uniffy.core.models.files.file import File
from uniffy.core.models.files.reconciliation import InlineAttachmentReconciliation
from uniffy.core.models.notifications.notification import Notification
from uniffy.core.models.notifications.outbox import NotificationOutbox
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.models.projects.task import Task
from uniffy.core.realtime.job_contracts import PROJECT_REALTIME_DOCUMENT
from uniffy.core.realtime.markdown import markdown_text
from uniffy.core.realtime.rename import stage_mention_rename
from uniffy.core.realtime.storage import decode_snapshot, load_snapshot, lock_document
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
from uniffy.infrastructure.database.session import open_session
from uniffy.tests.integration.access.realtime_live import Recorder
from uniffy.tests.integration.access.realtime_tasks import (
    accepted,
    document,  # noqa: F401 - fixture
    project,
)

pytestmark = pytest.mark.asyncio(loop_scope="session")


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
    assert [job[0] for job in jobs.jobs] == [PROJECT_REALTIME_DOCUMENT.name]
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
