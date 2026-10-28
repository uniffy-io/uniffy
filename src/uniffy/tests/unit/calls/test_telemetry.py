import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from connectrpc.errors import ConnectError
from loguru import logger
from prometheus_client import REGISTRY
from uniffy_proto.calls.v1.calls_pb import JoinCallRequest

from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.json_codec import dumps_bytes
from uniffy.core.types import generate_id
from uniffy.core.webhooks import WebhookVerificationError
from uniffy.domains.calls import handlers, webhook
from uniffy.domains.calls.config import LiveKitConfig, LiveKitConfigError
from uniffy.domains.calls.livekit import LiveKitUnavailableError
from uniffy.domains.calls.metrics import (
    JOINS,
    WEBHOOK_EVENTS,
    WEBHOOK_VERIFICATION,
    JoinOutcome,
    Outcome,
)
from uniffy.domains.calls.tokens import livekit_room_name
from uniffy.tests.unit.calls.test_tokens import API_KEY, SECRET, _webhook_auth


@pytest.fixture
def rpc(monkeypatch):
    @asynccontextmanager
    async def session():
        yield object()

    ops = SimpleNamespace(join_call=AsyncMock())
    monkeypatch.setattr(handlers, "open_session", session)
    monkeypatch.setattr(handlers, "CallOperations", lambda _: ops)
    monkeypatch.setattr(handlers, "current_user_id", generate_id)
    monkeypatch.setattr(handlers, "current_session_id", generate_id)
    return ops


@pytest.mark.parametrize(
    ("error", "outcome"),
    [
        (ValidationError("call", "Call is full"), JoinOutcome.FULL),
        (ValidationError("call", "Call has ended"), JoinOutcome.ENDED),
        (
            ValidationError("device", "Already in this call on too many devices"),
            JoinOutcome.DEVICE_LIMIT,
        ),
        (ValidationError("call", "Already in a call in another channel"), JoinOutcome.ANOTHER_CALL),
        (
            PermissionDeniedError("calls", "Calls are disabled for this organization"),
            JoinOutcome.DISABLED,
        ),
        (PermissionDeniedError("join"), JoinOutcome.DENIED),
        (NotFoundError("call", generate_id()), JoinOutcome.NOT_FOUND),
        (LiveKitConfigError("missing"), JoinOutcome.NOT_CONFIGURED),
        (LiveKitUnavailableError("down"), JoinOutcome.MEDIA_UNAVAILABLE),
        (RuntimeError("internal"), JoinOutcome.ERROR),
        (asyncio.CancelledError(), JoinOutcome.CANCELLED),
    ],
)
async def test_join_rpc_records_cause_once_with_call_context(rpc, error, outcome):
    rpc.join_call.side_effect = error
    call_id = generate_id()
    request = JoinCallRequest(
        organization_id=str(generate_id()), call_id=str(call_id), device_id="test"
    )
    counter = JOINS.labels("join_call", outcome)
    before = counter._value.get()
    records = []
    sink = logger.add(lambda message: records.append(message.record))
    try:
        with pytest.raises(
            asyncio.CancelledError if isinstance(error, asyncio.CancelledError) else ConnectError
        ):
            await handlers.CallHandlers().join_call(request, None)
        logger.info("outside request")
    finally:
        logger.remove(sink)
    assert counter._value.get() == before + 1
    results = [r for r in records if r["message"] == "Call admission result"]
    assert len(results) == 1
    assert results[0]["extra"]["call_id"] == str(call_id)
    assert results[0]["extra"]["outcome"] == outcome
    assert "call_id" not in records[-1]["extra"]


async def test_invalid_join_request_is_measured_before_domain_invocation(rpc):
    counter = JOINS.labels("join_call", JoinOutcome.INVALID)
    before = counter._value.get()
    with pytest.raises(ConnectError):
        await handlers.CallHandlers().join_call(JoinCallRequest(organization_id="invalid"), None)
    assert counter._value.get() == before + 1
    rpc.join_call.assert_not_awaited()


@pytest.fixture
def provider(monkeypatch):
    monkeypatch.setattr(
        webhook,
        "get_livekit_config",
        lambda: LiveKitConfig("http://media", API_KEY, SECRET, "/livekit"),
    )
    return webhook.LiveKitWebhookProvider()


def test_webhook_verification_counts_valid_and_invalid_signatures(provider):
    body = dumps_bytes({"event": "room_finished"})
    valid = WEBHOOK_VERIFICATION.labels(Outcome.SUCCESS)
    invalid = WEBHOOK_VERIFICATION.labels(Outcome.ERROR)
    before = valid._value.get(), invalid._value.get()
    provider.verify(body, _webhook_auth(body))
    with pytest.raises(WebhookVerificationError):
        provider.verify(body, _webhook_auth(body, secret="wrong" * 10))
    with pytest.raises(WebhookVerificationError):
        provider.verify(b"[]", _webhook_auth(b"[]"))
    assert valid._value.get() == before[0] + 1
    assert invalid._value.get() == before[1] + 2


async def test_webhook_processing_errors_keep_call_id_and_bounded_event_labels(
    provider, monkeypatch
):
    call_id = generate_id()
    process = AsyncMock(side_effect=RuntimeError("database down"))
    monkeypatch.setattr(provider, "_on_room_finished", process)
    counter = WEBHOOK_EVENTS.labels("room_finished", Outcome.ERROR)
    before = counter._value.get()
    records = []
    sink = logger.add(lambda message: records.append(message.record))
    try:
        with pytest.raises(RuntimeError):
            await provider.process({
                "event": "room_finished",
                "room": {"name": livekit_room_name(generate_id(), call_id)},
            })
        await provider.process({"event": "unbounded-user-value", "room": {"name": {}}})
    finally:
        logger.remove(sink)
    assert counter._value.get() == before + 1
    assert any(r["extra"].get("call_id") == str(call_id) for r in records)
    samples = [
        s for m in REGISTRY.collect() for s in m.samples if s.name.startswith("uniffy_calls_")
    ]
    assert all("call_id" not in s.labels and "organization_id" not in s.labels for s in samples)
    assert all("unbounded-user-value" not in s.labels.values() for s in samples)


async def test_successful_admission_records_returned_call(rpc, monkeypatch):
    from uniffy.core.models.calls import Call, CallType, ScreenShareQuality

    call = Call(
        organization_id=generate_id(),
        channel_id=generate_id(),
        call_type=CallType.CHANNEL,
        initiator_user_id=generate_id(),
        host_user_id=generate_id(),
        livekit_room_name="room",
    )
    rpc.join_call.return_value = (call, [], SimpleNamespace(token="token"))
    rpc.resolve_profiles = AsyncMock(return_value={})
    rpc.resolve_screen_share_ceiling = AsyncMock(return_value=ScreenShareQuality.BALANCED)
    monkeypatch.setattr(handlers, "_ice_fields", lambda _: {})
    monkeypatch.setattr(handlers, "get_livekit_config", lambda: SimpleNamespace(ws_url="/livekit"))
    counter = JOINS.labels("join_call", JoinOutcome.SUCCESS)
    before = counter._value.get()
    request = JoinCallRequest(
        organization_id=str(call.organization_id), call_id=str(call.id), device_id="test"
    )
    response = await handlers.CallHandlers().join_call(request, None)
    assert response.call.id == str(call.id)
    assert counter._value.get() == before + 1
