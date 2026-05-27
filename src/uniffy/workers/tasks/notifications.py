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
from uniffy.domains.notifications.delivery import DELIVERY_ADAPTERS
from uniffy.domains.notifications.delivery.in_app import InAppAdapter
from uniffy.domains.notifications.delivery.push import PushAdapter
from uniffy.observability.metrics import NOTIFICATION_DELIVERIES_TOTAL, NOTIFICATION_EVENTS_TOTAL


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

        in_app_adapter = DELIVERY_ADAPTERS.get("in_app")
        pending_notifications: list[Notification] = []

        for user_id in recipient_ids:
            channels = await _get_delivery_channels(session, user_id, event.notification_type)

            if "in_app" in channels and isinstance(in_app_adapter, InAppAdapter):
                notification = await in_app_adapter.deliver_with_session(session, user_id, event)
                pending_notifications.append(notification)
                NOTIFICATION_DELIVERIES_TOTAL.labels(channel="in_app").inc()

            if "browser" in channels:
                push_adapter = DELIVERY_ADAPTERS.get("browser")
                if isinstance(push_adapter, PushAdapter):
                    await push_adapter.deliver_with_session(session, user_id, push_event)
                elif push_adapter:
                    await push_adapter.deliver(user_id, push_event)
                NOTIFICATION_DELIVERIES_TOTAL.labels(channel="browser").inc()

            if "email" in channels:
                email_adapter = DELIVERY_ADAPTERS.get("email")
                if email_adapter:
                    await email_adapter.deliver(user_id, event)
                NOTIFICATION_DELIVERIES_TOTAL.labels(channel="email").inc()

        if pending_notifications:
            await session.commit()

        if isinstance(in_app_adapter, InAppAdapter):
            for notification in pending_notifications:
                await in_app_adapter.publish_realtime(notification, actor_name=actor_name)

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
    push_adapter = DELIVERY_ADAPTERS.get("browser")
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


async def send_email_digest(ctx: dict[str, Any]) -> dict[str, Any]:
    """Aggregate unread notifications and send per-user email digests."""
    logger.debug("Email digest cron triggered (not yet implemented)")
    return {"status": "deferred", "reason": "digest_not_configured"}


async def _resolve_recipients(
    session: AsyncSession,
    event: NotificationEvent,
) -> list[UUID]:
    """Resolve recipient user IDs for `event`, always excluding the actor."""
    if event.target_user_ids is not None:
        return [uid for uid in event.target_user_ids if uid != event.actor_id]

    recipients: list[UUID] = []

    if event.notification_type == NotificationType.SYSTEM_ANNOUNCEMENT:
        from uniffy.core.models.login.organization_member import OrganizationMember

        result = await session.execute(
            select(OrganizationMember.user_id).where(
                OrganizationMember.organization_id == event.organization_id
            )
        )
        recipients = [row[0] for row in result.all()]

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

    return [uid for uid in recipients if uid != event.actor_id]


async def _get_delivery_channels(
    session: AsyncSession,
    user_id: UUID,
    notification_type: NotificationType,
) -> set[str]:
    """Return the enabled delivery channels for `user_id` + `notification_type`.

    Reads `settings_profile.notifications` via the Valkey settings cache (15-min TTL).
    """
    from uniffy.core.valkey.cache import CACHE_MISS
    from uniffy.domains.notifications.cache import get_cached_settings, set_cached_settings
    from uniffy.domains.settings.defaults import get_effective_notification_channels

    cached = await get_cached_settings(user_id)

    if cached is not CACHE_MISS:
        overrides = cached
    else:
        from uniffy.core.models.settings.settings_profile import SettingsProfile

        result = await session.execute(
            select(SettingsProfile).where(
                SettingsProfile.user_id == user_id,
                SettingsProfile.is_default == True,  # noqa: E712
            )
        )
        profile = result.scalars().first()
        overrides = profile.notifications if profile else None
        await set_cached_settings(user_id, overrides)

    channels = get_effective_notification_channels(notification_type.value, overrides)

    return {ch for ch, enabled in channels.items() if enabled}
