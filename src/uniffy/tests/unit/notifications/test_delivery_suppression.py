"""Quiet-hours and DND behavior for interruptive notification delivery."""

from contextlib import asynccontextmanager
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from uniffy.core.events.types import NotificationEvent
from uniffy.core.types import NotificationType, generate_id
from uniffy.core.valkey.presence import PRESENCE_STATUS_DND
from uniffy.domains.notifications.delivery.push import PushAdapter
from uniffy.domains.notifications.delivery.suppression import (
    InterruptiveDeliveryContext,
    load_interruptive_delivery_contexts,
    should_suppress_interruptive_delivery,
)
from uniffy.domains.notifications.delivery.base import NotificationChannel
from uniffy.domains.notifications.delivery.in_app import InAppAdapter
from uniffy.workers.tasks import notifications as notification_tasks


def _quiet_hours(start: str = "22:00", end: str = "08:00") -> dict[str, str]:
    return {"quiet_hours_start": start, "quiet_hours_end": end}


def test_dnd_suppresses_without_quiet_hours() -> None:
    assert should_suppress_interruptive_delivery(
        None,
        InterruptiveDeliveryContext(presence_status=PRESENCE_STATUS_DND),
    )


def test_overnight_quiet_hours_cover_both_sides_of_midnight() -> None:
    context = InterruptiveDeliveryContext(timezone="UTC")

    assert should_suppress_interruptive_delivery(
        _quiet_hours(),
        context,
        at=datetime(2026, 8, 21, 23, 0, tzinfo=UTC),
    )
    assert should_suppress_interruptive_delivery(
        _quiet_hours(),
        context,
        at=datetime(2026, 8, 22, 7, 59, tzinfo=UTC),
    )
    assert not should_suppress_interruptive_delivery(
        _quiet_hours(),
        context,
        at=datetime(2026, 8, 22, 8, 0, tzinfo=UTC),
    )
    assert not should_suppress_interruptive_delivery(
        _quiet_hours(),
        context,
        at=datetime(2026, 8, 22, 12, 0, tzinfo=UTC),
    )


def test_same_day_quiet_hours_use_start_inclusive_end_exclusive() -> None:
    context = InterruptiveDeliveryContext(timezone="UTC")
    settings = _quiet_hours("09:00", "17:00")

    assert should_suppress_interruptive_delivery(
        settings,
        context,
        at=datetime(2026, 8, 21, 9, 0, tzinfo=UTC),
    )
    assert not should_suppress_interruptive_delivery(
        settings,
        context,
        at=datetime(2026, 8, 21, 17, 0, tzinfo=UTC),
    )


def test_quiet_hours_use_the_org_scoped_people_timezone() -> None:
    assert should_suppress_interruptive_delivery(
        _quiet_hours(),
        InterruptiveDeliveryContext(timezone="Europe/Sofia"),
        at=datetime(2026, 8, 21, 20, 30, tzinfo=UTC),
    )


def test_missing_or_malformed_quiet_hours_fail_open() -> None:
    context = InterruptiveDeliveryContext(timezone="UTC")
    instant = datetime(2026, 8, 21, 23, 0, tzinfo=UTC)

    assert not should_suppress_interruptive_delivery(None, context, at=instant)
    assert not should_suppress_interruptive_delivery(
        {"quiet_hours_start": "22:00"},
        context,
        at=instant,
    )
    assert not should_suppress_interruptive_delivery(
        _quiet_hours("not-a-time", "08:00"),
        context,
        at=instant,
    )


async def test_context_loader_batches_presence_and_scopes_timezones_to_the_org() -> None:
    organization_id = generate_id()
    user_ids = [generate_id() for _ in range(201)]
    session = AsyncMock()
    session.execute.return_value = MagicMock(
        all=MagicMock(
            return_value=[SimpleNamespace(user_id=user_ids[0], timezone="Pacific/Auckland")]
        )
    )

    async def presence_side_effect(_organization_id, chunk):
        return {
            str(user_id): {"status": PRESENCE_STATUS_DND}
            for user_id in chunk
            if user_id == user_ids[-1]
        }

    with patch(
        "uniffy.domains.notifications.delivery.suppression.presence_get_bulk",
        new=AsyncMock(side_effect=presence_side_effect),
    ) as presence_get:
        contexts = await load_interruptive_delivery_contexts(
            session,
            organization_id,
            user_ids,
        )

    assert len(contexts) == 201
    assert contexts[user_ids[0]].timezone == "Pacific/Auckland"
    assert contexts[user_ids[-1]].presence_status == PRESENCE_STATUS_DND
    assert [len(call.args[1]) for call in presence_get.await_args_list] == [200, 1]


async def test_push_adapter_stops_before_subscription_lookup_when_suppressed() -> None:
    session = AsyncMock()
    user_id = generate_id()
    event = NotificationEvent(
        notification_type=NotificationType.CHAT_MENTION,
        organization_id=generate_id(),
        actor_id=generate_id(),
        title="Mentioned you",
    )

    delivered = await PushAdapter().deliver_with_session(
        session,
        user_id,
        event,
        suppression_context=InterruptiveDeliveryContext(presence_status=PRESENCE_STATUS_DND),
    )

    assert delivered is False
    session.execute.assert_not_awaited()


async def test_worker_keeps_in_app_delivery_when_push_context_is_suppressed() -> None:
    user_id = generate_id()
    event = NotificationEvent(
        notification_type=NotificationType.CHAT_MENTION,
        organization_id=generate_id(),
        actor_id=generate_id(),
        title="Mentioned you",
    )
    session = AsyncMock()
    session.execute.return_value = MagicMock(first=MagicMock(return_value=None))
    notification = MagicMock()
    in_app = MagicMock(spec=InAppAdapter)
    in_app.deliver_with_session = AsyncMock(return_value=notification)
    in_app.publish_realtime = AsyncMock()
    push = MagicMock(spec=PushAdapter)
    push.deliver_with_session = AsyncMock(return_value=False)
    context = InterruptiveDeliveryContext(presence_status=PRESENCE_STATUS_DND)

    @asynccontextmanager
    async def open_session():
        yield session

    with (
        patch.object(notification_tasks, "open_session", new=open_session),
        patch.object(notification_tasks, "event_from_json", return_value=event),
        patch.object(
            notification_tasks,
            "_resolve_recipients",
            new=AsyncMock(return_value=[user_id]),
        ),
        patch.object(
            notification_tasks,
            "_get_delivery_preferences",
            new=AsyncMock(
                return_value=(
                    {NotificationChannel.IN_APP, NotificationChannel.BROWSER},
                    {"quiet_hours_start": "22:00", "quiet_hours_end": "08:00"},
                )
            ),
        ),
        patch.object(
            notification_tasks,
            "load_interruptive_delivery_contexts",
            new=AsyncMock(return_value={user_id: context}),
        ),
        patch.dict(
            notification_tasks.DELIVERY_ADAPTERS,
            {
                NotificationChannel.IN_APP: in_app,
                NotificationChannel.BROWSER: push,
            },
            clear=True,
        ),
    ):
        result = await notification_tasks.process_notification_event({}, "event")

    assert result == {"status": "success", "recipients": 1, "in_app": 1}
    in_app.deliver_with_session.assert_awaited_once_with(session, user_id, event)
    in_app.publish_realtime.assert_awaited_once_with(notification, actor_name="")
    push.deliver_with_session.assert_awaited_once()
    assert push.deliver_with_session.await_args.kwargs["suppression_context"] == context
    session.commit.assert_awaited_once()
