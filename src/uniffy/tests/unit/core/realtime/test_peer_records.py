"""Accepted records travel between replicas sealed and open only under their own scope."""

import base64
import os
from typing import Any
from uuid import UUID

import pycrdt
import pytest
from prometheus_client import REGISTRY

from uniffy.core.crypto import OrgDataCipher, StaticKeySource
from uniffy.core.realtime import fanout as fanout_module
from uniffy.core.realtime import publisher as publisher_module
from uniffy.core.realtime.buffer import UpdateBuffer
from uniffy.core.realtime.buffer_keys import BufferScope, Receipt, record_aad
from uniffy.core.realtime.fanout import AcceptedEffects, AcceptedUpdate
from uniffy.core.realtime.markdown import markdown_text
from uniffy.core.realtime.publisher import RealtimePayloadKind, doc_channel, publish_doc_update
from uniffy.core.realtime.router import RemoteUpdate, _parse_remote_update
from uniffy.core.realtime.state import YDocSession
from uniffy.core.realtime.wire import MAX_WIRE_STRING_BYTES
from uniffy.core.realtime.ydoc_manager import YDocManager
from uniffy.core.types import ContentType, generate_id

ORGANIZATION = generate_id()
NOTE = generate_id()
KEY = (ContentType.NOTE, NOTE)
ACTOR = generate_id()
GENERATION = "3f9c1a52-7d4e-4b8a-9c61-0e2f5d8b7a14"
EPOCH = "1c2b3a49-5867-4f3e-9d2c-1b0a9f8e7d6c"
SEALED = b"\x01sealed record"


