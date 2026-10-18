"""Calendar operations."""

from datetime import date
from uuid import UUID

from loguru import logger
from sqlalchemy import select

from uniffy.core.content.team_mentions import expand_team_mentions
from uniffy.core.converters.common_proto import CONTENT_TYPE_TO_PROTO
from uniffy.core.events import (
    NotificationEvent,
    emit_notification,
    extract_mentioned_team_ids,
    extract_mentioned_user_ids,
)
from uniffy.core.events.realtime import (
    ContentAccessAction,
    publish_content_access_changed,
    publish_content_changed,
)
from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import (
    ContentType,
    NotificationType,
)

logger = logger.bind(component="scheduling.calendar.events.notifications")


async def publish_event_change(event: CalendarEvent, *, access_changed: bool = False) -> None:
    try:
        if access_changed:
            # Former readers must receive invalidation even when access is already gone.
            await publish_content_access_changed(
                content_type=CONTENT_TYPE_TO_PROTO[ContentType.CALENDAR_EVENT],
                content_id=event.id,
                action=ContentAccessAction.ACCESS_MODE_CHANGED,
                organization_id=event.organization_id,
            )
        else:
            await publish_content_changed(
                ContentType.CALENDAR_EVENT, event.id, event.organization_id
            )
    except Exception:
        logger.opt(exception=True).warning("Calendar event refresh failed", event_id=str(event.id))


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

    async def emit_mention_notifications(
        self,
        event: CalendarEvent,
        actor_id: UUID,
        organization_id: UUID,
        old_references: list[str] | None,
        excluded_ids: set[UUID],
    ) -> None:
        """Notify users and teams the description newly mentions; the worker gates each recipient."""
        newly_mentioned = (
            extract_mentioned_user_ids(event.outgoing_references)
            - extract_mentioned_user_ids(old_references)
            - excluded_ids
        )
        if newly_mentioned:
            await emit_notification(
                NotificationEvent(
                    notification_type=NotificationType.CONTENT_MENTIONED,
                    organization_id=organization_id,
                    actor_id=actor_id,
                    title=f"Mentioned you in: {event.title}",
                    source_urn=build_content_urn(ContentType.CALENDAR_EVENT, event.id),
                    target_user_ids=list(newly_mentioned),
                )
            )
        old_teams = set(extract_mentioned_team_ids(old_references))
        await self._emit_team_mention_notifications(
            event,
            actor_id,
            organization_id,
            [
                team_id
                for team_id in extract_mentioned_team_ids(event.outgoing_references)
                if team_id not in old_teams
            ],
            excluded_ids | newly_mentioned,
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
