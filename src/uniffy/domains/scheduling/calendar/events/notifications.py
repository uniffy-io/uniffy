"""Calendar operations."""

from datetime import date
from uuid import UUID

from loguru import logger
from sqlalchemy import select

from uniffy.core.content.team_mentions import expand_team_mentions
from uniffy.core.events import (
    NotificationEvent,
    emit_notification,
)
from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import (
    ContentType,
    NotificationType,
)

logger = logger.bind(component="scheduling.calendar.events.notifications")


class EventNotifications:
    def __init__(self, events: object) -> None:
        self.events = events
        self.session = events.session

    async def _emit_cancellation_notification(
        self,
        event: CalendarEvent,
        actor_id: UUID,
        organization_id: UUID,
        occurrence_date: date | None = None,
    ) -> None:
        """Tell every attendee except the actor that the event was called off."""
        result = await self.session.execute(
            select(EventAttendee.user_id).where(EventAttendee.event_id == event.id)
        )
        recipients = [uid for uid in result.scalars().all() if uid != actor_id]
        if not recipients:
            return
        suffix = f" ({occurrence_date.isoformat()})" if occurrence_date else ""
        await emit_notification(
            NotificationEvent(
                notification_type=NotificationType.CALENDAR_CANCELLED,
                organization_id=organization_id,
                actor_id=actor_id,
                title=f"Cancelled: {event.title}{suffix}",
                source_urn=build_content_urn(ContentType.CALENDAR_EVENT, event.id),
                target_user_ids=recipients,
            )
        )

    async def _emit_team_mention_notifications(
        self,
        event: CalendarEvent,
        actor_id: UUID,
        organization_id: UUID,
        team_ids: list[UUID],
        excluded_ids: set[UUID],
    ) -> None:
        """One CONTENT_MENTIONED per newly mentioned team; the notification
        worker filters each recipient against the event itself."""
        if not team_ids:
            return
        notified = set(excluded_ids)
        expansions = await expand_team_mentions(self.session, organization_id, team_ids)
        for expansion in expansions:
            targets = [uid for uid in expansion.member_ids if uid not in notified]
            if not targets:
                continue
            await emit_notification(
                NotificationEvent(
                    notification_type=NotificationType.CONTENT_MENTIONED,
                    organization_id=organization_id,
                    actor_id=actor_id,
                    title=f"Mentioned {expansion.name} in: {event.title}",
                    source_urn=build_content_urn(ContentType.CALENDAR_EVENT, event.id),
                    target_user_ids=targets,
                    metadata={
                        "team_id": str(expansion.team_id),
                        "team_name": expansion.name,
                    },
                )
            )
            notified.update(targets)