async def test_a_published_record_carries_sealed_bytes_with_its_update_id_and_actor(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sent: list[tuple[str, dict[str, Any]]] = []

    async def capture(channel: str, payload: dict[str, Any]) -> None:
        sent.append((channel, payload))

    monkeypatch.setattr(publisher_module, "publish_to_channel", capture)

    await publish_doc_update(
        *KEY,
        SEALED,
        generation=GENERATION,
        epoch=EPOCH,
        sequence=3,
        update_id="u-3",
        actor_id=ACTOR,
        origin_replica="replica",
    )

    ((channel, payload),) = sent
    assert channel == doc_channel(*KEY)
    assert set(payload) == {
        "kind",
        "origin_replica",
        "generation",
        "epoch",
        "sequence",
        "update_id",
        "actor_id",
        "sealed",
        "published_at",
    }
    assert payload["kind"] == RealtimePayloadKind.ACCEPTED_UPDATE
    assert (payload["sequence"], payload["update_id"], payload["actor_id"]) == (
        3,
        "u-3",
        str(ACTOR),
    )
    assert base64.b64decode(payload["sealed"]) == SEALED


def hint(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "kind": RealtimePayloadKind.ACCEPTED_UPDATE,
        "generation": GENERATION,
        "epoch": EPOCH,
        "sequence": 3,
        "update_id": "u-3",
        "actor_id": str(ACTOR),
        "sealed": base64.b64encode(SEALED).decode("ascii"),
    }
    payload.update(overrides)
    return payload


def test_the_router_reads_a_sealed_record_with_what_its_associated_data_names() -> None:
    assert _parse_remote_update(hint()) == RemoteUpdate(
        SEALED, GENERATION, EPOCH, 3, "u-3", ACTOR
    )


@pytest.mark.parametrize(
    "overrides",
    [
        {"update_id": ""},
        {"update_id": None},
        {"update_id": "x" * (MAX_WIRE_STRING_BYTES + 1)},
        {"actor_id": None},
        {"actor_id": "not an actor"},
        {"sealed": "not base64!"},
        {"sealed": None, "update": base64.b64encode(b"plaintext").decode("ascii")},
        {"sequence": 0},
    ],
)
def test_the_router_drops_a_record_it_could_not_open(overrides: dict[str, object]) -> None:
    assert _parse_remote_update(hint(**overrides)) is None


async def test_accepted_effects_publish_the_record_the_buffer_stored(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    published: list[tuple[tuple[Any, ...], dict[str, Any]]] = []

    async def capture(*args: Any, **kwargs: Any) -> None:
        published.append((args, kwargs))

    async def reelect(_session: YDocSession) -> None:
        return None

    monkeypatch.setattr(fanout_module, "publish_doc_update", capture)
    effects = AcceptedEffects("replica", reelect)
    session = YDocSession(key=KEY, ydoc=pycrdt.Doc(), organization_id=ORGANIZATION)

    effects.queue(session, AcceptedUpdate(SEALED, Receipt(GENERATION, EPOCH, 3, "u-3"), ACTOR))
    await effects.drain(1.0)

    assert published == [
        (
            (ContentType.NOTE, NOTE, SEALED),
            {
                "generation": GENERATION,
                "epoch": EPOCH,
                "sequence": 3,
                "update_id": "u-3",
                "actor_id": ACTOR,
                "origin_replica": "replica",
            },
        )
    ]


def remote_failures() -> float:
    labels = {"source": "remote"}
    return REGISTRY.get_sample_value("uniffy_realtime_buffer_unseal_failures_total", labels) or 0


class Resident:
    """One replica's manager holding a resident note at sequence 2 of its epoch."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self.cipher = OrgDataCipher(StaticKeySource({ORGANIZATION: (1, os.urandom(32))}))
        self.manager = YDocManager(buffer=UpdateBuffer(cipher=self.cipher))
        doc = pycrdt.Doc()
        markdown_text(doc).insert(0, "base")
        self.session = YDocSession(key=KEY, ydoc=doc, organization_id=ORGANIZATION)
        self.session.generation, self.session.epoch, self.session.head_seq = GENERATION, EPOCH, 2
        self.refreshes = 0

        async def refresh(_session: YDocSession) -> None:
            self.refreshes += 1

        monkeypatch.setattr(self.manager, "refresh_document", refresh)

    def typed(self, suffix: str) -> bytes:
        doc = pycrdt.Doc()
        doc.apply_update(self.session.ydoc.get_update())
        before = doc.get_state()
        text = markdown_text(doc)
        text.insert(len(str(text)), suffix)
        return doc.get_update(before)

    async def seal(self, update: bytes, *, actor: UUID = ACTOR) -> bytes:
        scope = BufferScope(ORGANIZATION, *KEY, GENERATION, EPOCH)
        return await self.cipher.seal(ORGANIZATION, update, aad=record_aad(scope, "u-3", actor))

    @property
    def text(self) -> str:
        return str(markdown_text(self.session.ydoc))


async def test_a_peer_record_that_opens_continues_the_resident_head(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    resident = Resident(monkeypatch)
    sealed = await resident.seal(resident.typed(" peer"))

    await resident.manager._apply_remote_update(
        resident.session, RemoteUpdate(sealed, GENERATION, EPOCH, 3, "u-3", ACTOR)
    )

    assert resident.text == "base peer"
    assert resident.session.head_seq == 3
    assert resident.refreshes == 0


@pytest.mark.parametrize("tamper", ["actor", "bytes", "epoch"])
async def test_a_peer_record_that_does_not_open_reloads_like_a_gap(
    monkeypatch: pytest.MonkeyPatch, tamper: str
) -> None:
    resident = Resident(monkeypatch)
    actor = generate_id() if tamper == "actor" else ACTOR
    sealed = await resident.seal(resident.typed(" peer"), actor=actor)
    if tamper == "bytes":
        sealed = sealed[:-1] + bytes([sealed[-1] ^ 0x01])
    epoch = "another-epoch" if tamper == "epoch" else EPOCH
    failures = remote_failures()

    await resident.manager._apply_remote_update(
        resident.session, RemoteUpdate(sealed, GENERATION, epoch, 3, "u-3", ACTOR)
    )

    assert resident.refreshes == 1
    assert resident.text == "base"
    assert resident.session.head_seq == 2
    assert remote_failures() == failures + 1
