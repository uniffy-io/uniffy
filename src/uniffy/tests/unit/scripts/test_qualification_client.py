"""The qualification driver answers a retryable refusal the way the web client does."""

import asyncio

import pytest

from uniffy.core.realtime.multiplex import peek_var_string, read_var_string, read_var_uint
from uniffy.core.realtime.session import UNAVAILABLE_REASON
from uniffy.core.realtime.wire import (
    MESSAGE_UPDATE,
    create_accepted_receipt_message,
    create_auth_denied_message,
    create_committed_message,
    create_generation_message,
    create_session_state_message,
)
from uniffy.scripts.realtime_qualification import client
from uniffy.scripts.realtime_qualification.client import DocReplica, Recorder, RealtimeSocket

GENERATION = "generation-1"
EPOCH = "epoch-1"
WRITER = 41
RETRY_SECONDS = 0.01
UNAVAILABLE = create_auth_denied_message(UNAVAILABLE_REASON)


@pytest.fixture(autouse=True)
def short_backoff(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(client, "UNAVAILABLE_RETRY_SECONDS", RETRY_SECONDS)


def attached_writer(edits: int) -> tuple[DocReplica, RealtimeSocket]:
    """A synced writer whose socket queued one update per edit and nothing else."""
    recorder = Recorder()
    socket = RealtimeSocket("ws://qualification.invalid", "token", recorder)
    replica = DocReplica(
        "NOTE:doc",
        WRITER,
        {},
        recorder,
        writer=True,
        batch_seconds=0,
        awareness_per_edit=False,
    )
    socket.attach(replica, announce=False)
    replica.receive(create_generation_message(GENERATION), 0.0)
    replica.receive(
        create_session_state_message(
            generation=GENERATION,
            epoch=EPOCH,
            head_sequence=0,
            checkpoint_sequence=0,
            checkpoint_revision=1,
        ),
        0.0,
    )
    for _ in range(edits):
        replica.edit("k")
    return replica, socket


def update_id(number: int) -> str:
    return f"qualification-{WRITER}:{number}"


def sent_updates(socket: RealtimeSocket) -> list[int]:
    """Counters of the update frames the socket queued since the last call, in send order."""
    sent: list[int] = []
    while not socket.outbound.empty():
        frame, _ = socket.outbound.get_nowait()
        _, offset = peek_var_string(frame)
        kind, offset = read_var_uint(frame, offset)
        if kind == MESSAGE_UPDATE:
            _, offset = read_var_string(frame, offset)
            sent.append(int(read_var_string(frame, offset)[0].rsplit(":", 1)[1]))
    return sent


def receipt(number: int, sequence: int) -> bytes:
    return create_accepted_receipt_message(
        update_id=update_id(number),
        generation=GENERATION,
        epoch=EPOCH,
        accepted_sequence=sequence,
    )


async def outlast_backoff() -> None:
    await asyncio.sleep(RETRY_SECONDS * 5)


@pytest.mark.parametrize("answer", ["receipt", "commit"])
async def test_an_answer_during_the_backoff_resends_only_the_refused_update(answer: str) -> None:
    replica, socket = attached_writer(3)
    replica.receive(UNAVAILABLE, 0.0)

    second = receipt(2, 1) if answer == "receipt" else create_committed_message(update_id(2))
    replica.receive(second, 0.0)
    replica.receive(receipt(3, 2), 0.0)
    replica.receive(receipt(1, 3), 0.0)
    await outlast_backoff()

    # The third update was in flight, never refused, so it goes out once.
    assert sent_updates(socket) == [1, 2, 3, 1]
    assert replica.unaccepted() == 0


async def test_the_backoff_resends_refused_updates_once_and_later_answers_add_nothing() -> None:
    replica, socket = attached_writer(3)
    replica.receive(UNAVAILABLE, 0.0)
    await outlast_backoff()

    assert sent_updates(socket) == [1, 2, 3, 1]

    replica.receive(receipt(3, 1), 0.0)
    replica.receive(receipt(2, 2), 0.0)
    replica.receive(receipt(1, 3), 0.0)
    await outlast_backoff()

    assert sent_updates(socket) == []
    assert replica.unaccepted() == 0


async def test_each_refusal_answers_the_oldest_update_in_flight() -> None:
    replica, socket = attached_writer(4)
    replica.receive(UNAVAILABLE, 0.0)
    replica.receive(UNAVAILABLE, 0.0)

    replica.receive(receipt(4, 1), 0.0)

    assert sent_updates(socket) == [1, 2, 3, 4, 1, 2]
