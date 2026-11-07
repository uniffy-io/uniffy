"""Notices about connected accounts, staged with the row change that causes them."""

from uuid import UUID

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.events import NotificationEvent, emit_notification
from uniffy.core.events.bus import stage_notification_events
from uniffy.core.jobs import enqueue_job_reconnecting
from uniffy.core.models.calendar.connection import CalendarConnection, CalendarProvider
from uniffy.core.types import NotificationType
from uniffy.domains.notifications.jobs.contracts import (
    DELIVER_NOTIFICATION_OUTBOX,
    notification_outbox_job_id,
)

logger = logger.bind(component="scheduling.calendar.connections.notices")

PROVIDER_LABELS = {
    CalendarProvider.GOOGLE: "Google Calendar",
    CalendarProvider.MICROSOFT: "Outlook",
}


async def stage_reconnect_notice(
    session: AsyncSession, connection: CalendarConnection
) -> list[UUID]:
    """Stage the one notice per break; the caller commits it with the status change."""
    label = PROVIDER_LABELS[connection.provider]
    with stage_notification_events(session) as staged:
        await emit_notification(
            NotificationEvent(
                notification_type=NotificationType.CALENDAR_CONNECTION_NEEDS_RECONNECT,
                organization_id=connection.organization_id,
                actor_id=None,
                title=f"Reconnect {label}",
                body=(
                    f"Uniffy stopped syncing {connection.account_email}. "
                    "Connect the account again to resume."
                ),
                target_user_ids=[connection.owner_id],
                metadata={
                    "connection_id": str(connection.id),
                    "provider": connection.provider.value,
                },
            )
        )
    return list(staged)


async def stage_conflict_notice(
    session: AsyncSession,
    *,
    organization_id: UUID,
    user_id: UUID,
    event_id: UUID,
    event_title: str,
    provider: CalendarProvider,
    source_urn: str,
) -> list[UUID]:
    label = PROVIDER_LABELS[provider]
    with stage_notification_events(session) as staged:
        await emit_notification(
            NotificationEvent(
                notification_type=NotificationType.CALENDAR_SYNC_CONFLICT,
                organization_id=organization_id,
                actor_id=None,
                title=f"{event_title} was changed in {label}",
                body=(
                    f"Your change was replaced by a newer edit in {label}. "
                    "It is kept in the event's activity."
                ),
                source_urn=source_urn,
                target_user_ids=[user_id],
                metadata={"event_id": str(event_id), "provider": provider.value},
            )
        )
    return list(staged)


async def wake_outbox(event_ids: list[UUID]) -> None:
    for event_id in event_ids:
        try:
            await enqueue_job_reconnecting(
                DELIVER_NOTIFICATION_OUTBOX,
                str(event_id),
                _job_id=notification_outbox_job_id(event_id),
            )
        except Exception:
            logger.warning(
                "Notification wakeup deferred to the outbox sweep", event_id=str(event_id)
            )
