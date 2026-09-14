from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from sqlalchemy.dialects import postgresql

from uniffy.core.types import generate_id
from uniffy.domains.chat.messages.notifications import MessageNotifications
from uniffy.domains.chat.reads.flush import pending_cache_refresh
from uniffy.domains.chat.streaming import events
from uniffy.domains.chat.streaming.handlers import _payload_to_user_event


def test_absolute_unread_event_carries_explicit_null_cursor() -> None:
    target = str(generate_id())
    event = _payload_to_user_event({
        "_type": events.UNREAD_COUNT_CHANGED,
        "channel_id": str(generate_id()),
        "unread_count": 3,
        "absolute": True,
        "last_read_message_id": "",
        "first_unread_message_id": target,
    })
    assert event is not None
    assert event.unread_count.absolute
    assert event.unread_count.HasField("last_read_message_id")
    assert event.unread_count.last_read_message_id == ""
    assert event.unread_count.first_unread_message_id == target


def test_unread_delta_leaves_cursor_fields_absent() -> None:
    event = _payload_to_user_event({
        "_type": events.UNREAD_COUNT_CHANGED,
        "channel_id": str(generate_id()),
        "unread_count": 1,
    })
    assert event is not None
    assert not event.unread_count.absolute
    assert not event.unread_count.HasField("last_read_message_id")
    assert not event.unread_count.HasField("first_unread_message_id")
    assert not event.unread_count.HasField("message_id")


def test_send_delta_names_the_root_row() -> None:
    root = str(generate_id())
    event = _payload_to_user_event({
        "_type": events.UNREAD_COUNT_CHANGED,
        "channel_id": str(generate_id()),
        "unread_count": 1,
        "message_id": root,
    })
    assert event is not None
    assert event.unread_count.message_id == root


async def test_send_delta_fans_the_root_row_to_every_member_but_the_sender() -> None:
    channel = SimpleNamespace(id=generate_id())
    root_id, sender, member = generate_id(), generate_id(), generate_id()
    publish = AsyncMock()
    with patch("uniffy.domains.chat.messages.notifications.publish_user_chat_events", publish):
        await MessageNotifications()._publish_unread_notifications(
            channel, sender, [sender, member], {member}, message_id=root_id
        )
    assert publish.await_args.args[0] == [
        (
            member,
            events.UNREAD_COUNT_CHANGED,
            {
                "channel_id": str(channel.id),
                "unread_count": 1,
                "message_id": str(root_id),
                "mention_count": 1,
            },
        )
    ]


async def test_thread_reply_delta_carries_no_anchor() -> None:
    channel = SimpleNamespace(id=generate_id())
    sender, member = generate_id(), generate_id()
    publish = AsyncMock()
    with patch("uniffy.domains.chat.messages.notifications.publish_user_chat_events", publish):
        await MessageNotifications()._publish_unread_notifications(channel, sender, [member])
    (_, _, payload), = publish.await_args.args[0]
    assert "message_id" not in payload


def test_cache_refresh_backlog_uses_the_partial_index_predicate() -> None:
    sql = str(pending_cache_refresh().compile(dialect=postgresql.dialect()))
    # The index was declared on the bare boolean; `IS true` never matches it.
    assert "WHERE chat_read_cursors.needs_cache_refresh ORDER BY" in sql
    assert "IS true" not in sql
