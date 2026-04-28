"""RunStreamPublisher behaviour tests.

Covers token coalescing, monotonic sequence numbers, state-hash
refresh on every publish, and ordering on flush. The Valkey writes
are replaced with in-memory recorders so the test runs without a live
broker.
"""

import asyncio

import pytest

from uniffy.core.types import generate_id as uuid7
from uniffy.domains.agents.runtime import publishers as publishers_mod
from uniffy.domains.agents.runtime.publishers import RunStreamPublisher
from uniffy.domains.agents.runtime.stream_events import (
    RuntimeDoneEvent,
    RuntimeErrorEvent,
    RuntimeTokenEvent,
)


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
        run_id=uuid7(),
        user_id=uuid7(),
        organization_id=uuid7(),
        session_id=uuid7(),
        flush_ms=flush_ms,
        buffer_cap=buffer_cap,
    )


class TestRunStreamPublisher:
    def test_token_buffer_cap_flushes(self, monkeypatch) -> None:
        rec = _Recorder()
        _patch(monkeypatch, rec)
        pub = _make_publisher(flush_ms=1000, buffer_cap=3)

        async def run() -> None:
            await pub.publish(RuntimeTokenEvent(text="a"))
            await pub.publish(RuntimeTokenEvent(text="b"))
            await pub.publish(RuntimeTokenEvent(text="c"))

        asyncio.run(run())
        assert len(rec.xadds) == 1
        assert rec.xadds[0][1]["seq"] == 1
        assert rec.xadds[0][1]["event"]["text"] == "abc"

    def test_non_token_event_flushes_pending_tokens_first(self, monkeypatch) -> None:
        rec = _Recorder()
        _patch(monkeypatch, rec)
        pub = _make_publisher(flush_ms=0)

        async def run() -> None:
            await pub.publish(RuntimeTokenEvent(text="a"))
            await pub.publish(RuntimeTokenEvent(text="b"))
            await pub.publish(RuntimeErrorEvent(error="boom"))

        asyncio.run(run())
        assert [x[1]["seq"] for x in rec.xadds] == [1, 2, 3]
        assert rec.xadds[-1][1]["event"]["type"] == "error"

    def test_close_flushes_pending(self, monkeypatch) -> None:
        rec = _Recorder()
        _patch(monkeypatch, rec)
        pub = _make_publisher(flush_ms=1000, buffer_cap=64)

        async def run() -> None:
            await pub.publish(RuntimeTokenEvent(text="x"))
            await pub.close()

        asyncio.run(run())
        assert len(rec.xadds) == 1
        assert rec.xadds[0][1]["event"]["text"] == "x"

    def test_state_hash_refreshed_on_every_publish(self, monkeypatch) -> None:
        rec = _Recorder()
        _patch(monkeypatch, rec)
        pub = _make_publisher(flush_ms=0)

        async def run() -> None:
            await pub.publish(RuntimeTokenEvent(text="a"))
            await pub.publish(
                RuntimeDoneEvent(
                    assistant_message=_make_message_for_done(),
                    model_used="claude-sonnet-4-6",
                )
            )

        asyncio.run(run())
        assert rec.states[0]["status"] == "running"
        assert rec.states[-1]["status"] == "done"
        assert [s["last_seq"] for s in rec.states] == [1, 2]

    def test_error_event_flips_status_to_error(self, monkeypatch) -> None:
        rec = _Recorder()
        _patch(monkeypatch, rec)
        pub = _make_publisher(flush_ms=0)

        async def run() -> None:
            await pub.publish(RuntimeErrorEvent(error="boom"))

        asyncio.run(run())
        assert rec.states[0]["status"] == "error"
        assert rec.states[0]["error"] == "boom"


def _make_message_for_done():
    from datetime import UTC, datetime

    from uniffy.core.models.agents.message import AgentMessage

    return AgentMessage(
        id=uuid7(),
        session_id=uuid7(),
        role="assistant",
        content="done",
        created_at=datetime.now(UTC),
    )


@pytest.fixture(autouse=True)
def _reset_loop():
    yield
