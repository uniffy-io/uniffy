"""Agent session job behavior tests."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any
from uuid import UUID

import pytest

from uniffy.core.database import SESSION_FACTORY_CTX_KEY
from uniffy.core.models.agents.message import AgentMessage
from uniffy.core.search import SEARCH_INDEXER_CTX_KEY
from uniffy.core.storage import OBJECT_STORAGE_CTX_KEY
from uniffy.core.types import generate_id
from uniffy.domains.agents.providers.base import EventType, StreamEvent
from uniffy.domains.agents.runtime.jobs import jobs as agent_run_mod
from uniffy.domains.agents.runtime.jobs.contracts import DELETE_RUN_STREAM
from uniffy.domains.calls.lifecycle import CALL_LIFECYCLE_CTX_KEY


@pytest.fixture(autouse=True)
def _runtime_settings(monkeypatch):
    async def resolve(_session, _organization_id):
        return SimpleNamespace(send_deadline_seconds=300)

    monkeypatch.setattr(agent_run_mod, "get_runtime_settings", resolve)


class _FakeValkey:
    def __init__(self) -> None:
        self.enqueued: list[tuple[str, tuple[Any, ...], dict[str, Any]]] = []

    async def enqueue_job(self, name: str, *args: Any, **kwargs: Any) -> None:
        self.enqueued.append((name, args, kwargs))


class _FakeOpsClient:
    def __init__(self, *, lock_acquired: bool = True) -> None:
        self._lock_acquired = lock_acquired
        self.set_calls: list[tuple[str, dict[str, Any]]] = []
        self.delete_calls: list[str] = []
        self._held: dict[str, str] = {}

    async def set(self, key: str, value: str, **kwargs: Any) -> bool:
        self.set_calls.append((key, kwargs))
        if self._lock_acquired:
            self._held[key] = value
        return self._lock_acquired

    async def eval(self, _script: str, _numkeys: int, key: str, token: str) -> int:
        self.delete_calls.append(key)
        if self._held.get(key) != token:
            return 0
        self._held.pop(key)
        return 1


class _PublisherRecorder:
    def __init__(self) -> None:
        self.events: list[StreamEvent] = []
        self.closed = False
        self.last_seq = 0

    async def publish(self, event: StreamEvent) -> None:
        self.events.append(event)
        self.last_seq += 1

    async def close(self) -> None:
        self.closed = True


class _StubSessionOps:
    def __init__(self, _session: Any) -> None:
        self.calls: list[dict[str, UUID]] = []

    async def get_session(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        session_id: UUID,
    ) -> dict[str, UUID]:
        self.calls.append({
            "user_id": user_id,
            "organization_id": organization_id,
            "session_id": session_id,
        })
        return {"id": session_id, "user_id": user_id}


def _install_session_stub(monkeypatch) -> list[_StubSessionOps]:
    instances: list[_StubSessionOps] = []

    def factory(session: Any) -> _StubSessionOps:
        ops = _StubSessionOps(session)
        instances.append(ops)
        return ops

    monkeypatch.setattr(agent_run_mod, "SessionOperations", factory)
    return instances


def _install_runtime_stub(
    monkeypatch,
    events: list[StreamEvent] | None = None,
    raises: BaseException | None = None,
) -> list[Any]:
    captured: list[Any] = []

    class _Stub:
        def __init__(
            self,
            _session: Any,
            _storage: Any,
            _search_indexer: Any,
            _session_factory: Any,
            _call_lifecycle: Any,
        ) -> None:
            captured.append(self)
            self.invocations: list[dict[str, Any]] = []

        def stream_send_message(self, **kwargs: Any):
            self.invocations.append(kwargs)
            return _stream(events or [], raises)

    monkeypatch.setattr(agent_run_mod, "RuntimeOperations", _Stub)
    return captured


async def _stream(
    events: list[StreamEvent],
    raises: BaseException | None,
):
    for ev in events:
        yield ev
    if raises is not None:
        raise raises


def _install_publisher_stub(monkeypatch) -> _PublisherRecorder:
    recorder = _PublisherRecorder()

    def factory(**_kwargs: Any) -> _PublisherRecorder:
        return recorder

    monkeypatch.setattr(agent_run_mod, "RunStreamPublisher", factory)
    return recorder


def _install_state_stub(monkeypatch) -> list[dict[str, Any]]:
    states: list[dict[str, Any]] = []

    async def fake_set_run_state(**kwargs: Any) -> None:
        states.append(kwargs)

    monkeypatch.setattr(agent_run_mod, "set_run_state", fake_set_run_state)
    return states


def _install_ops_client(monkeypatch, *, lock_acquired: bool = True) -> _FakeOpsClient:
    client = _FakeOpsClient(lock_acquired=lock_acquired)
    monkeypatch.setattr(agent_run_mod, "get_ops_client", lambda: client)
    return client


def _make_done_event() -> StreamEvent:
    return StreamEvent(
        type=EventType.DONE,
        assistant_message=AgentMessage(
            id=generate_id(),
            session_id=generate_id(),
            role="assistant",
            content="ok",
            created_at=datetime.now(UTC),
        ),
        model="claude-sonnet-4-6",
    )


def _ids() -> dict[str, str]:
    return {
        "run_id": str(generate_id()),
        "user_id": str(generate_id()),
        "organization_id": str(generate_id()),
        "session_id": str(generate_id()),
    }


def _worker_ctx(valkey: _FakeValkey | None = None) -> dict[str, Any]:
    @asynccontextmanager
    async def session_factory():
        yield object()

    return {
        "valkey": valkey or _FakeValkey(),
        SESSION_FACTORY_CTX_KEY: session_factory,
        OBJECT_STORAGE_CTX_KEY: object(),
        SEARCH_INDEXER_CTX_KEY: object(),
        CALL_LIFECYCLE_CTX_KEY: object(),
    }


class TestRunAgentSession:
    async def test_configured_deadline_stops_the_run(self, monkeypatch) -> None:
        ops_client = _install_ops_client(monkeypatch)
        _install_session_stub(monkeypatch)
        publisher = _install_publisher_stub(monkeypatch)
        _install_state_stub(monkeypatch)

        async def settings(_session, _organization_id):
            return SimpleNamespace(send_deadline_seconds=0.01)

        class Runtime:
            def __init__(
                self,
                _session: Any,
                _storage: Any,
                _search_indexer: Any,
                _session_factory: Any,
                _call_lifecycle: Any,
            ) -> None:
                pass

            async def stream_send_message(self, **_kwargs: Any):
                await asyncio.Future()
                yield StreamEvent(type=EventType.DONE)

        monkeypatch.setattr(agent_run_mod, "get_runtime_settings", settings)
        monkeypatch.setattr(agent_run_mod, "RuntimeOperations", Runtime)

        result = await agent_run_mod.run_agent_session(
            ctx=_worker_ctx(),
            content="hi",
            files=None,
            user_timezone=None,
            **_ids(),
        )

        assert result["error"] == "agent_deadline_exceeded"
        assert publisher.events[-1].error == "agent_deadline_exceeded"
        assert ops_client.delete_calls

    async def test_lock_loss_skips_runtime(self, monkeypatch) -> None:
        ops_client = _install_ops_client(monkeypatch, lock_acquired=False)
        session_ops = _install_session_stub(monkeypatch)
        runtime_ops = _install_runtime_stub(monkeypatch, events=[_make_done_event()])
        publisher = _install_publisher_stub(monkeypatch)
        _install_state_stub(monkeypatch)
        valkey = _FakeValkey()

        async def run() -> dict[str, Any]:
            return await agent_run_mod.run_agent_session(
                ctx=_worker_ctx(valkey),
                content="hi",
                files=None,
                user_timezone=None,
                **_ids(),
            )

        result = await run()
        assert result["status"] == "skipped"
        assert result["reason"] == "lock_held"
        assert ops_client.set_calls, "lock SET NX must be attempted"
        assert ops_client.delete_calls == [], "no release without acquire"
        assert session_ops == [], "session ops never constructed"
        assert runtime_ops == [], "runtime never invoked"
        assert publisher.events == [], "publisher never called"

    async def test_done_path_schedules_cleanup(self, monkeypatch) -> None:
        ops_client = _install_ops_client(monkeypatch)
        _install_session_stub(monkeypatch)
        _install_runtime_stub(
            monkeypatch,
            events=[
                StreamEvent(type=EventType.TEXT_BLOCK_DELTA, delta="hello", sequence=1),
                _make_done_event(),
            ],
        )
        publisher = _install_publisher_stub(monkeypatch)
        _install_state_stub(monkeypatch)
        valkey = _FakeValkey()

        async def run() -> dict[str, Any]:
            return await agent_run_mod.run_agent_session(
                ctx=_worker_ctx(valkey),
                content="hi",
                files=None,
                user_timezone=None,
                **_ids(),
            )

        result = await run()
        assert result["status"] == "success"
        assert publisher.closed is True, "publisher must be closed in finally"
        assert ops_client.delete_calls, "lock must be released after run"
        assert len(valkey.enqueued) == 1
        name, args, kwargs = valkey.enqueued[0]
        assert name == DELETE_RUN_STREAM.name
        assert kwargs.get("_defer_by") == agent_run_mod._DELETE_DEFER_SECONDS
        assert args == (result["run_id"],)
        # Done event was the last published; intermediate token also seen.
        types = [ev.type for ev in publisher.events]
        assert types == [EventType.TEXT_BLOCK_DELTA, EventType.DONE]

    async def test_no_done_event_skips_cleanup(self, monkeypatch) -> None:
        _install_ops_client(monkeypatch)
        _install_session_stub(monkeypatch)
        _install_runtime_stub(
            monkeypatch,
            events=[StreamEvent(type=EventType.TEXT_BLOCK_DELTA, delta="partial", sequence=1)],
        )
        _install_publisher_stub(monkeypatch)
        _install_state_stub(monkeypatch)
        valkey = _FakeValkey()

        async def run() -> dict[str, Any]:
            return await agent_run_mod.run_agent_session(
                ctx=_worker_ctx(valkey),
                content="hi",
                files=None,
                user_timezone=None,
                **_ids(),
            )

        result = await run()
        assert result["status"] == "success"
        assert valkey.enqueued == [], "no cleanup without a DONE event"

    async def test_exception_emits_synthetic_error_and_reraises(self, monkeypatch) -> None:
        _install_ops_client(monkeypatch)
        _install_session_stub(monkeypatch)
        boom = RuntimeError("driver blew up")
        _install_runtime_stub(monkeypatch, events=[], raises=boom)
        publisher = _install_publisher_stub(monkeypatch)
        states = _install_state_stub(monkeypatch)
        valkey = _FakeValkey()

        async def run() -> Any:
            return await agent_run_mod.run_agent_session(
                ctx=_worker_ctx(valkey),
                content="hi",
                files=None,
                user_timezone=None,
                **_ids(),
            )

        with pytest.raises(RuntimeError, match="driver blew up"):
            await run()

        assert publisher.closed is True
        error_events = [e for e in publisher.events if e.type is EventType.ERROR]
        assert len(error_events) == 1
        assert error_events[0].error == "driver blew up"

        assert states, "state hash must be flipped to error"
        last_state = states[-1]
        assert last_state["status"] == "error"
        assert last_state["error"] == "driver blew up"
        assert valkey.enqueued == [], "no cleanup scheduled on failure"

    async def test_invalid_uuid_returns_error_without_lock(self, monkeypatch) -> None:
        ops_client = _install_ops_client(monkeypatch)
        runtime_ops = _install_runtime_stub(monkeypatch, events=[_make_done_event()])

        async def run() -> dict[str, Any]:
            return await agent_run_mod.run_agent_session(
                ctx=_worker_ctx(),
                run_id="not-a-uuid",
                user_id=str(generate_id()),
                organization_id=str(generate_id()),
                session_id=str(generate_id()),
                content="hi",
                files=None,
                user_timezone=None,
            )

        result = await run()
        assert result == {"status": "error", "error": "invalid_uuid"}
        assert ops_client.set_calls == []
        assert runtime_ops == []

    async def test_files_payload_rebuilt_into_file_contexts(self, monkeypatch) -> None:
        _install_ops_client(monkeypatch)
        _install_session_stub(monkeypatch)
        captured = _install_runtime_stub(monkeypatch, events=[_make_done_event()])
        _install_publisher_stub(monkeypatch)
        _install_state_stub(monkeypatch)

        files = [
            {
                "file_id": str(generate_id()),
                "media_type": "image/png",
                "filename": "diagram.png",
                "storage_key": "org/diagram.png",
                "extracted_text": None,
                "extraction_status": "COMPLETED",
            }
        ]

        async def run() -> dict[str, Any]:
            return await agent_run_mod.run_agent_session(
                ctx=_worker_ctx(),
                content="hi",
                files=files,
                user_timezone="UTC",
                **_ids(),
            )

        await run()
        assert captured, "runtime stub must be constructed"
        invocation = captured[0].invocations[0]
        rebuilt = invocation["files"]
        assert rebuilt is not None and len(rebuilt) == 1
        assert rebuilt[0].filename == "diagram.png"
        assert rebuilt[0].media_type == "image/png"
        assert invocation["user_timezone"] == "UTC"


class TestDeleteRunStream:
    async def test_delete_calls_stream_delete(self, monkeypatch) -> None:
        captured: list[tuple[str, str]] = []

        async def fake_stream_delete(stream_key: str, state_key: str) -> None:
            captured.append((stream_key, state_key))

        monkeypatch.setattr(agent_run_mod, "stream_delete", fake_stream_delete)

        run_id = generate_id()

        async def run() -> dict[str, Any]:
            return await agent_run_mod.delete_run_stream(
                ctx={},
                run_id=str(run_id),
            )

        result = await run()
        assert result == {"status": "success", "run_id": str(run_id)}
        assert captured == [(f"agent:run:{run_id}", f"agent:run:{run_id}:state")]

    async def test_delete_invalid_uuid_returns_error(self, monkeypatch) -> None:
        called: list[Any] = []

        async def fake_stream_delete(*_args: Any) -> None:
            called.append(_args)

        monkeypatch.setattr(agent_run_mod, "stream_delete", fake_stream_delete)

        async def run() -> dict[str, Any]:
            return await agent_run_mod.delete_run_stream(ctx={}, run_id="bad")

        result = await run()
        assert result == {"status": "error", "error": "invalid_uuid"}
        assert called == []
