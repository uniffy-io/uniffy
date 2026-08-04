"""``RuntimeHandlers`` coordinator behaviour tests.

Pins the new shape introduced in W4: the handler runs synchronous
preflight + enqueue, then drives a stream subscriber while the egress
worker owns the LLM turn. The collaborators are stubbed (no DB / no
Valkey) so the suite asserts the contract, not the integration.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any
from unittest.mock import MagicMock
from uuid import UUID

import pytest
from connectrpc.code import Code
from connectrpc.errors import ConnectError
from uniffy_proto.agents.v1.runtime_pb2 import (
    RespondToConfirmationRequest,
    SendMessageRequest,
    StreamSendMessageRequest,
    SubscribeToRunRequest,
)

from uniffy.core.errors import (
    NotFoundError,
    PermissionDeniedError,
    RateLimitExceededError,
)
from uniffy.core.models.agents.message import AgentMessage
from uniffy.core.types import generate_id
from uniffy.domains.agents.providers.base import EventType, StreamEvent
from uniffy.domains.agents.runtime import handlers as handlers_mod
from uniffy.domains.agents.runtime.file_loader import FileContext
from uniffy.domains.agents.runtime.handlers import RuntimeHandlers


@pytest.fixture(autouse=True)
def _runtime_settings(monkeypatch):
    @asynccontextmanager
    async def open_session():
        yield object()

    async def resolve(_session, _organization_id):
        return MagicMock(send_deadline_seconds=300, resume_enabled=True)

    monkeypatch.setattr(handlers_mod, "open_session", open_session)
    monkeypatch.setattr(handlers_mod, "get_runtime_settings", resolve)


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
        self.calls.append({
            "user_id": user_id,
            "organization_id": organization_id,
            "session_id": session_id,
        })
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


def _install_rate_limiter(monkeypatch, raises: BaseException | None = None) -> list[dict[str, Any]]:
    calls: list[dict[str, Any]] = []

    async def fake(session, *, user_id, organization_id, agent_id) -> None:
        calls.append({
            "user_id": str(user_id),
            "organization_id": str(organization_id),
            "agent_id": str(agent_id),
        })
        if raises is not None:
            raise raises

    monkeypatch.setattr(handlers_mod, "check_agent_message_limits", fake)
    return calls


def _install_budget_preflight(
    monkeypatch,
    raises: BaseException | None = None,
) -> list[dict[str, Any]]:
    calls: list[dict[str, Any]] = []

    class _Stub:
        def __init__(self, _session):
            pass

        async def check_preflight(self, *, user_id, organization_id):
            calls.append({"user_id": str(user_id), "organization_id": str(organization_id)})
            if raises is not None:
                raise raises

    monkeypatch.setattr(handlers_mod, "BudgetsOperations", _Stub)
    return calls


def _install_load_files(monkeypatch, files: list[FileContext] | None = None) -> list[dict[str, Any]]:
    calls: list[dict[str, Any]] = []

    async def fake(session, user_id, organization_id, file_ids):
        calls.append({
            "user_id": user_id,
            "organization_id": organization_id,
            "file_ids": list(file_ids),
        })
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
    events: list[StreamEvent],
) -> list[UUID]:
    captured: list[UUID] = []

    async def fake_subscribe(run_id: UUID, _wall_budget_seconds: float = 0):
        captured.append(run_id)
        for event in events:
            yield event

    monkeypatch.setattr(handlers_mod, "_subscribe_runtime_events", fake_subscribe)
    return captured


def _install_fixed_run_id(monkeypatch, run_id: UUID) -> None:
    monkeypatch.setattr(handlers_mod, "generate_id", lambda: run_id)


def _make_user_message(session_id: UUID) -> AgentMessage:
    return AgentMessage(
        id=generate_id(),
        session_id=session_id,
        role="user",
        content="hi",
        created_at=datetime.now(UTC),
    )


def _make_assistant_message(session_id: UUID) -> AgentMessage:
    return AgentMessage(
        id=generate_id(),
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
) -> StreamSendMessageRequest:
    request = StreamSendMessageRequest()
    request.organization_id = str(organization_id)
    request.session_id = str(session_id)
    request.content = content
    if file_ids:
        request.file_ids.extend(file_ids)
    if user_timezone:
        request.user_timezone = user_timezone
    return request


def _build_unary_request(
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
    async def test_invalid_uuid_short_circuits(self, monkeypatch) -> None:
        _install_user_id(monkeypatch, generate_id())
        queue = _install_queue(monkeypatch)
        _install_open_session(monkeypatch)

        request = StreamSendMessageRequest()
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

        await run()
        assert queue.enqueued == []

    async def test_empty_content_short_circuits(self, monkeypatch) -> None:
        _install_user_id(monkeypatch, generate_id())
        queue = _install_queue(monkeypatch)

        request = _build_request(
            organization_id=generate_id(),
            session_id=generate_id(),
            content="   ",
        )

        async def run() -> None:
            handlers = RuntimeHandlers()
            with pytest.raises(ConnectError) as exc_info:
                async for _ in handlers.stream_send_message(request, ctx=MagicMock()):
                    pass
            assert exc_info.value.code == Code.INVALID_ARGUMENT

        await run()
        assert queue.enqueued == []

    async def test_org_membership_failure_short_circuits_before_enqueue(self, monkeypatch) -> None:
        _install_user_id(monkeypatch, generate_id())
        _install_open_session(monkeypatch)
        _install_org_ops(monkeypatch, factory=_FailingOrgOps)
        _install_session_ops(monkeypatch)
        _install_rate_limiter(monkeypatch)
        _install_budget_preflight(monkeypatch)
        _install_load_files(monkeypatch)
        _install_state(monkeypatch)
        queue = _install_queue(monkeypatch)
        _install_subscribe(monkeypatch, [])

        request = _build_request(organization_id=generate_id(), session_id=generate_id())

        async def run() -> None:
            handlers = RuntimeHandlers()
            with pytest.raises(ConnectError) as exc_info:
                async for _ in handlers.stream_send_message(request, ctx=MagicMock()):
                    pass
            assert exc_info.value.code == Code.PERMISSION_DENIED

        await run()
        assert queue.enqueued == [], "no enqueue when org membership rejects"

    async def test_session_ownership_failure_short_circuits_before_enqueue(
        self, monkeypatch
    ) -> None:
        _install_user_id(monkeypatch, generate_id())
        _install_open_session(monkeypatch)
        _install_org_ops(monkeypatch)
        _install_session_ops(monkeypatch, factory=_FailingSessionOps)
        _install_rate_limiter(monkeypatch)
        _install_budget_preflight(monkeypatch)
        _install_load_files(monkeypatch)
        _install_state(monkeypatch)
        queue = _install_queue(monkeypatch)
        _install_subscribe(monkeypatch, [])

        request = _build_request(organization_id=generate_id(), session_id=generate_id())

        async def run() -> None:
            handlers = RuntimeHandlers()
            with pytest.raises(ConnectError) as exc_info:
                async for _ in handlers.stream_send_message(request, ctx=MagicMock()):
                    pass
            assert exc_info.value.code == Code.NOT_FOUND

        await run()
        assert queue.enqueued == [], "no enqueue when session lookup fails"

    async def test_rate_limit_failure_short_circuits_before_enqueue(self, monkeypatch) -> None:
        _install_user_id(monkeypatch, generate_id())
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

        request = _build_request(organization_id=generate_id(), session_id=generate_id())

        async def run() -> None:
            handlers = RuntimeHandlers()
            with pytest.raises(ConnectError) as exc_info:
                async for _ in handlers.stream_send_message(request, ctx=MagicMock()):
                    pass
            assert exc_info.value.code == Code.RESOURCE_EXHAUSTED

        await run()
        assert queue.enqueued == [], "no enqueue when rate limit trips"

    async def test_happy_path_enqueues_and_yields_events_in_order(self, monkeypatch) -> None:
        user_id = generate_id()
        org_id = generate_id()
        session_id = generate_id()
        run_id = generate_id()
        _install_user_id(monkeypatch, user_id)
        _install_open_session(monkeypatch)
        _install_org_ops(monkeypatch)
        _install_session_ops(monkeypatch)
        _install_rate_limiter(monkeypatch)
        _install_budget_preflight(monkeypatch)
        _install_load_files(
            monkeypatch,
            files=[
                FileContext(
                    file_id=str(generate_id()),
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

        events: list[StreamEvent] = [
            StreamEvent(type=EventType.MESSAGE_STORED, message=_make_user_message(session_id)),
            StreamEvent(type=EventType.TEXT_BLOCK_DELTA, delta="he", sequence=1),
            StreamEvent(type=EventType.TEXT_BLOCK_DELTA, delta="llo", sequence=2),
            StreamEvent(
                type=EventType.DONE,
                assistant_message=_make_assistant_message(session_id),
                model="claude-sonnet-4-6",
            ),
        ]
        captured = _install_subscribe(monkeypatch, events)

        request = _build_request(
            organization_id=org_id,
            session_id=session_id,
            file_ids=[str(generate_id())],
            user_timezone="UTC",
        )

        async def run() -> list[Any]:
            handlers = RuntimeHandlers()
            collected: list[Any] = []
            async for ev in handlers.stream_send_message(request, ctx=MagicMock()):
                collected.append(ev)
            return collected

        collected = await run()

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
        assert collected[0].event.run_id == str(run_id)
        assert collected[0].event.WhichOneof("event") is None

        cases = [ev.event.WhichOneof("event") for ev in collected[1:]]
        assert cases == [
            "message_stored",
            "text_block_delta",
            "text_block_delta",
            "done",
        ]

        for ev in collected:
            assert ev.event.run_id == str(run_id)

    async def test_subscribe_timeout_yields_synthetic_error(self, monkeypatch) -> None:
        user_id = generate_id()
        org_id = generate_id()
        session_id = generate_id()
        run_id = generate_id()
        _install_user_id(monkeypatch, user_id)
        _install_open_session(monkeypatch)
        _install_org_ops(monkeypatch)
        _install_session_ops(monkeypatch)
        _install_rate_limiter(monkeypatch)
        _install_budget_preflight(monkeypatch)
        _install_load_files(monkeypatch)
        _install_state(monkeypatch)
        _install_queue(monkeypatch)
        _install_fixed_run_id(monkeypatch, run_id)

        events: list[StreamEvent] = [
            StreamEvent(type=EventType.ERROR, error=handlers_mod.SUBSCRIBE_TIMEOUT_MESSAGE),
        ]
        _install_subscribe(monkeypatch, events)

        request = _build_request(organization_id=org_id, session_id=session_id)

        async def run() -> list[Any]:
            handlers = RuntimeHandlers()
            collected: list[Any] = []
            async for ev in handlers.stream_send_message(request, ctx=MagicMock()):
                collected.append(ev)
            return collected

        collected = await run()
        # run_id header + synthetic error proto envelope
        assert len(collected) == 2
        assert collected[0].event.run_id == str(run_id)
        assert collected[1].event.WhichOneof("event") == "error"
        assert collected[1].event.error.message == handlers_mod.SUBSCRIBE_TIMEOUT_MESSAGE
        assert collected[1].event.run_id == str(run_id)


class TestSendMessageUnary:
    async def test_invalid_uuid_short_circuits(self, monkeypatch) -> None:
        _install_user_id(monkeypatch, generate_id())
        queue = _install_queue(monkeypatch)

        request = SendMessageRequest()
        request.organization_id = "bad"
        request.session_id = "bad"
        request.content = "hi"

        async def run() -> Any:
            handlers = RuntimeHandlers()
            return await handlers.send_message(request, ctx=MagicMock())

        with pytest.raises(ConnectError) as exc_info:
            await run()
        assert exc_info.value.code == Code.INVALID_ARGUMENT
        assert queue.enqueued == []

    async def test_drains_stream_and_returns_final_tuple(self, monkeypatch) -> None:
        user_id = generate_id()
        org_id = generate_id()
        session_id = generate_id()
        run_id = generate_id()
        _install_user_id(monkeypatch, user_id)
        _install_open_session(monkeypatch)
        _install_org_ops(monkeypatch)
        _install_session_ops(monkeypatch)
        _install_rate_limiter(monkeypatch)
        _install_budget_preflight(monkeypatch)
        _install_load_files(monkeypatch)
        _install_state(monkeypatch)
        _install_queue(monkeypatch)
        _install_fixed_run_id(monkeypatch, run_id)

        user_msg = _make_user_message(session_id)
        assistant_msg = _make_assistant_message(session_id)
        events: list[StreamEvent] = [
            StreamEvent(type=EventType.MESSAGE_STORED, message=user_msg),
            StreamEvent(type=EventType.TEXT_BLOCK_DELTA, delta="ok", sequence=1),
            StreamEvent(
                type=EventType.DONE,
                assistant_message=assistant_msg,
                model="claude-sonnet-4-6",
            ),
        ]
        _install_subscribe(monkeypatch, events)

        request = _build_unary_request(organization_id=org_id, session_id=session_id)

        async def run() -> Any:
            handlers = RuntimeHandlers()
            return await handlers.send_message(request, ctx=MagicMock())

        response = await run()
        assert response.user_message.id == str(user_msg.id)
        assert response.assistant_message.id == str(assistant_msg.id)
        assert response.model_used == "claude-sonnet-4-6"

    async def test_runtime_error_event_surfaces_as_connect_error(self, monkeypatch) -> None:
        user_id = generate_id()
        org_id = generate_id()
        session_id = generate_id()
        run_id = generate_id()
        _install_user_id(monkeypatch, user_id)
        _install_open_session(monkeypatch)
        _install_org_ops(monkeypatch)
        _install_session_ops(monkeypatch)
        _install_rate_limiter(monkeypatch)
        _install_budget_preflight(monkeypatch)
        _install_load_files(monkeypatch)
        _install_state(monkeypatch)
        _install_queue(monkeypatch)
        _install_fixed_run_id(monkeypatch, run_id)

        _install_subscribe(
            monkeypatch,
            [StreamEvent(type=EventType.ERROR, error="provider blew up")],
        )

        request = _build_unary_request(organization_id=org_id, session_id=session_id)

        async def run() -> Any:
            handlers = RuntimeHandlers()
            return await handlers.send_message(request, ctx=MagicMock())

        with pytest.raises(ConnectError) as exc_info:
            await run()
        assert exc_info.value.code == Code.INTERNAL
        assert "provider blew up" in exc_info.value.message

    async def test_subscribe_timeout_surfaces_as_deadline_exceeded(self, monkeypatch) -> None:
        user_id = generate_id()
        org_id = generate_id()
        session_id = generate_id()
        run_id = generate_id()
        _install_user_id(monkeypatch, user_id)
        _install_open_session(monkeypatch)
        _install_org_ops(monkeypatch)
        _install_session_ops(monkeypatch)
        _install_rate_limiter(monkeypatch)
        _install_budget_preflight(monkeypatch)
        _install_load_files(monkeypatch)
        _install_state(monkeypatch)
        _install_queue(monkeypatch)
        _install_fixed_run_id(monkeypatch, run_id)

        _install_subscribe(
            monkeypatch,
            [StreamEvent(type=EventType.ERROR, error=handlers_mod.SUBSCRIBE_TIMEOUT_MESSAGE)],
        )

        request = _build_unary_request(organization_id=org_id, session_id=session_id)

        async def run() -> Any:
            handlers = RuntimeHandlers()
            return await handlers.send_message(request, ctx=MagicMock())

        with pytest.raises(ConnectError) as exc_info:
            await run()
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
    async def test_disabled_resume_is_rejected(self, monkeypatch) -> None:
        user_id = generate_id()
        org_id = generate_id()
        run_id = generate_id()
        _install_user_id(monkeypatch, user_id)
        _install_run_state(
            monkeypatch,
            {
                "run_id": str(run_id),
                "user_id": str(user_id),
                "organization_id": str(org_id),
                "session_id": str(generate_id()),
                "status": "running",
                "last_seq": 1,
            },
        )

        async def disabled(_session, _organization_id):
            return MagicMock(send_deadline_seconds=300, resume_enabled=False)

        monkeypatch.setattr(handlers_mod, "get_runtime_settings", disabled)
        request = _build_subscribe_request(run_id=run_id, organization_id=org_id)

        with pytest.raises(ConnectError) as exc_info:
            async for _ in RuntimeHandlers().subscribe_to_run(request, ctx=MagicMock()):
                pass

        assert exc_info.value.code == Code.FAILED_PRECONDITION

    async def test_invalid_uuid_returns_invalid_argument(self, monkeypatch) -> None:
        _install_user_id(monkeypatch, generate_id())
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

        await drive()

    async def test_state_missing_maps_to_not_found(self, monkeypatch) -> None:
        _install_user_id(monkeypatch, generate_id())
        _install_run_state(monkeypatch, None)
        _install_subscribe(monkeypatch, [])

        request = _build_subscribe_request(run_id=generate_id(), organization_id=generate_id())

        async def drive() -> None:
            handlers = RuntimeHandlers()
            with pytest.raises(ConnectError) as exc_info:
                async for _ in handlers.subscribe_to_run(request, ctx=MagicMock()):
                    pass
            assert exc_info.value.code == Code.NOT_FOUND

        await drive()

    async def test_user_mismatch_maps_to_permission_denied(self, monkeypatch) -> None:
        caller = generate_id()
        owner = generate_id()
        org_id = generate_id()
        run_id = generate_id()
        _install_user_id(monkeypatch, caller)
        _install_run_state(
            monkeypatch,
            {
                "run_id": str(run_id),
                "user_id": str(owner),
                "organization_id": str(org_id),
                "session_id": str(generate_id()),
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

        await drive()

    async def test_org_mismatch_maps_to_permission_denied(self, monkeypatch) -> None:
        user_id = generate_id()
        run_id = generate_id()
        request_org = generate_id()
        state_org = generate_id()
        _install_user_id(monkeypatch, user_id)
        _install_run_state(
            monkeypatch,
            {
                "run_id": str(run_id),
                "user_id": str(user_id),
                "organization_id": str(state_org),
                "session_id": str(generate_id()),
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

        await drive()

    async def test_happy_path_replays_events_with_run_id_header(self, monkeypatch) -> None:
        user_id = generate_id()
        org_id = generate_id()
        session_id = generate_id()
        run_id = generate_id()
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

        events: list[StreamEvent] = [
            StreamEvent(type=EventType.TEXT_BLOCK_DELTA, delta="he", sequence=1),
            StreamEvent(
                type=EventType.DONE,
                assistant_message=_make_assistant_message(session_id),
                model="claude-sonnet-4-6",
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

        collected = await drive()

        assert captured == [run_id]
        # First event is the run_id header (no oneof set).
        assert collected[0].event.run_id == str(run_id)
        assert collected[0].event.WhichOneof("event") is None

        cases = [ev.event.WhichOneof("event") for ev in collected[1:]]
        assert cases == ["text_block_delta", "done"]
        for ev in collected:
            assert ev.event.run_id == str(run_id)


class TestSubscribeRuntimeEvents:
    async def test_yields_synthetic_error_when_wall_budget_elapsed(self, monkeypatch) -> None:
        async def empty_xread(*_args: Any, **_kwargs: Any) -> list[Any]:
            return []

        monkeypatch.setattr(handlers_mod, "stream_xread", empty_xread)
        monkeypatch.setattr(
            handlers_mod,
            "SUBSCRIBE_WALL_BUDGET_SECONDS",
            0.05,
            raising=False,
        )

        async def drive() -> list[StreamEvent]:
            collected: list[StreamEvent] = []
            async for ev in handlers_mod._subscribe_runtime_events(generate_id()):
                collected.append(ev)
            return collected

        collected = await drive()
        assert len(collected) == 1
        assert collected[0].type is EventType.ERROR
        assert collected[0].error == handlers_mod.SUBSCRIBE_TIMEOUT_MESSAGE

    async def test_decodes_and_yields_events_in_order(self, monkeypatch) -> None:
        from uniffy.domains.agents.runtime.converters import (
            runtime_stream_event_to_json,
        )

        run_id = generate_id()
        session_id = generate_id()
        events: list[StreamEvent] = [
            StreamEvent(type=EventType.TEXT_BLOCK_DELTA, delta="hello", sequence=1),
            StreamEvent(
                type=EventType.DONE,
                assistant_message=_make_assistant_message(session_id),
                model="claude-sonnet-4-6",
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

        async def drive() -> list[StreamEvent]:
            collected: list[StreamEvent] = []
            async for ev in handlers_mod._subscribe_runtime_events(run_id):
                collected.append(ev)
            return collected

        collected = await drive()
        types = [ev.type for ev in collected]
        assert types == [EventType.TEXT_BLOCK_DELTA, EventType.DONE]


class _FakeApprovalStore:
    def __init__(self, state: dict[str, Any] | None) -> None:
        self._state = state
        self.respond_calls: list[dict[str, Any]] = []

    async def get_state(self, scope_id: UUID, request_id: str) -> dict[str, Any] | None:
        return self._state

    async def respond(
        self,
        scope_id: UUID,
        request_id: str,
        approved: bool,
        *,
        decided_by: UUID | None = None,
    ) -> bool:
        self.respond_calls.append({
            "scope_id": scope_id,
            "request_id": request_id,
            "approved": approved,
            "decided_by": decided_by,
        })
        return True


def _install_approval_store(monkeypatch, store: _FakeApprovalStore) -> None:
    monkeypatch.setattr(handlers_mod, "get_approval_store", lambda: store)


def _build_confirmation_request(
    *,
    organization_id: UUID,
    session_id: UUID,
    tool_call_id: str = "tc-123",
    approved: bool = True,
) -> RespondToConfirmationRequest:
    req = RespondToConfirmationRequest()
    req.organization_id = str(organization_id)
    req.session_id = str(session_id)
    req.tool_call_id = tool_call_id
    req.approved = approved
    return req


class TestRespondToConfirmation:
    async def test_actor_match_approves(self, monkeypatch) -> None:
        user_id = generate_id()
        org_id = generate_id()
        session_id = generate_id()
        _install_user_id(monkeypatch, user_id)
        _install_open_session(monkeypatch)
        _install_org_ops(monkeypatch)
        store = _FakeApprovalStore(state={"actor_user_id": str(user_id), "status": "pending"})
        _install_approval_store(monkeypatch, store)

        request = _build_confirmation_request(
            organization_id=org_id, session_id=session_id, approved=True
        )

        async def drive() -> Any:
            return await RuntimeHandlers().respond_to_confirmation(request, ctx=MagicMock())

        resp = await drive()
        assert resp.accepted is True
        assert store.respond_calls == [
            {
                "scope_id": session_id,
                "request_id": "tc-123",
                "approved": True,
                "decided_by": user_id,
            }
        ]

    async def test_foreign_caller_rejected(self, monkeypatch) -> None:
        caller = generate_id()
        owner = generate_id()
        org_id = generate_id()
        session_id = generate_id()
        _install_user_id(monkeypatch, caller)
        _install_open_session(monkeypatch)
        _install_org_ops(monkeypatch)
        store = _FakeApprovalStore(state={"actor_user_id": str(owner), "status": "pending"})
        _install_approval_store(monkeypatch, store)

        request = _build_confirmation_request(organization_id=org_id, session_id=session_id)

        async def drive() -> Any:
            return await RuntimeHandlers().respond_to_confirmation(request, ctx=MagicMock())

        with pytest.raises(ConnectError) as exc:
            await drive()
        assert exc.value.code == Code.PERMISSION_DENIED
        assert store.respond_calls == []

    async def test_missing_approval_returns_not_found(self, monkeypatch) -> None:
        user_id = generate_id()
        org_id = generate_id()
        session_id = generate_id()
        _install_user_id(monkeypatch, user_id)
        _install_open_session(monkeypatch)
        _install_org_ops(monkeypatch)
        store = _FakeApprovalStore(state=None)
        _install_approval_store(monkeypatch, store)

        request = _build_confirmation_request(organization_id=org_id, session_id=session_id)

        async def drive() -> Any:
            return await RuntimeHandlers().respond_to_confirmation(request, ctx=MagicMock())

        with pytest.raises(ConnectError) as exc:
            await drive()
        assert exc.value.code == Code.NOT_FOUND
        assert store.respond_calls == []

    async def test_non_member_rejected(self, monkeypatch) -> None:
        user_id = generate_id()
        org_id = generate_id()
        session_id = generate_id()
        _install_user_id(monkeypatch, user_id)
        _install_open_session(monkeypatch)
        _install_org_ops(monkeypatch, factory=_FailingOrgOps)
        store = _FakeApprovalStore(state={"actor_user_id": str(user_id), "status": "pending"})
        _install_approval_store(monkeypatch, store)

        request = _build_confirmation_request(organization_id=org_id, session_id=session_id)

        async def drive() -> Any:
            return await RuntimeHandlers().respond_to_confirmation(request, ctx=MagicMock())

        with pytest.raises(ConnectError) as exc:
            await drive()
        assert exc.value.code == Code.PERMISSION_DENIED
        assert store.respond_calls == []
