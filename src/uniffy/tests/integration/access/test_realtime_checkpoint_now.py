"""The checkpoint-now operator entry on live PostgreSQL and Valkey, in a disposable namespace."""

import io
from collections.abc import AsyncIterator

import pytest
import pytest_asyncio

from uniffy.core.realtime.adapter import get_realtime_adapter, register_realtime_adapter
from uniffy.core.types import ContentType
from uniffy.main import checkpoint_now
from uniffy.tests.integration.access.realtime_documents import discard
from uniffy.tests.integration.access.realtime_live import (
    BufferedDocument,
    buffered,
    live_note,  # noqa: F401 - fixture
    stored,
    text_of,
    typed,
    valkey,
)

pytestmark = pytest.mark.asyncio(loop_scope="session")

LIVE_TYPES = (ContentType.NOTE, ContentType.TASK, ContentType.CALENDAR_EVENT)


def registered_adapter(content_type: ContentType) -> object | None:
    try:
        return get_realtime_adapter(content_type)
    except LookupError:
        return None


@pytest_asyncio.fixture(loop_scope="session", autouse=True)
async def suite_adapters(live_note: BufferedDocument) -> AsyncIterator[dict]:
    """The adapters the suite registered; the operator entry replaces them, so they come back."""
    registered = {content_type: registered_adapter(content_type) for content_type in LIVE_TYPES}
    try:
        yield registered
    finally:
        for adapter in registered.values():
            if adapter is not None:
                register_realtime_adapter(adapter)


@pytest_asyncio.fixture(loop_scope="session")
async def gapped_note(access, live_note: BufferedDocument) -> AsyncIterator[BufferedDocument]:
    """A second note in the same namespace whose stream lost its middle record."""
    key = (ContentType.NOTE, access.shared_note_id)
    note = await buffered(key, access, live_note.namespace)
    try:
        for index, name in enumerate((" Dan", " Erin", " Frank"), start=1):
            await note.admit(f"u-{index}", typed(note.base, suffix=name))
        await valkey().xdel(note.keys.stream, "2-0")
        yield note
    finally:
        await discard(key)


async def unscheduled_edits(note: BufferedDocument) -> None:
    """Alice and Bob type, and the stream loses its due marker so no dispatcher would find it."""
    await note.admit("u-alice", typed(note.base, suffix=" Alice"))
    await note.admit("u-bob", typed(note.base, suffix=" Bob"), actor=note.peer)
    await valkey().zrem(note.keys.due, note.head.scope.member)


async def test_checkpoint_now_saves_a_stream_without_a_due_marker_and_exits_zero(
    live_note: BufferedDocument,
) -> None:
    await unscheduled_edits(live_note)
    out = io.StringIO()

    status = await checkpoint_now(live_note.buffer, out)

    assert status == 0
    row = await stored(live_note.key)
    assert row.checkpoint_seq == 2
    assert text_of(row.updates) in {"base Alice Bob", "base Bob Alice"}
    assert await live_note.buffer_state() == {
        "stream": [],
        "control": 1,
        "receipts": [],
        "due": None,
    }
    assert live_note.head.scope.member not in out.getvalue()


async def test_checkpoint_now_saves_what_it_can_and_exits_nonzero_naming_an_unreadable_stream(
    live_note: BufferedDocument, gapped_note: BufferedDocument
) -> None:
    await unscheduled_edits(live_note)
    out = io.StringIO()

    status = await checkpoint_now(live_note.buffer, out)

    assert status != 0
    row = await stored(live_note.key)
    assert row.checkpoint_seq == 2
    assert text_of(row.updates) in {"base Alice Bob", "base Bob Alice"}
    assert await live_note.stream_ids() == []
    recovered = await stored(gapped_note.key)
    assert recovered.buffer_epoch != gapped_note.head.scope.epoch
    assert text_of(recovered.updates) == " Dan"
    assert await gapped_note.stream_ids() == [b"3-0"]
    report = out.getvalue()
    assert gapped_note.head.scope.member in report
    assert live_note.head.scope.member not in report


async def test_checkpoint_now_registers_every_content_adapter_a_document_lock_needs(
    live_note: BufferedDocument, suite_adapters: dict
) -> None:
    await unscheduled_edits(live_note)

    status = await checkpoint_now(live_note.buffer, io.StringIO())

    assert status == 0
    # A process started for this command alone has nothing registered; the entry brings its own.
    assert all(
        registered_adapter(content_type) not in (None, suite_adapters[content_type])
        for content_type in LIVE_TYPES
    )
    assert (await stored(live_note.key)).checkpoint_seq == 2
