"""A lost membership detaches that organization's documents on every replica and nothing else."""

import asyncio
import fnmatch
import itertools
from collections.abc import AsyncGenerator, AsyncIterator, Callable
from typing import Any
from unittest.mock import AsyncMock
from uuid import UUID

import pycrdt
import pytest
from loguru import logger
from prometheus_client import REGISTRY

from uniffy.core.json_codec import dumps_bytes, loads
from uniffy.core.realtime import publisher as publisher_module
from uniffy.core.realtime import router as router_module
from uniffy.core.realtime.buffer import UpdateBuffer
from uniffy.core.realtime.multiplex import encode_doc_frame
from uniffy.core.realtime.publisher import (
    membership_revoke_channel,
    publish_membership_revoke,
    publish_membership_revoke_safe,
    session_revoke_channel,
)
from uniffy.core.realtime.state import ClientHandle, DocKey, WSSession, YDocSession, doc_name_for
from uniffy.core.realtime.wire import create_auth_denied_message
from uniffy.core.realtime.ydoc_manager import YDocManager
from uniffy.core.types import ContentType, generate_id

TIMEOUT = 5.0
ROUTER_PATTERNS = 6

Message = tuple[str, dict[str, object]]


def denial_frame(key: DocKey) -> bytes:
    return encode_doc_frame(
        doc_name_for(key), create_auth_denied_message("not a member", no_view=True)
    )


def membership_closes() -> float:
    labels = {"content_type": ContentType.NOTE.value, "reason": "membership_revoked"}
    return REGISTRY.get_sample_value("uniffy_realtime_permission_rejections_total", labels) or 0


class Bus:
    """Delivers each publish to the pattern subscribers whose glob matches, as PSUBSCRIBE does."""

    def __init__(self) -> None:
        self.subscribers: list[tuple[str, asyncio.Queue[tuple[str, dict[str, Any]]]]] = []

    async def publish(self, channel: str, payload: dict[str, Any]) -> None:
        wire = loads(dumps_bytes(payload))
        for pattern, queue in self.subscribers:
            if fnmatch.fnmatchcase(channel, pattern):
                queue.put_nowait((channel, wire))

    async def subscribe(self, *patterns: str) -> AsyncGenerator[tuple[str, dict[str, Any]] | None]:
        queue: asyncio.Queue[tuple[str, dict[str, Any]]] = asyncio.Queue()
        self.subscribers.extend((pattern, queue) for pattern in patterns)
        while True:
            yield await queue.get()


class Replica:
    """One process's manager with resident documents and attached sockets, no database needed."""

    def __init__(self) -> None:
        self.manager = YDocManager(buffer=UpdateBuffer())
        self.manager.install()
        self._conn_ids = itertools.count(1)

    def document(self, organization_id: UUID) -> DocKey:
        key = (ContentType.NOTE, generate_id())
        session = YDocSession(key=key, ydoc=pycrdt.Doc(), organization_id=organization_id)
        self.manager._sessions[key] = session
        self.manager.realtime_router.register_doc_session(key, session)
        return key

    def socket(self, user_id: UUID, organization_id: UUID) -> WSSession:
        return WSSession(
            user_id=user_id,
            organization_id=organization_id,
            token_version=1,
            conn_id=next(self._conn_ids),
            ws=AsyncMock(),
        )

    def attach(self, ws_session: WSSession, key: DocKey) -> ClientHandle:
        return self.manager._attach_client(self.manager._sessions[key], ws_session, can_edit=True)

    def attached(self, handle: ClientHandle) -> bool:
        session = self.manager._sessions[handle.doc_key]
        return session.clients.get(handle.conn_id) is handle and not handle.closed

    async def close(self) -> None:
        await self.manager.realtime_router.stop()
        tasks = [
            task
            for session in self.manager._sessions.values()
            for task in (session.eviction_task, session.seed_task)
            if task is not None
        ]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


@pytest.fixture
async def replica() -> AsyncIterator[Replica]:
    resident = Replica()
    try:
        yield resident
    finally:
        await resident.close()


def assert_untouched(replica: Replica, handle: ClientHandle) -> None:
    assert replica.attached(handle)
    assert not handle.ws_session.denied_docs
    assert handle.ws_session.outbound.empty()
    handle.ws.close.assert_not_awaited()


