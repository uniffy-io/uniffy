"""Calendar descriptions merge with, copy, keep and retire accepted realtime edits in the buffer."""

from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

import pytest
import pytest_asyncio
from connectrpc.code import Code
from connectrpc.errors import ConnectError
from sqlalchemy import delete, select, update
from uniffy_proto.cal.v1.calendar_pb import (
    DeleteEventRequest,
    UpdateEventRequest,
    UpdateEventResponse,
)
from uniffy_proto.cal.v1.calendar_pb import EventStatus as ProtoEventStatus
from uniffy_proto.cal.v1.calendar_pb import RecurrenceEditScope as ProtoRecurrenceEditScope

from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime.adapter import register_realtime_adapter
from uniffy.core.realtime.buffer import UpdateBuffer
from uniffy.core.realtime.buffer_keys import AdmissionStatus
from uniffy.core.realtime.storage import load_snapshot, lock_document, stage_seed
from uniffy.core.search.indexer import SearchIndexer
from uniffy.core.types import AccessMode, ContentType, RecurrencePattern
from uniffy.domains.agents.tools.builtin.calendar import _execute_read_event
from uniffy.domains.agents.tools.definitions import ToolContext
from uniffy.domains.scheduling.calendar.realtime import EventRealtimeAdapter
from uniffy.domains.scheduling.calendar.service import CalendarServiceImpl
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


