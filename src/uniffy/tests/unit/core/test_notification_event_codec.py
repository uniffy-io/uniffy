"""Notification events keep the agent that acted for a person across the queue."""

from uniffy.core.events.bus import _event_to_json, event_from_json
from uniffy.core.events.types import NotificationEvent
from uniffy.core.types import NotificationType, generate_id


def _event(**kwargs) -> NotificationEvent:
    return NotificationEvent(
        notification_type=NotificationType.TASK_ASSIGNED,
        organization_id=generate_id(),
        actor_id=generate_id(),
        title="t",
        **kwargs,
    )


def test_the_acting_agent_survives_the_queue() -> None:
    agent_id = generate_id()
    event = _event(acting_agent_id=agent_id)
    assert event_from_json(_event_to_json(event)).acting_agent_id == agent_id


def test_events_built_outside_an_agent_carry_none() -> None:
    event = _event()
    assert event.acting_agent_id is None
    assert event_from_json(_event_to_json(event)).acting_agent_id is None