async def test_publish_membership_revoke_names_the_organization_on_the_users_channel(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sent: list[tuple[str, dict[str, Any]]] = []

    async def capture(channel: str, payload: dict[str, Any]) -> None:
        sent.append((channel, payload))

    monkeypatch.setattr(publisher_module, "publish_to_channel", capture)
    user_id, organization_id = generate_id(), generate_id()

    await publish_membership_revoke(user_id, organization_id)

    ((channel, payload),) = sent
    assert channel == membership_revoke_channel(user_id) == f"auth:revoke_org:{user_id}"
    assert set(payload) == {"origin_replica", "organization_id", "published_at"}
    assert payload["organization_id"] == str(organization_id)


async def test_a_published_membership_revoke_detaches_only_that_users_documents_in_that_org(
    monkeypatch: pytest.MonkeyPatch, replica: Replica
) -> None:
    bus = Bus()
    monkeypatch.setattr(publisher_module, "publish_to_channel", bus.publish)
    monkeypatch.setattr(router_module, "subscribe_patterns", bus.subscribe)
    removed, colleague = generate_id(), generate_id()
    acme, globex = generate_id(), generate_id()
    plan, roadmap, budget = replica.document(acme), replica.document(acme), replica.document(globex)
    in_acme = replica.socket(removed, acme)
    on_plan, on_roadmap = replica.attach(in_acme, plan), replica.attach(in_acme, roadmap)
    in_globex = replica.attach(replica.socket(removed, globex), budget)
    colleague_on_plan = replica.attach(replica.socket(colleague, acme), plan)
    closes = membership_closes()

    await replica.manager.realtime_router.start()
    async with asyncio.timeout(TIMEOUT):
        while len(bus.subscribers) < ROUTER_PATTERNS:
            await asyncio.sleep(0)
    await publish_membership_revoke_safe(removed, acme)
    async with asyncio.timeout(TIMEOUT):
        while replica.attached(on_plan) or replica.attached(on_roadmap):
            await asyncio.sleep(0)

    assert in_acme.denied_docs == {plan, roadmap}
    assert in_acme.doc_handles == {}
    frames = [in_acme.outbound.get_nowait() for _ in range(in_acme.outbound.qsize())]
    assert sorted(frames) == sorted([denial_frame(plan), denial_frame(roadmap)])
    in_acme.ws.close.assert_not_awaited()
    assert membership_closes() == closes + 2
    assert set(replica.manager.realtime_router._user_handles[removed]) == {in_globex.conn_id}
    assert_untouched(replica, in_globex)
    assert_untouched(replica, colleague_on_plan)


MALFORMED: dict[str, Callable[[UUID, UUID], Message]] = {
    "missing organization": lambda user, _org: (membership_revoke_channel(user), {}),
    "numeric organization": lambda user, _org: (
        membership_revoke_channel(user),
        {"organization_id": 42},
    ),
    "null organization": lambda user, _org: (
        membership_revoke_channel(user),
        {"organization_id": None},
    ),
    "invalid organization": lambda user, _org: (
        membership_revoke_channel(user),
        {"organization_id": "not-a-uuid"},
    ),
    "session channel": lambda user, org: (
        session_revoke_channel(user),
        {"organization_id": str(org)},
    ),
    "invalid user": lambda _user, org: (
        "auth:revoke_org:not-a-uuid",
        {"organization_id": str(org)},
    ),
    "extra segment": lambda user, org: (
        f"{membership_revoke_channel(user)}:extra",
        {"organization_id": str(org)},
    ),
}


@pytest.mark.parametrize("build", list(MALFORMED.values()), ids=list(MALFORMED))
async def test_a_malformed_membership_revoke_detaches_nothing(
    replica: Replica, build: Callable[[UUID, UUID], Message]
) -> None:
    user_id, organization_id = generate_id(), generate_id()
    socket = replica.socket(user_id, organization_id)
    handle = replica.attach(socket, replica.document(organization_id))

    await replica.manager.realtime_router._handle_revoke_org_message(
        *build(user_id, organization_id)
    )

    assert_untouched(replica, handle)


async def test_a_revoke_for_a_user_with_nothing_attached_here_detaches_nothing(
    replica: Replica,
) -> None:
    organization_id = generate_id()
    socket = replica.socket(generate_id(), organization_id)
    handle = replica.attach(socket, replica.document(organization_id))

    await replica.manager.realtime_router._handle_revoke_org_message(
        membership_revoke_channel(generate_id()), {"organization_id": str(organization_id)}
    )

    assert_untouched(replica, handle)


async def test_the_safe_publisher_logs_and_swallows_a_failed_publish(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def unreachable(_channel: str, _payload: dict[str, Any]) -> None:
        raise ConnectionError("valkey unreachable")

    monkeypatch.setattr(publisher_module, "publish_to_channel", unreachable)
    records: list[Any] = []
    sink = logger.add(lambda message: records.append(message.record), level="WARNING")
    user_id, organization_id = generate_id(), generate_id()
    try:
        await publish_membership_revoke_safe(user_id, organization_id)
    finally:
        logger.remove(sink)

    (record,) = [
        found for found in records if found["extra"].get("component") == "core.realtime.publisher"
    ]
    assert record["level"].name == "WARNING"
    assert record["exception"] is not None
    assert record["extra"]["user_id"] == str(user_id)
    assert record["extra"]["organization_id"] == str(organization_id)
