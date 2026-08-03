"""Tests for the around-a-target message window that backs chat deep links."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

# Pre-import the auth package (full chain) so its handlers module
# finishes before any other test-file import triggers a partial-init
# cycle through core.converters.
import uniffy.domains.auth  # noqa: F401
from uniffy.core.models.chat.message import ChatMessage, SenderType
from uniffy.core.types import generate_id
from uniffy.domains.chat.messages.operations import ChatMessageOperations

CHANNEL_ID = generate_id()
ORG_ID = generate_id()
USER_ID = generate_id()
BASE_TIME = datetime(2026, 8, 1, 12, 0, tzinfo=UTC)


def _message(offset_minutes: int, *, channel_id=CHANNEL_ID, is_deleted: bool = False) -> ChatMessage:
    return ChatMessage(
        id=generate_id(),
        channel_id=channel_id,
        organization_id=ORG_ID,
        sender_id=USER_ID,
        sender_type=SenderType.USER,
        content=f"message {offset_minutes}",
        created_at=BASE_TIME + timedelta(minutes=offset_minutes),
        is_deleted=is_deleted,
    )


def _scalars(messages: list[ChatMessage]):
    result = MagicMock()
    result.scalars.return_value.all.return_value = messages
    return result


def _make_ops(*, execute_results: list) -> ChatMessageOperations:
    session = MagicMock()
    results = list(execute_results)

    async def fake_execute(stmt):
        if results:
            return results.pop(0)
        return _scalars([])

    session.execute = fake_execute

    access = MagicMock()
    access.get_channel = AsyncMock(return_value=MagicMock(id=CHANNEL_ID))
    access.check_access = AsyncMock()
    return ChatMessageOperations(session, access)


async def test_window_includes_target_between_neighbours():
    target = _message(0)
    older = [_message(-2), _message(-1)]
    newer = [_message(1)]
    ops = _make_ops(execute_results=[_scalars(list(reversed(older))), _scalars(newer)])
    ops._get_message_by_id = AsyncMock(return_value=target)

    messages, has_more = await ops.get_messages(
        USER_ID, ORG_ID, CHANNEL_ID, around_id=target.id, limit=10
    )

    assert [m.id for m in messages] == [older[0].id, older[1].id, target.id, newer[0].id]
    assert has_more is False


async def test_window_has_more_reports_the_older_side():
    target = _message(0)
    # limit 4 -> half 2, so a third older row is the "more history exists" signal.
    older_desc = [_message(-1), _message(-2), _message(-3)]
    ops = _make_ops(execute_results=[_scalars(older_desc), _scalars([])])
    ops._get_message_by_id = AsyncMock(return_value=target)

    messages, has_more = await ops.get_messages(
        USER_ID, ORG_ID, CHANNEL_ID, around_id=target.id, limit=4
    )

    assert has_more is True
    assert [m.id for m in messages] == [older_desc[1].id, older_desc[0].id, target.id]


async def test_deleted_target_falls_back_to_the_latest_page():
    latest = [_message(-1), _message(0)]
    ops = _make_ops(execute_results=[_scalars(list(reversed(latest)))])
    ops._get_message_by_id = AsyncMock(return_value=_message(0, is_deleted=True))

    messages, has_more = await ops.get_messages(
        USER_ID, ORG_ID, CHANNEL_ID, around_id=generate_id(), limit=10
    )

    assert [m.id for m in messages] == [latest[0].id, latest[1].id]
    assert has_more is False


async def test_target_from_another_channel_falls_back_to_the_latest_page():
    ops = _make_ops(execute_results=[_scalars([])])
    ops._get_message_by_id = AsyncMock(return_value=_message(0, channel_id=generate_id()))

    messages, has_more = await ops.get_messages(
        USER_ID, ORG_ID, CHANNEL_ID, around_id=generate_id(), limit=10
    )

    assert messages == []
    assert has_more is False
