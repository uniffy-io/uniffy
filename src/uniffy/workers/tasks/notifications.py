"""Notification fan-out: resolve recipients, filter on prefs, deliver per channel."""

from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.events.bus import event_from_json
from uniffy.core.events.types import NotificationEvent
from uniffy.core.models.login.user import User
from uniffy.core.models.notifications.notification import Notification
from uniffy.core.models.shared import NotificationType
from uniffy.core.types import ContentType
from uniffy.db import open_session
from uniffy.domains.notifications.delivery import DELIVERY_ADAPTERS, NotificationChannel
from uniffy.domains.notifications.delivery.email import EmailAdapter, StagedEmailDelivery
from uniffy.domains.notifications.delivery.in_app import InAppAdapter
from uniffy.domains.notifications.delivery.push import PushAdapter
from uniffy.domains.notifications.delivery.suppression import (
    InterruptiveDeliveryContext,
    load_interruptive_delivery_contexts,
)
from uniffy.domains.notifications.preferences import get_delivery_preferences_bulk
from uniffy.domains.permissions.resource_access import ResourceAudienceResolver, ResourceKey
from uniffy.observability.metrics import (
    NOTIFICATION_DELIVERIES_TOTAL,
    NOTIFICATION_EVENTS_TOTAL,
    NOTIFICATION_RECIPIENTS_DROPPED_TOTAL,
)

logger = logger.bind(component="tasks.notifications")


async def process_notification_event(
    ctx: dict[str, Any],
    event_json: str,
) -> dict[str, Any]:
    """Resolve recipients for a `NotificationEvent` and fan it out to delivery channels."""
    try:
        event = event_from_json(event_json)
    except Exception as e:
        logger.error(f"Failed to deserialize notification event: {e}")
        NOTIFICATION_EVENTS_TOTAL.labels(status="error").inc()
        return {"status": "error", "reason": "invalid_event"}

    async with open_session() as session:
        recipient_ids = await _resolve_recipients(session, event)

        if not recipient_ids:
            logger.debug(f"No recipients for notification type={event.notification_type}")
            NOTIFICATION_EVENTS_TOTAL.labels(status="skipped").inc()
            return {"status": "skipped", "reason": "no_recipients"}

        actor_name = ""
        if event.actor_id:
            result = await session.execute(
                select(User.full_name, User.username).where(User.id == event.actor_id)
            )
            row = result.first()
            if row:
                actor_name = row[0] or row[1]

        # Browser push has no separate actor field, so prefix it onto the title.
        if actor_name and event.title:
            push_title = f"{actor_name} {event.title[0].lower()}{event.title[1:]}"
        else:
            push_title = event.title

        push_event = NotificationEvent(
            notification_type=event.notification_type,
            organization_id=event.organization_id,
            actor_id=event.actor_id,
            title=push_title,
            body=event.body,
            source_urn=event.source_urn,
            target_user_ids=event.target_user_ids,
            content_type=event.content_type,
            content_id=event.content_id,
            metadata=event.metadata,
        )

        in_app_adapter = DELIVERY_ADAPTERS.get(NotificationChannel.IN_APP)
        email_adapter = DELIVERY_ADAPTERS.get(NotificationChannel.EMAIL)
        pending_notifications: list[Notification] = []
        pending_email_deliveries: list[StagedEmailDelivery] = []
        suppression_contexts: dict[UUID, InterruptiveDeliveryContext] | None = None

        delivery_preferences = await get_delivery_preferences_bulk(
            session,
            recipient_ids,
            event.notification_type,
        )
        has_browser_delivery = any(
            NotificationChannel.BROWSER in channels
            for channels, _overrides in delivery_preferences.values()
        )
        if has_browser_delivery or any(
            NotificationChannel.EMAIL in channels
            for channels, _overrides in delivery_preferences.values()
        ):
            suppression_contexts = await load_interruptive_delivery_contexts(
                session,
                event.organization_id,
                recipient_ids,
                include_presence=has_browser_delivery,
            )

        for user_id in recipient_ids:
            channels, notification_overrides = delivery_preferences[user_id]

            if NotificationChannel.IN_APP in channels and isinstance(in_app_adapter, InAppAdapter):
                notification = await in_app_adapter.deliver_with_session(session, user_id, event)
                pending_notifications.append(notification)
                NOTIFICATION_DELIVERIES_TOTAL.labels(channel="in_app").inc()

            if NotificationChannel.BROWSER in channels:
                push_adapter = DELIVERY_ADAPTERS.get(NotificationChannel.BROWSER)
                if isinstance(push_adapter, PushAdapter):
                    await push_adapter.deliver_with_session(
                        session,
                        user_id,
                        push_event,
                        notification_overrides=notification_overrides,
                        suppression_context=(suppression_contexts or {})[user_id],
                    )
                elif push_adapter:
                    await push_adapter.deliver(user_id, push_event)
                NOTIFICATION_DELIVERIES_TOTAL.labels(channel="browser").inc()

            if NotificationChannel.EMAIL in channels:
                if isinstance(email_adapter, EmailAdapter):
                    staged = await email_adapter.stage_with_session(
                        session,
                        user_id,
                        event,
                        notification_overrides,
                        timezone=(suppression_contexts or {})[user_id].timezone,
                    )
                    if staged is not None:
                        pending_email_deliveries.append(staged)
                        NOTIFICATION_DELIVERIES_TOTAL.labels(channel="email").inc()

        if pending_notifications or pending_email_deliveries:
            await session.commit()

        if isinstance(in_app_adapter, InAppAdapter):
            for notification in pending_notifications:
                await in_app_adapter.publish_realtime(notification, actor_name=actor_name)

        if isinstance(email_adapter, EmailAdapter):
            for delivery in pending_email_deliveries:
                await email_adapter.enqueue_if_due(delivery)

        NOTIFICATION_EVENTS_TOTAL.labels(status="success").inc()
        logger.info(
            f"Processed notification: type={event.notification_type}, "
            f"recipients={len(recipient_ids)}, "
            f"in_app={len(pending_notifications)}"
        )
        return {
            "status": "success",
            "recipients": len(recipient_ids),
            "in_app": len(pending_notifications),
        }


