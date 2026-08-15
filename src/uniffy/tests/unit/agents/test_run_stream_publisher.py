"""RunStreamPublisher behaviour tests.

Covers token coalescing, monotonic sequence numbers, state-hash
refresh on every publish, and ordering on flush. The Valkey writes
are replaced with in-memory recorders so the test runs without a live
broker.
"""

import pytest

from uniffy.core.types import generate_id
from uniffy.domains.agents.providers.base import EventType, StreamEvent
from uniffy.domains.agents.runtime import publishers as publishers_mod
from uniffy.domains.agents.runtime.publishers import RunStreamPublisher


class _Recorder:
    def __init__(self) -> None:
        self.xadds: list[tuple[str, dict]] = []
        self.states: list[dict] = []

    async def stream_xadd(self, stream_key, payload, maxlen=200):
        self.xadds.append((stream_key, payload))
        return f"id-{len(self.xadds)}"

    async def set_run_state(self, **kwargs):
        self.states.append(kwargs)


def _patch(monkeypatch, recorder: _Recorder) -> None:
    monkeypatch.setattr(publishers_mod, "stream_xadd", recorder.stream_xadd)
    monkeypatch.setattr(publishers_mod, "set_run_state", recorder.set_run_state)


def _make_publisher(flush_ms: int = 0, buffer_cap: int = 32) -> RunStreamPublisher:
    return RunStreamPublisher(
        run_id=generate_id(),
        user_id=generate_id(),
        organization_id=generate_id(),
        session_id=generate_id(),
        flush_ms=flush_ms,
        buffer_cap=buffer_cap,
    )


class TestRunStreamPublisher:
    async def test_token_buffer_cap_flushes(self, monkeypatch) -> None:
        rec = _Recorder()
        _patch(monkeypatch, rec)
        pub = _make_publisher(flush_ms=1000, buffer_cap=3)

        async def run() -> None:
            await pub.publish(StreamEvent(type=EventType.TEXT_BLOCK_DELTA, delta="a"))
            await pub.publish(StreamEvent(type=EventType.TEXT_BLOCK_DELTA, delta="b"))
            await pub.publish(StreamEvent(type=EventType.TEXT_BLOCK_DELTA, delta="c"))

        await run()
        assert len(rec.xadds) == 1
        assert rec.xadds[0][1]["seq"] == 1
        assert rec.xadds[0][1]["event"]["delta"] == "abc"

    async def test_non_token_event_flushes_pending_tokens_first(self, monkeypatch) -> None:
        rec = _Recorder()
        _patch(monkeypatch, rec)
        pub = _make_publisher(flush_ms=0)

        async def run() -> None:
            await pub.publish(StreamEvent(type=EventType.TEXT_BLOCK_DELTA, delta="a"))
            await pub.publish(StreamEvent(type=EventType.TEXT_BLOCK_DELTA, delta="b"))
            await pub.publish(StreamEvent(type=EventType.ERROR, error="boom"))

        await run()
        assert [x[1]["seq"] for x in rec.xadds] == [1, 2, 3]
        assert rec.xadds[-1][1]["event"]["type"] == "error"

    async def test_block_change_flushes_before_buffering(self, monkeypatch) -> None:
        rec = _Recorder()
        _patch(monkeypatch, rec)
        pub = _make_publisher(flush_ms=1000, buffer_cap=32)

        async def run() -> None:
            await pub.publish(StreamEvent(type=EventType.TEXT_BLOCK_DELTA, delta="a", block_id="b1"))
            await pub.publish(
                StreamEvent(type=EventType.THINKING_BLOCK_DELTA, delta="t", block_id="b2")
            )
            await pub.close()

        await run()
        assert len(rec.xadds) == 2
        assert rec.xadds[0][1]["event"]["type"] == "text_block_delta"
        assert rec.xadds[0][1]["event"]["delta"] == "a"
        assert rec.xadds[1][1]["event"]["type"] == "thinking_block_delta"
        assert rec.xadds[1][1]["event"]["delta"] == "t"

    async def test_close_flushes_pending(self, monkeypatch) -> None:
        rec = _Recorder()
        _patch(monkeypatch, rec)
        pub = _make_publisher(flush_ms=1000, buffer_cap=64)

        async def run() -> None:
            await pub.publish(StreamEvent(type=EventType.TEXT_BLOCK_DELTA, delta="x"))
            await pub.close()

        await run()
        assert len(rec.xadds) == 1
        assert rec.xadds[0][1]["event"]["delta"] == "x"

    async def test_state_hash_refreshed_on_every_publish(self, monkeypatch) -> None:
        rec = _Recorder()
        _patch(monkeypatch, rec)
        pub = _make_publisher(flush_ms=0)

        async def run() -> None:
            await pub.publish(StreamEvent(type=EventType.TEXT_BLOCK_DELTA, delta="a"))
            await pub.publish(
                StreamEvent(
                    type=EventType.DONE,
                    assistant_message=_make_message_for_done(),
                    model="claude-sonnet-4-6",
                )
            )

        await run()
        assert rec.states[0]["status"] == "running"
        assert rec.states[-1]["status"] == "done"
        assert [s["last_seq"] for s in rec.states] == [1, 2]

    async def test_error_event_flips_status_to_error(self, monkeypatch) -> None:
        rec = _Recorder()
        _patch(monkeypatch, rec)
        pub = _make_publisher(flush_ms=0)

        async def run() -> None:
            await pub.publish(StreamEvent(type=EventType.ERROR, error="boom"))

        await run()
        assert rec.states[0]["status"] == "error"
        assert rec.states[0]["error"] == "boom"


def _make_message_for_done():
    from datetime import UTC, datetime

    from uniffy.core.models.agents.message import AgentMessage

    return AgentMessage(
        id=generate_id(),
        session_id=generate_id(),
        role="assistant",
        content="done",
        created_at=datetime.now(UTC),
    )


@pytest.fixture(autouse=True)
def _reset_loop():
    yield
