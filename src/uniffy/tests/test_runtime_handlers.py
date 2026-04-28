"""``RuntimeHandlers`` coordinator behaviour tests.

Pins the new shape introduced in W4: the handler runs synchronous
preflight + enqueue, then drives a stream subscriber while the egress
worker owns the LLM turn. The collaborators are stubbed (no DB / no
Valkey) so the suite asserts the contract, not the integration.
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any
from unittest.mock import MagicMock
from uuid import UUID

import pytest
from connectrpc.code import Code
from connectrpc.errors import ConnectError
from uniffy_proto.agents.v1.runtime_pb2 import SendMessageRequest, SubscribeToRunRequest

from uniffy.core.errors import (
    NotFoundError,
    PermissionDeniedError,
    RateLimitExceededError,
)
from uniffy.core.models.agents.message import AgentMessage
from uniffy.core.types import generate_id as uuid7
from uniffy.domains.agents.runtime import handlers as handlers_mod
from uniffy.domains.agents.runtime.handlers import RuntimeHandlers
from uniffy.domains.agents.runtime.operations import FileContext
from uniffy.domains.agents.runtime.stream_events import (
    RuntimeDoneEvent,
    RuntimeErrorEvent,
    RuntimeMessageStoredEvent,
    RuntimeStreamEvent,
    RuntimeTokenEvent,
)


class _FakeQueue:
    def __init__(self) -> None:
        self.enqueued: list[tuple[str, tuple[Any, ...], dict[str, Any]]] = []

    async def enqueue_job(self, name: str, *args: Any, **kwargs: Any) -> None:
        self.enqueued.append((name, args, kwargs))


class _FakeOrgOps:
    def __init__(self, _session: Any) -> None:
        self.calls: list[tuple[UUID, UUID]] = []

    async def require_org_member(self, user_id: UUID, organization_id: UUID) -> Any:
        self.calls.append((user_id, organization_id))
        return MagicMock(role="MEMBER")


class _FakeSessionOps:
    def __init__(self, _session: Any) -> None:
        self.calls: list[dict[str, UUID]] = []

    async def get_session(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        session_id: UUID,
    ) -> Any:
        self.calls.append(
            {
                "user_id": user_id,
                "organization_id": organization_id,
                "session_id": session_id,
            }
        )
        return MagicMock(id=session_id, user_id=user_id)


class _FailingOrgOps:
    def __init__(self, _session: Any) -> None: ...

    async def require_org_member(self, _user_id: UUID, _org_id: UUID) -> None:
        raise PermissionDeniedError("access", "organization")


class _FailingSessionOps:
    def __init__(self, _session: Any) -> None: ...

    async def get_session(self, **_kwargs: Any) -> None:
        raise NotFoundError("AgentSession", "missing")


def _install_open_session(monkeypatch) -> None:
    @asynccontextmanager
    async def fake_open_session():
        yield object()

    monkeypatch.setattr(handlers_mod, "open_session", fake_open_session)


def _install_user_id(monkeypatch, user_id: UUID) -> None:
    monkeypatch.setattr(
        handlers_mod,
        "get_user_id_from_context",
        lambda _ctx: user_id,
    )


def _install_org_ops(monkeypatch, factory=_FakeOrgOps) -> list[Any]:
    instances: list[Any] = []

    def make(session: Any) -> Any:
        ops = factory(session)
        instances.append(ops)
        return ops

    monkeypatch.setattr(handlers_mod, "OrganizationOperations", make)
    return instances


def _install_session_ops(monkeypatch, factory=_FakeSessionOps) -> list[Any]:
    instances: list[Any] = []

    def make(session: Any) -> Any:
        ops = factory(session)
        instances.append(ops)
        return ops

    monkeypatch.setattr(handlers_mod, "SessionOperations", make)
    return instances


def _install_rate_limiter(monkeypatch, raises: BaseException | None = None) -> list[dict[str, str]]:
    calls: list[dict[str, str]] = []

    async def fake(user_id: str, organization_id: str) -> None:
        calls.append({"user_id": user_id, "organization_id": organization_id})
        if raises is not None:
            raise raises

    monkeypatch.setattr(handlers_mod, "check_agent_rate_limits", fake)
    return calls


def _install_load_files(monkeypatch, files: list[FileContext] | None = None) -> list[dict[str, Any]]:
    calls: list[dict[str, Any]] = []

    async def fake(session, user_id, organization_id, file_ids):
        calls.append(
            {
                "user_id": user_id,
                "organization_id": organization_id,
                "file_ids": list(file_ids),
            }
        )
        return files or []

    monkeypatch.setattr(handlers_mod, "_load_files", fake)
    return calls


def _install_state(monkeypatch) -> list[dict[str, Any]]:
    states: list[dict[str, Any]] = []

    async def fake_set_run_state(**kwargs: Any) -> None:
        states.append(kwargs)

    monkeypatch.setattr(handlers_mod, "set_run_state", fake_set_run_state)
    return states


def _install_queue(monkeypatch) -> _FakeQueue:
    queue = _FakeQueue()
    monkeypatch.setattr(handlers_mod, "get_queue", lambda name: queue)
    return queue


def _install_subscribe(
    monkeypatch,
    events: list[RuntimeStreamEvent],
) -> list[UUID]:
    captured: list[UUID] = []

    async def fake_subscribe(run_id: UUID):
        captured.append(run_id)
        for event in events:
            yield event

    monkeypatch.setattr(handlers_mod, "_subscribe_runtime_events", fake_subscribe)
    return captured


def _install_fixed_run_id(monkeypatch, run_id: UUID) -> None:
    monkeypatch.setattr(handlers_mod, "generate_id", lambda: run_id)


def _make_user_message(session_id: UUID) -> AgentMessage:
    return AgentMessage(
        id=uuid7(),
        session_id=session_id,
        role="user",
        content="hi",
        created_at=datetime.now(UTC),
    )


def _make_assistant_message(session_id: UUID) -> AgentMessage:
    return AgentMessage(
        id=uuid7(),
        session_id=session_id,
        role="assistant",
        content="hello",
        created_at=datetime.now(UTC),
    )


def _build_request(
    *,
    organization_id: UUID,
    session_id: UUID,
    content: str = "hi there",
    file_ids: list[str] | None = None,
    user_timezone: str | None = None,
) -> SendMessageRequest:
    request = SendMessageRequest()
    request.organization_id = str(organization_id)
    request.session_id = str(session_id)
    request.content = content
    if file_ids:
        request.file_ids.extend(file_ids)
    if user_timezone:
        request.user_timezone = user_timezone
    return request


class TestStreamSendMessage:
    def test_invalid_uuid_short_circuits(self, monkeypatch) -> None:
        _install_user_id(monkeypatch, uuid7())
        queue = _install_queue(monkeypatch)
        _install_open_session(monkeypatch)

        request = SendMessageRequest()
        request.organization_id = "not-a-uuid"
        request.session_id = "also-bad"
        request.content = "hi"

        async def run() -> list[Any]:
            collected: list[Any] = []
            handlers = RuntimeHandlers()
            with pytest.raises(ConnectError) as exc_info:
                async for ev in handlers.stream_send_message(request, ctx=MagicMock()):
                    collected.append(ev)
            assert exc_info.value.code == Code.INVALID_ARGUMENT
            return collected

        asyncio.run(run())
        assert queue.enqueued == []

    def test_empty_content_short_circuits(self, monkeypatch) -> None:
        _install_user_id(monkeypatch, uuid7())
        queue = _install_queue(monkeypatch)

        request = _build_request(
            organization_id=uuid7(),
            session_id=uuid7(),
            content="   ",
        )

        async def run() -> None:
            handlers = RuntimeHandlers()
            with pytest.raises(ConnectError) as exc_info:
                async for _ in handlers.stream_send_message(request, ctx=MagicMock()):
                    pass
            assert exc_info.value.code == Code.INVALID_ARGUMENT

        asyncio.run(run())
        assert queue.enqueued == []

    def test_org_membership_failure_short_circuits_before_enqueue(
        self, monkeypatch
    ) -> None:
        _install_user_id(monkeypatch, uuid7())
        _install_open_session(monkeypatch)
        _install_org_ops(monkeypatch, factory=_FailingOrgOps)
        _install_session_ops(monkeypatch)
        _install_rate_limiter(monkeypatch)
        _install_load_files(monkeypatch)
        _install_state(monkeypatch)
        queue = _install_queue(monkeypatch)
        _install_subscribe(monkeypatch, [])

        request = _build_request(organization_id=uuid7(), session_id=uuid7())

        async def run() -> None:
            handlers = RuntimeHandlers()
            with pytest.raises(ConnectError) as exc_info:
                async for _ in handlers.stream_send_message(request, ctx=MagicMock()):
                    pass
            assert exc_info.value.code == Code.PERMISSION_DENIED

        asyncio.run(run())
        assert queue.enqueued == [], "no enqueue when org membership rejects"

    def test_session_ownership_failure_short_circuits_before_enqueue(
        self, monkeypatch
    ) -> None:
        _install_user_id(monkeypatch, uuid7())
        _install_open_session(monkeypatch)
        _install_org_ops(monkeypatch)
        _install_session_ops(monkeypatch, factory=_FailingSessionOps)
        _install_rate_limiter(monkeypatch)
        _install_load_files(monkeypatch)
        _install_state(monkeypatch)
        queue = _install_queue(monkeypatch)
        _install_subscribe(monkeypatch, [])

        request = _build_request(organization_id=uuid7(), session_id=uuid7())

        async def run() -> None:
            handlers = RuntimeHandlers()
            with pytest.raises(ConnectError) as exc_info:
                async for _ in handlers.stream_send_message(request, ctx=MagicMock()):
                    pass
            assert exc_info.value.code == Code.NOT_FOUND

        asyncio.run(run())
        assert queue.enqueued == [], "no enqueue when session lookup fails"

    def test_rate_limit_failure_short_circuits_before_enqueue(
        self, monkeypatch
    ) -> None:
        _install_user_id(monkeypatch, uuid7())
        _install_open_session(monkeypatch)
        _install_org_ops(monkeypatch)
        _install_session_ops(monkeypatch)
        _install_rate_limiter(
            monkeypatch,
            raises=RateLimitExceededError("agent messages (per user)", 60, 60),
        )
        _install_load_files(monkeypatch)
        _install_state(monkeypatch)
        queue = _install_queue(monkeypatch)
        _install_subscribe(monkeypatch, [])

        request = _build_request(organization_id=uuid7(), session_id=uuid7())

        async def run() -> None:
            handlers = RuntimeHandlers()
            with pytest.raises(ConnectError) as exc_info:
                async for _ in handlers.stream_send_message(request, ctx=MagicMock()):
                    pass
            assert exc_info.value.code == Code.RESOURCE_EXHAUSTED

        asyncio.run(run())
        assert queue.enqueued == [], "no enqueue when rate limit trips"

    def test_happy_path_enqueues_and_yields_events_in_order(
        self, monkeypatch
    ) -> None:
        user_id = uuid7()
        org_id = uuid7()
        session_id = uuid7()
        run_id = uuid7()
        _install_user_id(monkeypatch, user_id)
        _install_open_session(monkeypatch)
        _install_org_ops(monkeypatch)
        _install_session_ops(monkeypatch)
        _install_rate_limiter(monkeypatch)
        _install_load_files(
            monkeypatch,
            files=[
                FileContext(
                    file_id=str(uuid7()),
                    media_type="image/png",
                    filename="a.png",
                    storage_key="org/a.png",
                    extracted_text=None,
                    extraction_status="COMPLETED",
                ),
            ],
        )
        states = _install_state(monkeypatch)
        queue = _install_queue(monkeypatch)
        _install_fixed_run_id(monkeypatch, run_id)

        events: list[RuntimeStreamEvent] = [
            RuntimeMessageStoredEvent(message=_make_user_message(session_id)),
            RuntimeTokenEvent(text="he", sequence=1),
            RuntimeTokenEvent(text="llo", sequence=2),
            RuntimeDoneEvent(
                assistant_message=_make_assistant_message(session_id),
                model_used="claude-sonnet-4-6",
            ),
        ]
        captured = _install_subscribe(monkeypatch, events)

        request = _build_request(
            organization_id=org_id,
            session_id=session_id,
            file_ids=[str(uuid7())],
            user_timezone="UTC",
        )

        async def run() -> list[Any]:
            handlers = RuntimeHandlers()
            collected: list[Any] = []
            async for ev in handlers.stream_send_message(request, ctx=MagicMock()):
                collected.append(ev)
            return collected

        collected = asyncio.run(run())

        assert len(queue.enqueued) == 1
        name, args, kwargs = queue.enqueued[0]
        assert name == "run_agent_session"
        assert args[0] == str(run_id)
        assert args[1] == str(user_id)
        assert args[2] == str(org_id)
        assert args[3] == str(session_id)
        assert args[4] == request.content.strip()
        files_payload = args[5]
        assert files_payload is not None and len(files_payload) == 1
        assert files_payload[0]["filename"] == "a.png"
        assert args[6] == "UTC"

        assert states, "set_run_state must run before enqueue"
        assert states[0]["run_id"] == run_id
        assert states[0]["status"] == "queued"

        assert captured == [run_id]

        # First event is the run_id header (no oneof set).
        assert collected[0].run_id == str(run_id)
        assert collected[0].WhichOneof("event") is None

        cases = [ev.WhichOneof("event") for ev in collected[1:]]
        assert cases == [
            "message_stored",
            "token",
            "token",
            "done",
        ]

        for ev in collected:
            assert ev.run_id == str(run_id)

    def test_subscribe_timeout_yields_synthetic_error(self, monkeypatch) -> None:
        user_id = uuid7()
        org_id = uuid7()
        session_id = uuid7()
        run_id = uuid7()
        _install_user_id(monkeypatch, user_id)
        _install_open_session(monkeypatch)
        _install_org_ops(monkeypatch)
        _install_session_ops(monkeypatch)
        _install_rate_limiter(monkeypatch)
        _install_load_files(monkeypatch)
        _install_state(monkeypatch)
        _install_queue(monkeypatch)
        _install_fixed_run_id(monkeypatch, run_id)

        events: list[RuntimeStreamEvent] = [
            RuntimeErrorEvent(error=handlers_mod.SUBSCRIBE_TIMEOUT_MESSAGE),
        ]
        _install_subscribe(monkeypatch, events)

        request = _build_request(organization_id=org_id, session_id=session_id)

        async def run() -> list[Any]:
            handlers = RuntimeHandlers()
            collected: list[Any] = []
            async for ev in handlers.stream_send_message(request, ctx=MagicMock()):
                collected.append(ev)
            return collected

        collected = asyncio.run(run())
        # run_id header + synthetic error proto envelope
        assert len(collected) == 2
        assert collected[0].run_id == str(run_id)
        assert collected[1].WhichOneof("event") == "error"
        assert collected[1].error.message == handlers_mod.SUBSCRIBE_TIMEOUT_MESSAGE
        assert collected[1].run_id == str(run_id)


class TestSendMessageUnary:
    def test_invalid_uuid_short_circuits(self, monkeypatch) -> None:
        _install_user_id(monkeypatch, uuid7())
        queue = _install_queue(monkeypatch)

        request = SendMessageRequest()
        request.organization_id = "bad"
        request.session_id = "bad"
        request.content = "hi"

        async def run() -> Any:
            handlers = RuntimeHandlers()
            return await handlers.send_message(request, ctx=MagicMock())

        with pytest.raises(ConnectError) as exc_info:
            asyncio.run(run())
        assert exc_info.value.code == Code.INVALID_ARGUMENT
        assert queue.enqueued == []

    def test_drains_stream_and_returns_final_tuple(self, monkeypatch) -> None:
        user_id = uuid7()
        org_id = uuid7()
        session_id = uuid7()
        run_id = uuid7()
        _install_user_id(monkeypatch, user_id)
        _install_open_session(monkeypatch)
        _install_org_ops(monkeypatch)
        _install_session_ops(monkeypatch)
        _install_rate_limiter(monkeypatch)
        _install_load_files(monkeypatch)
        _install_state(monkeypatch)
        _install_queue(monkeypatch)
        _install_fixed_run_id(monkeypatch, run_id)

        user_msg = _make_user_message(session_id)
        assistant_msg = _make_assistant_message(session_id)
        events: list[RuntimeStreamEvent] = [
            RuntimeMessageStoredEvent(message=user_msg),
            RuntimeTokenEvent(text="ok", sequence=1),
            RuntimeDoneEvent(
                assistant_message=assistant_msg,
                model_used="claude-sonnet-4-6",
            ),
        ]
        _install_subscribe(monkeypatch, events)

        request = _build_request(organization_id=org_id, session_id=session_id)

        async def run() -> Any:
            handlers = RuntimeHandlers()
            return await handlers.send_message(request, ctx=MagicMock())

        response = asyncio.run(run())
        assert response.user_message.id == str(user_msg.id)
        assert response.assistant_message.id == str(assistant_msg.id)
        assert response.model_used == "claude-sonnet-4-6"

    def test_runtime_error_event_surfaces_as_connect_error(self, monkeypatch) -> None:
        user_id = uuid7()
        org_id = uuid7()
        session_id = uuid7()
        run_id = uuid7()
        _install_user_id(monkeypatch, user_id)
        _install_open_session(monkeypatch)
        _install_org_ops(monkeypatch)
        _install_session_ops(monkeypatch)
        _install_rate_limiter(monkeypatch)
        _install_load_files(monkeypatch)
        _install_state(monkeypatch)
        _install_queue(monkeypatch)
        _install_fixed_run_id(monkeypatch, run_id)

        _install_subscribe(
            monkeypatch,
            [RuntimeErrorEvent(error="provider blew up")],
        )

        request = _build_request(organization_id=org_id, session_id=session_id)

        async def run() -> Any:
            handlers = RuntimeHandlers()
            return await handlers.send_message(request, ctx=MagicMock())

        with pytest.raises(ConnectError) as exc_info:
            asyncio.run(run())
        assert exc_info.value.code == Code.INTERNAL
        assert "provider blew up" in exc_info.value.message

    def test_subscribe_timeout_surfaces_as_deadline_exceeded(
        self, monkeypatch
    ) -> None:
        user_id = uuid7()
        org_id = uuid7()
        session_id = uuid7()
        run_id = uuid7()
        _install_user_id(monkeypatch, user_id)
        _install_open_session(monkeypatch)
        _install_org_ops(monkeypatch)
        _install_session_ops(monkeypatch)
        _install_rate_limiter(monkeypatch)
        _install_load_files(monkeypatch)
        _install_state(monkeypatch)
        _install_queue(monkeypatch)
        _install_fixed_run_id(monkeypatch, run_id)

        _install_subscribe(
            monkeypatch,
            [RuntimeErrorEvent(error=handlers_mod.SUBSCRIBE_TIMEOUT_MESSAGE)],
        )

        request = _build_request(organization_id=org_id, session_id=session_id)

        async def run() -> Any:
            handlers = RuntimeHandlers()
            return await handlers.send_message(request, ctx=MagicMock())

        with pytest.raises(ConnectError) as exc_info:
            asyncio.run(run())
        assert exc_info.value.code == Code.DEADLINE_EXCEEDED
        assert exc_info.value.message == handlers_mod.SUBSCRIBE_TIMEOUT_MESSAGE


def _install_run_state(
    monkeypatch,
    state: dict[str, Any] | None,
) -> None:
    async def fake(_run_id: UUID) -> dict[str, Any] | None:
        return state

    monkeypatch.setattr(handlers_mod, "get_run_state", fake)


def _build_subscribe_request(
    *,
    run_id: UUID,
    organization_id: UUID,
) -> SubscribeToRunRequest:
    request = SubscribeToRunRequest()
    request.run_id = str(run_id)
    request.organization_id = str(organization_id)
    return request


class TestSubscribeToRun:
    def test_invalid_uuid_returns_invalid_argument(self, monkeypatch) -> None:
        _install_user_id(monkeypatch, uuid7())
        _install_run_state(monkeypatch, None)

        request = SubscribeToRunRequest()
        request.run_id = "not-a-uuid"
        request.organization_id = "not-a-uuid"

        async def drive() -> None:
            handlers = RuntimeHandlers()
            with pytest.raises(ConnectError) as exc_info:
                async for _ in handlers.subscribe_to_run(request, ctx=MagicMock()):
                    pass
            assert exc_info.value.code == Code.INVALID_ARGUMENT

        asyncio.run(drive())

    def test_state_missing_maps_to_not_found(self, monkeypatch) -> None:
        _install_user_id(monkeypatch, uuid7())
        _install_run_state(monkeypatch, None)
        _install_subscribe(monkeypatch, [])

        request = _build_subscribe_request(run_id=uuid7(), organization_id=uuid7())

        async def drive() -> None:
            handlers = RuntimeHandlers()
            with pytest.raises(ConnectError) as exc_info:
                async for _ in handlers.subscribe_to_run(request, ctx=MagicMock()):
                    pass
            assert exc_info.value.code == Code.NOT_FOUND

        asyncio.run(drive())

    def test_user_mismatch_maps_to_permission_denied(self, monkeypatch) -> None:
        caller = uuid7()
        owner = uuid7()
        org_id = uuid7()
        run_id = uuid7()
        _install_user_id(monkeypatch, caller)
        _install_run_state(
            monkeypatch,
            {
                "run_id": str(run_id),
                "user_id": str(owner),
                "organization_id": str(org_id),
                "session_id": str(uuid7()),
                "status": "running",
                "last_seq": 1,
            },
        )
        _install_subscribe(monkeypatch, [])

        request = _build_subscribe_request(run_id=run_id, organization_id=org_id)

        async def drive() -> None:
            handlers = RuntimeHandlers()
            with pytest.raises(ConnectError) as exc_info:
                async for _ in handlers.subscribe_to_run(request, ctx=MagicMock()):
                    pass
            assert exc_info.value.code == Code.PERMISSION_DENIED

        asyncio.run(drive())

    def test_org_mismatch_maps_to_permission_denied(self, monkeypatch) -> None:
        user_id = uuid7()
        run_id = uuid7()
        request_org = uuid7()
        state_org = uuid7()
        _install_user_id(monkeypatch, user_id)
        _install_run_state(
            monkeypatch,
            {
                "run_id": str(run_id),
                "user_id": str(user_id),
                "organization_id": str(state_org),
                "session_id": str(uuid7()),
                "status": "running",
                "last_seq": 1,
            },
        )
        _install_subscribe(monkeypatch, [])

        request = _build_subscribe_request(run_id=run_id, organization_id=request_org)

        async def drive() -> None:
            handlers = RuntimeHandlers()
            with pytest.raises(ConnectError) as exc_info:
                async for _ in handlers.subscribe_to_run(request, ctx=MagicMock()):
                    pass
            assert exc_info.value.code == Code.PERMISSION_DENIED

        asyncio.run(drive())

    def test_happy_path_replays_events_with_run_id_header(self, monkeypatch) -> None:
        user_id = uuid7()
        org_id = uuid7()
        session_id = uuid7()
        run_id = uuid7()
        _install_user_id(monkeypatch, user_id)
        _install_run_state(
            monkeypatch,
            {
                "run_id": str(run_id),
                "user_id": str(user_id),
                "organization_id": str(org_id),
                "session_id": str(session_id),
                "status": "running",
                "last_seq": 2,
            },
        )

        events: list[RuntimeStreamEvent] = [
            RuntimeTokenEvent(text="he", sequence=1),
            RuntimeDoneEvent(
                assistant_message=_make_assistant_message(session_id),
                model_used="claude-sonnet-4-6",
            ),
        ]
        captured = _install_subscribe(monkeypatch, events)

        request = _build_subscribe_request(run_id=run_id, organization_id=org_id)

        async def drive() -> list[Any]:
            handlers = RuntimeHandlers()
            collected: list[Any] = []
            async for ev in handlers.subscribe_to_run(request, ctx=MagicMock()):
                collected.append(ev)
            return collected

        collected = asyncio.run(drive())

        assert captured == [run_id]
        # First event is the run_id header (no oneof set).
        assert collected[0].run_id == str(run_id)
        assert collected[0].WhichOneof("event") is None

        cases = [ev.WhichOneof("event") for ev in collected[1:]]
        assert cases == ["token", "done"]
        for ev in collected:
            assert ev.run_id == str(run_id)


class TestSubscribeRuntimeEvents:
    def test_yields_synthetic_error_when_wall_budget_elapsed(
        self, monkeypatch
    ) -> None:
        async def empty_xread(*_args: Any, **_kwargs: Any) -> list[Any]:
            return []

        monkeypatch.setattr(handlers_mod, "stream_xread", empty_xread)
        monkeypatch.setattr(
            handlers_mod,
            "SUBSCRIBE_WALL_BUDGET_SECONDS",
            0.05,
            raising=False,
        )

        async def drive() -> list[RuntimeStreamEvent]:
            collected: list[RuntimeStreamEvent] = []
            async for ev in handlers_mod._subscribe_runtime_events(uuid7()):
                collected.append(ev)
            return collected

        collected = asyncio.run(drive())
        assert len(collected) == 1
        assert isinstance(collected[0], RuntimeErrorEvent)
        assert collected[0].error == handlers_mod.SUBSCRIBE_TIMEOUT_MESSAGE

    def test_decodes_and_yields_events_in_order(self, monkeypatch) -> None:
        from uniffy.domains.agents.runtime.converters import (
            runtime_stream_event_to_json,
        )

        run_id = uuid7()
        session_id = uuid7()
        events: list[RuntimeStreamEvent] = [
            RuntimeTokenEvent(text="hello", sequence=1),
            RuntimeDoneEvent(
                assistant_message=_make_assistant_message(session_id),
                model_used="claude-sonnet-4-6",
            ),
        ]
        rounds = [
            [
                ("1-0", {"event": runtime_stream_event_to_json(events[0])}),
                ("1-1", {"event": runtime_stream_event_to_json(events[1])}),
            ],
        ]

        async def fake_xread(*_args: Any, **_kwargs: Any) -> list[Any]:
            if rounds:
                return rounds.pop(0)
            return []

        monkeypatch.setattr(handlers_mod, "stream_xread", fake_xread)

        async def drive() -> list[RuntimeStreamEvent]:
            collected: list[RuntimeStreamEvent] = []
            async for ev in handlers_mod._subscribe_runtime_events(run_id):
                collected.append(ev)
            return collected

        collected = asyncio.run(drive())
        types = [type(ev).__name__ for ev in collected]
        assert types == ["RuntimeTokenEvent", "RuntimeDoneEvent"]
