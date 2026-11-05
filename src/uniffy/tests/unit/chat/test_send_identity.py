from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from uniffy.core.errors import ValidationError
from uniffy.core.models.chat.message import ChatMessage
from uniffy.domains.chat.messages.idempotency import send_fingerprint, stage_sent_message


def test_fingerprint_normalizes_metadata_and_duplicate_attachments() -> None:
    file_id = uuid4()
    assert send_fingerprint(
        "hello", None, None, {"b": "2", "a": "1"}, [file_id], False
    ) == send_fingerprint(
        "hello",
        None,
        None,
        {"a": "1", "b": "2"},
        [file_id, file_id],
        False,
    )
    assert send_fingerprint("hello", None, None, None, [], False) != send_fingerprint(
        "hello",
        None,
        None,
        None,
        [],
        True,
    )


@pytest.mark.asyncio
async def test_matching_retry_returns_existing_message() -> None:
    session = AsyncMock()
    message = ChatMessage(channel_id=uuid4(), sender_id=uuid4(), request_fingerprint="same")
    session.scalar.side_effect = [None, message]
    result, inserted = await stage_sent_message(session, message)
    assert result is message
    assert not inserted


@pytest.mark.asyncio
@pytest.mark.parametrize("deleted,fingerprint", [(False, "different"), (True, "same")])
async def test_retry_rejects_conflicting_or_deleted_message(deleted: bool, fingerprint: str) -> None:
    session = AsyncMock()
    message = ChatMessage(
        channel_id=uuid4(), sender_id=uuid4(), request_fingerprint="same", is_deleted=deleted
    )
    session.scalar.side_effect = [None, message]
    proposed = ChatMessage(
        channel_id=message.channel_id,
        sender_id=message.sender_id,
        client_message_id=uuid4(),
        request_fingerprint=fingerprint,
    )
    with pytest.raises(ValidationError):
        await stage_sent_message(session, proposed)


@pytest.mark.asyncio
async def test_first_send_needs_only_insert() -> None:
    session = AsyncMock()
    message = ChatMessage(channel_id=uuid4(), sender_id=uuid4(), client_message_id=uuid4())
    session.scalar.return_value = message
    result, inserted = await stage_sent_message(session, message)
    assert result is message
    assert inserted
    session.scalar.assert_awaited_once()