async def deliver_push_notification(
    ctx: dict[str, Any],
    user_id: str,
    title: str,
    body: str,
    source_urn: str | None = None,
) -> dict[str, Any]:
    """Standalone retryable push delivery to one user's registered subscriptions."""
    push_adapter = DELIVERY_ADAPTERS.get(NotificationChannel.BROWSER)
    if not push_adapter:
        return {"status": "skipped", "reason": "no_push_adapter"}

    uid = UUID(user_id)
    event = NotificationEvent(
        notification_type=NotificationType.SYSTEM_ANNOUNCEMENT,
        organization_id=UUID("00000000-0000-0000-0000-000000000000"),
        actor_id=uid,
        title=title,
        body=body,
        source_urn=source_urn,
    )

    if isinstance(push_adapter, PushAdapter):
        async with open_session() as session:
            ok = await push_adapter.deliver_with_session(session, uid, event)
            await session.commit()
            return {"status": "success" if ok else "skipped"}

    ok = await push_adapter.deliver(uid, event)
    return {"status": "success" if ok else "skipped"}


def _content_target(event: NotificationEvent) -> tuple[ContentType, UUID] | None:
    if event.content_type and event.content_id:
        return event.content_type, event.content_id
    if event.source_urn:
        from uniffy.core.content.references import parse_urn

        return parse_urn(event.source_urn)
    return None


async def _filter_to_viewers(
    session: AsyncSession,
    event: NotificationEvent,
    recipient_ids: list[UUID],
) -> list[UUID]:
    """Prevent notification copy from disclosing content after access is revoked."""
    if not recipient_ids or event.organization_id is None:
        return recipient_ids

    target = _content_target(event)
    if target is None:
        active = await ResourceAudienceResolver(session).active_roles(
            event.organization_id,
            recipient_ids,
        )
        return [user_id for user_id in recipient_ids if user_id in active]

    key = ResourceKey(*target)
    allowed = await ResourceAudienceResolver(session).filter_resource(
        organization_id=event.organization_id,
        key=key,
        candidate_user_ids=recipient_ids,
    )
    dropped = len(recipient_ids) - len(allowed)
    if dropped:
        NOTIFICATION_RECIPIENTS_DROPPED_TOTAL.inc(dropped)
        logger.info(
            f"Dropped {dropped} notification recipient(s) without view access "
            f"on {key.content_type.value}:{key.content_id}"
        )
    return allowed


async def _resolve_recipients(
    session: AsyncSession,
    event: NotificationEvent,
) -> list[UUID]:
    """Resolve recipient user IDs for `event`, always excluding the actor."""
    if event.target_user_ids is not None:
        explicit = [uid for uid in event.target_user_ids if uid != event.actor_id]
        return await _filter_to_viewers(session, event, explicit)

    recipients: list[UUID] = []

    if event.notification_type == NotificationType.SYSTEM_ANNOUNCEMENT:
        from uniffy.core.models.login.organization import Organization
        from uniffy.core.models.login.organization_member import OrganizationMember
        from uniffy.core.models.login.user import User

        result = await session.execute(
            select(OrganizationMember.user_id)
            .join(User, User.id == OrganizationMember.user_id)
            .join(Organization, Organization.id == OrganizationMember.organization_id)
            .where(
                OrganizationMember.organization_id == event.organization_id,
                OrganizationMember.is_active.is_(True),
                User.is_active.is_(True),
                Organization.deleted_at.is_(None),
                Organization.is_suspended.is_(False),
            )
        )
        return [row[0] for row in result.all() if row[0] != event.actor_id]

    elif event.content_type and event.content_id:
        # Content-based: owner + bookmarkers.
        from uniffy.core.models.bookmarks.bookmark import Bookmark

        recipient_set: set[UUID] = set()

        if event.content_type == ContentType.NOTE:
            from uniffy.core.models.notes.note import Note

            owner_result = await session.execute(
                select(Note.owner_id).where(Note.id == event.content_id)
            )
            owner_id = owner_result.scalar_one_or_none()
            if owner_id:
                recipient_set.add(owner_id)
        elif event.content_type == ContentType.CALENDAR_EVENT:
            from uniffy.core.models.calendar.event import CalendarEvent

            org_result = await session.execute(
                select(CalendarEvent.organizer_id).where(CalendarEvent.id == event.content_id)
            )
            organizer_id = org_result.scalar_one_or_none()
            if organizer_id:
                recipient_set.add(organizer_id)

        content_urn = event.source_urn
        if content_urn:
            result = await session.execute(
                select(Bookmark.user_id).where(Bookmark.urn == content_urn)
            )
            for row in result.all():
                recipient_set.add(row[0])

        recipients = list(recipient_set)

    resolved = [uid for uid in recipients if uid != event.actor_id]
    return await _filter_to_viewers(session, event, resolved)
