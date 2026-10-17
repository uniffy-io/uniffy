"""Notification events support transactional staging or best-effort queue delivery."""

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import cast, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.events.job_contracts import PROCESS_NOTIFICATION_EVENT
from uniffy.core.events.types import NotificationEvent
from uniffy.core.jobs import enqueue_job
from uniffy.core.json_codec import dumps_str, loads
from uniffy.core.models.notifications.notification import Notification
from uniffy.core.models.notifications.outbox import NotificationOutbox
from uniffy.core.types import ContentType, NotificationType, generate_id

logger = logger.bind(component="events.bus")
_staging_session: ContextVar[AsyncSession | None] = ContextVar("notification_staging", default=None)


@contextmanager
def stage_notification_events(session: AsyncSession) -> Iterator[None]:
    """Preserve original recipient deltas in the content owner's transaction."""
    token = _staging_session.set(session)
    try:
        yield
    finally:
        _staging_session.reset(token)


def _event_to_json(event: NotificationEvent) -> str:
    data: dict[str, Any] = {
        "event_id": str(event.event_id),
        "notification_type": event.notification_type.value,
        "organization_id": str(event.organization_id),
        "title": event.title,
        "body": event.body,
    }

    if event.actor_id is not None:
        data["actor_id"] = str(event.actor_id)
    if event.source_urn is not None:
        data["source_urn"] = event.source_urn
    if event.target_user_ids is not None:
        data["target_user_ids"] = [str(uid) for uid in event.target_user_ids]
    if event.content_type is not None:
        data["content_type"] = event.content_type.value
    if event.content_id is not None:
        data["content_id"] = str(event.content_id)
    if event.metadata is not None:
        data["metadata"] = event.metadata

    return dumps_str(data)


def event_from_json(json_str: str) -> NotificationEvent:
    data = loads(json_str)

    target_user_ids = None
    if "target_user_ids" in data:  # noqa: PLR2004
        target_user_ids = [UUID(uid) for uid in data["target_user_ids"]]

    content_type = None
    if "content_type" in data:  # noqa: PLR2004
        content_type = ContentType(data["content_type"])

    content_id = None
    if "content_id" in data:  # noqa: PLR2004
        content_id = UUID(data["content_id"])

    return NotificationEvent(
        event_id=UUID(data["event_id"]) if data.get("event_id") else generate_id(),
        notification_type=NotificationType(data["notification_type"]),
        organization_id=UUID(data["organization_id"]),
        actor_id=UUID(data["actor_id"]) if data.get("actor_id") else None,
        title=data["title"],
        body=data.get("body", ""),
        source_urn=data.get("source_urn"),
        target_user_ids=target_user_ids,
        content_type=content_type,
        content_id=content_id,
        metadata=data.get("metadata"),
    )


async def emit_notification(event: NotificationEvent) -> None:
    """Stage within an owner transaction, otherwise enqueue without raising on queue failure."""
    staging = _staging_session.get()
    if staging is not None:
        if event.notification_type == NotificationType.CONTENT_EDITED:
            cutoff = datetime.now(UTC) - timedelta(minutes=10)
            recent = await staging.scalar(
                select(Notification.id)
                .where(
                    Notification.organization_id == event.organization_id,
                    Notification.source_urn == event.source_urn,
                    Notification.actor_id == event.actor_id,
                    Notification.notification_type == NotificationType.CONTENT_EDITED,
                    Notification.created_at >= cutoff,
                )
                .limit(1)
            )
            payload = cast(NotificationOutbox.payload, JSONB)
            pending = await staging.scalar(
                select(NotificationOutbox.event_id)
                .where(
                    NotificationOutbox.organization_id == event.organization_id,
                    NotificationOutbox.attempted_at >= cutoff,
                    payload["notification_type"].astext == NotificationType.CONTENT_EDITED.value,
                    payload["source_urn"].astext == event.source_urn,
                    payload["actor_id"].astext == str(event.actor_id),
                )
                .limit(1)
            )
            if recent is not None or pending is not None:
                return
        staging.add(
            NotificationOutbox(
                event_id=event.event_id,
                organization_id=event.organization_id,
                payload=_event_to_json(event),
            )
        )
        return
    try:
        event_json = _event_to_json(event)
        await enqueue_job(PROCESS_NOTIFICATION_EVENT, event_json)
    except RuntimeError:
        logger.warning("Notification queue unavailable, skipping event")
    except Exception:
        logger.opt(exception=True).warning("Failed to enqueue notification event")
