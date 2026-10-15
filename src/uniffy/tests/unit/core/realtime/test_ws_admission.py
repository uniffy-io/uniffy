import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID

import pytest

from uniffy.core.realtime import ws_routes
from uniffy.core.types import generate_id


@pytest.fixture
def admission(monkeypatch: pytest.MonkeyPatch) -> SimpleNamespace:
    payload = {
        "type": "access",
        "sub": str(generate_id()),
        "org_id": str(generate_id()),
        "sid": str(generate_id()),
        "tkv": 1,
    }
    monkeypatch.setattr(ws_routes, "origin_is_allowed", lambda *_: True)
    monkeypatch.setattr(ws_routes, "decode_access_token", lambda _: payload.copy())
    monkeypatch.setattr(ws_routes, "token_revocation", AsyncMock(return_value=None))
    monkeypatch.setattr(ws_routes, "is_active_member", AsyncMock(return_value=True))
    monkeypatch.setattr(ws_routes, "run_multiplexed_session", AsyncMock())
    monkeypatch.setattr(ws_routes, "_active_sockets", {})
    monkeypatch.setattr(ws_routes, "MAX_SOCKETS_PER_USER", 1)

    return SimpleNamespace(
        payload=payload, user_id=UUID(payload["sub"]), org_id=UUID(payload["org_id"])
    )


def socket() -> AsyncMock:
    ws = AsyncMock()
    ws.headers = {"authorization": "Bearer test"}
    return ws


async def test_overlapping_accepts_cannot_claim_same_slot(admission):
    first, second = socket(), socket()
    accepting, release = asyncio.Event(), asyncio.Event()

    async def accept(**_kwargs):
        accepting.set()
        await release.wait()

    first.accept.side_effect = accept
    pending = asyncio.create_task(ws_routes.realtime(first, admission.org_id))
    try:
        await asyncio.wait_for(accepting.wait(), 1)
        await ws_routes.realtime(second, admission.org_id)
        second.accept.assert_not_awaited()
        second.close.assert_awaited_once_with(code=1013, reason="too many connections")
        assert ws_routes._active_sockets[admission.user_id] == 1
    finally:
        release.set()
        await pending
    assert ws_routes._active_sockets == {}


async def test_full_user_does_not_block_another_user(admission):
    ws_routes._active_sockets[admission.user_id] = 1
    admission.payload["sub"] = str(generate_id())
    ws = socket()
    await ws_routes.realtime(ws, admission.org_id)
    ws.accept.assert_awaited_once()
    assert ws_routes._active_sockets == {admission.user_id: 1}


@pytest.mark.parametrize("phase", ["accept", "session"])
@pytest.mark.parametrize("cancel", [False, True])
async def test_failed_or_cancelled_connections_release_slot(admission, phase, cancel, monkeypatch):
    ws = socket()
    entered = asyncio.Event()

    async def fail(*_args, **_kwargs):
        entered.set()
        if cancel:
            await asyncio.Future()
        raise RuntimeError("connection failed")

    if phase == "accept":
        ws.accept.side_effect = fail
    else:
        monkeypatch.setattr(ws_routes, "run_multiplexed_session", fail)
    pending = asyncio.create_task(ws_routes.realtime(ws, admission.org_id))
    await asyncio.wait_for(entered.wait(), 1)
    if cancel:
        pending.cancel()
    with pytest.raises(asyncio.CancelledError if cancel else RuntimeError):
        await pending
    assert ws_routes._active_sockets == {}
    monkeypatch.setattr(ws_routes, "run_multiplexed_session", AsyncMock())
    replacement = socket()
    await ws_routes.realtime(replacement, admission.org_id)
    replacement.accept.assert_awaited_once()
    assert ws_routes._active_sockets == {}