@pytest_asyncio.fixture(loop_scope="session")
async def live_event(access, valkey_namespace) -> AsyncIterator[BufferedDocument]:
    """A member's event whose description document is seeded and bound to a fresh buffer epoch."""
    register_realtime_adapter(EventRealtimeAdapter(AsyncMock()))
    async with open_session() as db:
        calendar = Calendar(organization_id=access.org_id, owner_id=access.member_id, name="Live")
        db.add(calendar)
        await db.flush()
        start = datetime.now(UTC)
        event = CalendarEvent(
            organization_id=access.org_id,
            organizer_id=access.member_id,
            calendar_id=calendar.id,
            title="Live",
            description="base",
            start_time=start,
            end_time=start + timedelta(hours=1),
            access_mode=AccessMode.OWNER_ONLY,
        )
        db.add(event)
        await db.commit()
        key = (ContentType.CALENDAR_EVENT, event.id)
        await lock_document(db, key, access.org_id)
        row = await stage_seed(db, key, access.org_id)
        await db.commit()
        base, generation = row.updates, row.generation
    assert generation is not None
    buffer = UpdateBuffer(namespace=valkey_namespace, pending_budget_bytes=BUDGET)
    try:
        yield BufferedDocument(
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
    finally:
        async with open_session() as db:
            await db.execute(
                delete(RealtimeYjsSnapshot).where(
                    RealtimeYjsSnapshot.content_type == ContentType.CALENDAR_EVENT,
                    RealtimeYjsSnapshot.content_id.in_(
                        select(CalendarEvent.id).where(
                            CalendarEvent.organization_id == access.org_id
                        )
                    ),
                )
            )
            await db.commit()


@pytest_asyncio.fixture(loop_scope="session")
async def event_outage(live_event) -> AsyncIterator[UpdateBuffer]:
    async with unreachable(live_event.namespace) as buffer:
        yield buffer


@pytest_asyncio.fixture(loop_scope="session")
async def event_messages(live_event) -> AsyncIterator[Any]:
    async with doc_subscription(live_event.key) as subscription:
        yield subscription


def calendar_service(buffer: UpdateBuffer) -> CalendarServiceImpl:
    service = CalendarServiceImpl(AsyncMock(spec=SearchIndexer), MagicMock())
    service.buffer = buffer
    return service


async def update_event(
    event: BufferedDocument, buffer: UpdateBuffer, **fields: Any
) -> UpdateEventResponse:
    """Call the UpdateEvent RPC as the organizer, against ``buffer``."""
    request = UpdateEventRequest(
        event_id=str(event.key[1]), organization_id=str(event.org), **fields
    )
    return await call_rpc(
        calendar_service(buffer).update_event,
        request,
        user_id=event.owner,
        organization_id=event.org,
    )


async def delete_event(event: BufferedDocument, buffer: UpdateBuffer, **fields: Any) -> None:
    """Call the DeleteEvent RPC as the organizer, against ``buffer``."""
    request = DeleteEventRequest(
        event_id=str(event.key[1]), organization_id=str(event.org), **fields
    )
    await call_rpc(
        calendar_service(buffer).delete_event,
        request,
        user_id=event.owner,
        organization_id=event.org,
    )


async def seeded_occurrence(master: BufferedDocument, event_id: UUID) -> BufferedDocument:
    """A moved occurrence whose own description document is seeded and bound to an epoch."""
    key = (ContentType.CALENDAR_EVENT, event_id)
    async with open_session() as db:
        await lock_document(db, key, master.org)
        row = await stage_seed(db, key, master.org)
        await db.commit()
        base, generation = row.updates, row.generation
    assert generation is not None
    return BufferedDocument(
        key=key,
        org=master.org,
        owner=master.owner,
        peer=master.peer,
        namespace=master.namespace,
        buffer=master.buffer,
        base=base,
        generation=generation,
        head=await establish(master.buffer, key, master.org),
    )


async def assert_retired(event: BufferedDocument, late: bytes) -> None:
    """No snapshot row and no buffer keys remain, and an append under the old head is refused."""
    async with open_session() as db:
        assert await load_snapshot(db, event.key) is None
    assert await event.buffer_state() == {
        "stream": [],
        "control": 0,
        "receipts": [],
        "due": None,
    }
    refused = await event.buffer.admit(
        event.head, update_id="u-late", update=late, actor_id=event.owner
    )
    assert refused.status is AdmissionStatus.RECOVERY_REQUIRED


async def event_row(event: BufferedDocument) -> CalendarEvent:
    async with open_session() as db:
        row = await db.get(CalendarEvent, event.key[1])
    assert row is not None
    return row


async def unchanged(event: BufferedDocument) -> tuple[Any, ...]:
    """The committed event, checkpoint and buffer, for comparing before and after a write."""
    row, snapshot = await event_row(event), await stored(event.key)
    return (
        (row.title, row.description),
        (
            snapshot.updates,
            snapshot.revision,
            snapshot.rendered_revision,
            snapshot.checkpoint_seq,
            snapshot.buffer_epoch,
        ),
        await event.buffer_state(),
    )


async def make_recurring(event: BufferedDocument) -> str:
    """Turn the event into a daily series; returns the next occurrence date for scoped edits."""
    async with open_session() as db:
        await db.execute(
            update(CalendarEvent)
            .where(CalendarEvent.id == event.key[1])
            .values(recurrence_pattern=RecurrencePattern.DAILY)
        )
        await db.commit()
    return ((await event_row(event)).start_time + timedelta(days=1)).date().isoformat()


async def calendar_descriptions(event: BufferedDocument) -> dict[str, str | None]:
    """Every event on the master's calendar, so a copy shows up whatever series it joins."""
    master = await event_row(event)
    async with open_session() as db:
        rows = (
            await db.execute(
                select(CalendarEvent.id, CalendarEvent.description).where(
                    CalendarEvent.calendar_id == master.calendar_id
                )
            )
        ).all()
    return {str(event_id): description for event_id, description in rows}


async def test_stale_base_description_merges_the_buffered_tail_and_announces_its_coverage(
    live_event: BufferedDocument, event_messages
) -> None:
    alice = typed(live_event.base, suffix=" Alice")
    await live_event.admit("u-alice", alice)
    bob = await live_event.admit(
        "u-bob", typed(live_event.base, alice, suffix=" Bob"), live_event.peer
    )
    before = await stored(live_event.key)

    response = await update_event(
        live_event, live_event.buffer, description="base agent", base_description="base"
    )

    assert response.event.description == "base Alice Bob agent"
    assert (await event_row(live_event)).description == "base Alice Bob agent"
    row = await stored(live_event.key)
    assert text_of(row.updates) == "base Alice Bob agent"
    assert (row.generation, row.buffer_epoch, row.checkpoint_seq) == (
        live_event.generation,
        live_event.head.scope.epoch,
        bob,
    )
    assert row.revision == row.rendered_revision == before.revision + 1
    assert row.actor_id == live_event.owner
    assert await live_event.buffer_state() == {
        "stream": [],
        "control": 1,
        "receipts": [],
        "due": None,
    }
    # Bob holds only an accepted receipt; this progress is what moves him to saved.
    assert await published_progress(event_messages) == [
        {
            "generation": live_event.generation,
            "epoch": live_event.head.scope.epoch,
            "covered_sequence": bob,
            "checkpoint_revision": row.revision,
        }
    ]


@pytest.mark.parametrize(
    "fields",
    [
        {"title": "Renamed"},
        {"title": "Renamed", "description": "base", "base_description": "base"},
    ],
    ids=["title_only", "unchanged_description"],
)
async def test_metadata_save_leaves_checkpoint_and_tail_alone_even_without_valkey(
    live_event: BufferedDocument, event_outage, event_messages, fields: dict[str, str]
) -> None:
    await live_event.admit("u-alice", typed(live_event.base, suffix=" Alice"))
    (_, description), checkpoint, buffered = await unchanged(live_event)

    response = await update_event(live_event, event_outage, **fields)

    assert (response.event.title, response.event.description) == ("Renamed", description)
    assert await unchanged(live_event) == (("Renamed", description), checkpoint, buffered)
    assert await published_progress(event_messages) == []


async def test_unverifiable_buffer_fails_the_description_rpc_retryably_and_the_retry_lands(
    live_event: BufferedDocument, event_outage
) -> None:
    await live_event.admit("u-alice", typed(live_event.base, suffix=" Alice"), live_event.peer)
    before = await unchanged(live_event)
    submission = {"title": "Agenda", "description": "base agent", "base_description": "base"}

    with pytest.raises(ConnectError) as refused:
        await update_event(live_event, event_outage, **submission)

    assert refused.value.code is Code.UNAVAILABLE
    assert await unchanged(live_event) == before
    response = await update_event(live_event, live_event.buffer, **submission)
    assert (response.event.title, response.event.description) == ("Agenda", "base Alice agent")
    assert (await stored(live_event.key)).checkpoint_seq == 1


@pytest.mark.parametrize(
    "scope", [ProtoRecurrenceEditScope.THIS_EVENT, ProtoRecurrenceEditScope.THIS_AND_FOLLOWING]
)
@pytest.mark.parametrize(
    ("fields", "copied"),
    [
        ({}, "base Alice"),
        ({"description": "base agent", "base_description": "base"}, "base Alice agent"),
    ],
    ids=["metadata", "description"],
)
async def test_occurrence_copy_carries_buffered_text_and_leaves_the_master_pending(
    live_event: BufferedDocument,
    scope: ProtoRecurrenceEditScope,
    fields: dict[str, str],
    copied: str,
) -> None:
    await live_event.admit("u-alice", typed(live_event.base, suffix=" Alice"), live_event.peer)
    occurrence = await make_recurring(live_event)
    before = await unchanged(live_event)

    response = await update_event(
        live_event,
        live_event.buffer,
        title="Occurrence",
        recurrence_edit_scope=scope,
        occurrence_date=occurrence,
        **fields,
    )

    assert (response.event.title, response.event.description) == ("Occurrence", copied)
    # The master keeps its column, checkpoint and pending tail for the checkpoint worker.
    assert await unchanged(live_event) == before
    assert await calendar_descriptions(live_event) == {
        str(live_event.key[1]): "base",
        response.event.id: copied,
    }


async def test_unverifiable_master_refuses_an_occurrence_copy_without_creating_it(
    live_event: BufferedDocument, event_outage
) -> None:
    await live_event.admit("u-alice", typed(live_event.base, suffix=" Alice"), live_event.peer)
    occurrence = await make_recurring(live_event)
    before = await unchanged(live_event)

    with pytest.raises(ConnectError) as refused:
        await update_event(
            live_event,
            event_outage,
            title="Occurrence",
            recurrence_edit_scope=ProtoRecurrenceEditScope.THIS_EVENT,
            occurrence_date=occurrence,
        )

    assert refused.value.code is Code.UNAVAILABLE
    assert await unchanged(live_event) == before
    assert await calendar_descriptions(live_event) == {str(live_event.key[1]): "base"}


async def test_agent_read_shows_accepted_text_that_the_stored_description_lacks(
    live_event: BufferedDocument,
) -> None:
    async def read() -> list[str]:
        async with open_session() as db:
            context = ToolContext(
                session=db,
                user_id=live_event.owner,
                organization_id=live_event.org,
                user_timezone="UTC",
            )
            result = await _execute_read_event(context, {"event_id": str(live_event.key[1])})
        assert result.success
        return result.data.splitlines()

    await live_event.admit("u-human", typed(live_event.base, suffix=" human"))
    await live_event.checkpointed()
    # The agent reads through the process buffer namespace, so leave it no epoch to consult.
    async with open_session() as db:
        await db.execute(
            update(RealtimeYjsSnapshot)
            .where(RealtimeYjsSnapshot.content_id == live_event.key[1])
            .values(buffer_epoch=None, valkey_run_id=None)
        )
        await db.commit()

    assert "Description: base human" in await read()
    assert (await event_row(live_event)).description == "base"


async def test_agent_read_keeps_the_stored_description_while_live_edits_cannot_be_verified(
    live_event: BufferedDocument,
) -> None:
    await live_event.admit("u-alice", typed(live_event.base, suffix=" Alice"), live_event.peer)

    async with buffering_disabled():
        async with open_session() as db:
            context = ToolContext(
                session=db,
                user_id=live_event.owner,
                organization_id=live_event.org,
                user_timezone="UTC",
            )
            result = await _execute_read_event(context, {"event_id": str(live_event.key[1])})

    # The stored text is what the agent sees; a later description merge keeps Alice's edit.
    assert result.success
    assert "Description: base" in result.data.splitlines()


@pytest.mark.parametrize("permanent", [False, True], ids=["trash", "permanent"])
async def test_event_deletion_retires_the_pending_description_and_refuses_later_appends(
    live_event: BufferedDocument, permanent: bool
) -> None:
    pending = typed(live_event.base, suffix=" pending")
    await live_event.admit("u-pending", pending, live_event.peer)

    await delete_event(live_event, live_event.buffer, permanent=permanent)

    await assert_retired(live_event, typed(live_event.base, pending, suffix=" late"))


async def test_event_deletion_commits_while_valkey_is_unreachable(
    live_event: BufferedDocument, event_outage: UpdateBuffer
) -> None:
    await live_event.admit("u-pending", typed(live_event.base, suffix=" pending"), live_event.peer)

    await delete_event(live_event, event_outage)

    assert (await event_row(live_event)).is_deleted
    async with open_session() as db:
        assert await load_snapshot(db, live_event.key) is None


async def test_withdrawing_following_occurrences_retires_a_moved_occurrence_description(
    live_event: BufferedDocument,
) -> None:
    occurrence = await make_recurring(live_event)
    moved = await update_event(
        live_event,
        live_event.buffer,
        title="Moved",
        recurrence_edit_scope=ProtoRecurrenceEditScope.THIS_EVENT,
        occurrence_date=occurrence,
    )
    override = await seeded_occurrence(live_event, UUID(moved.event.id))
    pending = typed(override.base, suffix=" pending")
    await override.admit("u-pending", pending, override.peer)
    master = await live_event.buffer_state()

    await delete_event(
        live_event,
        live_event.buffer,
        recurrence_edit_scope=ProtoRecurrenceEditScope.THIS_AND_FOLLOWING,
        occurrence_date=occurrence,
    )

    assert (await event_row(override)).is_deleted
    await assert_retired(override, typed(override.base, pending, suffix=" late"))
    # The series keeps its own description document up to the withdrawn range.
    assert not (await event_row(live_event)).is_deleted
    assert await live_event.buffer_state() == master


async def test_cancelling_following_occurrences_retires_a_moved_occurrence_description(
    live_event: BufferedDocument,
) -> None:
    occurrence = await make_recurring(live_event)
    moved = await update_event(
        live_event,
        live_event.buffer,
        title="Moved",
        recurrence_edit_scope=ProtoRecurrenceEditScope.THIS_EVENT,
        occurrence_date=occurrence,
    )
    override = await seeded_occurrence(live_event, UUID(moved.event.id))
    pending = typed(override.base, suffix=" pending")
    await override.admit("u-pending", pending, override.peer)

    await update_event(
        live_event,
        live_event.buffer,
        status=ProtoEventStatus.CANCELLED,
        recurrence_edit_scope=ProtoRecurrenceEditScope.THIS_AND_FOLLOWING,
        occurrence_date=occurrence,
    )

    assert (await event_row(override)).is_deleted
    await assert_retired(override, typed(override.base, pending, suffix=" late"))
