from uniffy.core.types import generate_id
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


