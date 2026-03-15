"""Notification background tasks for ARQ worker.

Handles notification event processing, recipient resolution,
preference filtering, and multi-channel delivery via adapters.
"""

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
from uniffy.db import get_async_session
from uniffy.domains.notifications.delivery import DELIVERY_ADAPTERS
from uniffy.domains.notifications.delivery.in_app import InAppAdapter
from uniffy.domains.notifications.delivery.push import PushAdapter
from uniffy.observability.metrics import NOTIFICATION_DELIVERIES_TOTAL, NOTIFICATION_EVENTS_TOTAL


async def process_notification_event(
    ctx: dict[str, Any],
    event_json: str,
) -> dict[str, Any]:
    """
    Process a notification event: resolve recipients, check preferences,
    create notification records, and fan out to delivery channels.

    For each recipient the worker:
    1. Resolves which channels are enabled (user prefs + master switches)
    2. Delegates to each enabled DeliveryAdapter
    3. Batch-commits DB changes and publishes real-time events

    Parameters
    ----------
    ctx : dict
        ARQ context dictionary.
    event_json : str
        JSON-serialized NotificationEvent.

    Returns
    -------
    dict
        Processing result with status and recipient count.

    """
    try:
        event = event_from_json(event_json)
    except Exception as e:
        logger.error(f"Failed to deserialize notification event: {e}")
        NOTIFICATION_EVENTS_TOTAL.labels(status="error").inc()
        return {"status": "error", "reason": "invalid_event"}

    async for session in get_async_session():
        # Resolve recipients
        recipient_ids = await _resolve_recipients(session, event)

        if not recipient_ids:
            logger.debug(f"No recipients for notification type={event.notification_type}")
            NOTIFICATION_EVENTS_TOTAL.labels(status="skipped").inc()
            return {"status": "skipped", "reason": "no_recipients"}

        in_app_adapter = DELIVERY_ADAPTERS.get("in_app")
        pending_notifications: list[Notification] = []

        for user_id in recipient_ids:
            channels = await _get_delivery_channels(session, user_id, event.notification_type)

            # In-app: persist to DB (returns Notification, ID set after commit)
            if "in_app" in channels and isinstance(in_app_adapter, InAppAdapter):
                notification = await in_app_adapter.deliver_with_session(session, user_id, event)
                pending_notifications.append(notification)
                NOTIFICATION_DELIVERIES_TOTAL.labels(channel="in_app").inc()

            # Browser push: delegate to adapter
            if "browser" in channels:
                push_adapter = DELIVERY_ADAPTERS.get("browser")
                if isinstance(push_adapter, PushAdapter):
                    await push_adapter.deliver_with_session(session, user_id, event)
                elif push_adapter:
                    await push_adapter.deliver(user_id, event)
                NOTIFICATION_DELIVERIES_TOTAL.labels(channel="browser").inc()

            # Email: delegate to adapter
            if "email" in channels:
                email_adapter = DELIVERY_ADAPTERS.get("email")
                if email_adapter:
                    await email_adapter.deliver(user_id, event)
                NOTIFICATION_DELIVERIES_TOTAL.labels(channel="email").inc()

        if pending_notifications:
            await session.commit()

        actor_name = ""
        if event.actor_id:
            result = await session.execute(
                select(User.full_name, User.username).where(User.id == event.actor_id)
            )
            row = result.first()
            if row:
                actor_name = row[0] or row[1]

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
    """
    Deliver a push notification to a user's registered browsers/devices.

    Standalone ARQ job for retryable push delivery (enqueued by the
    main process_notification_event when push channel is enabled).

    Parameters
    ----------
    ctx : dict
        ARQ context dictionary.
    user_id : str
        Recipient user ID.
    title : str
        Notification title.
    body : str
        Notification body.
    source_urn : str | None
        URN of the related content.

    Returns
    -------
    dict
        Delivery result.

    """
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
        async for session in get_async_session():
            ok = await push_adapter.deliver_with_session(session, uid, event)
            await session.commit()
            return {"status": "success" if ok else "skipped"}

    ok = await push_adapter.deliver(uid, event)
    return {"status": "success" if ok else "skipped"}


async def deliver_email_notification(
    ctx: dict[str, Any],
    user_id: str,
    title: str,
    body: str,
    source_urn: str | None = None,
) -> dict[str, Any]:
    """
    Deliver an email notification to a user.

    Standalone ARQ job for retryable email delivery.

    Parameters
    ----------
    ctx : dict
        ARQ context dictionary.
    user_id : str
        Recipient user ID.
    title : str
        Notification title.
    body : str
        Notification body.
    source_urn : str | None
        URN of the related content.

    Returns
    -------
    dict
        Delivery result.

    """
    email_adapter = DELIVERY_ADAPTERS.get("email")
    if not email_adapter:
        return {"status": "skipped", "reason": "no_email_adapter"}

    uid = UUID(user_id)
    event = NotificationEvent(
        notification_type=NotificationType.SYSTEM_ANNOUNCEMENT,
        organization_id=UUID("00000000-0000-0000-0000-000000000000"),
        actor_id=uid,
        title=title,
        body=body,
        source_urn=source_urn,
    )

    ok = await email_adapter.deliver(uid, event)
    return {"status": "success" if ok else "deferred"}


async def send_email_digest(ctx: dict[str, Any]) -> dict[str, Any]:
    """
    Periodic cron job: aggregate unread notifications and send email digests.

    Parameters
    ----------
    ctx : dict
        ARQ context dictionary.

    Returns
    -------
    dict
        Digest result with status and user count.

    """
    # Phase 6: query users with email_frequency in ("hourly", "daily"),
    # aggregate their unread notifications, render digest template, send.
    logger.debug("Email digest cron triggered (not yet implemented)")
    return {"status": "deferred", "reason": "digest_not_configured"}


async def _resolve_recipients(
    session: AsyncSession,
    event: NotificationEvent,
) -> list[UUID]:
    """
    Resolve the list of recipient user IDs for a notification event.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    event : NotificationEvent
        The notification event.

    Returns
    -------
    list[UUID]
        List of recipient user IDs (excludes the actor).

    """
    if event.target_user_ids is not None:
        # Explicit recipients provided -- exclude the actor
        return [uid for uid in event.target_user_ids if uid != event.actor_id]

    # Automatic resolution based on notification type
    recipients: list[UUID] = []

    if event.notification_type == NotificationType.SYSTEM_ANNOUNCEMENT:
        # All org members
        from uniffy.core.models.login.organization_member import OrganizationMember

        result = await session.execute(
            select(OrganizationMember.user_id).where(
                OrganizationMember.organization_id == event.organization_id
            )
        )
        recipients = [row[0] for row in result.all()]

    elif event.content_type and event.content_id:
        # Content-based resolution: notify content owner + bookmarkers
        from uniffy.core.models.bookmarks.bookmark import Bookmark

        recipient_set: set[UUID] = set()

        # Include content owner
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

        # Include bookmarkers of this content
        content_urn = event.source_urn
        if content_urn:
            result = await session.execute(
                select(Bookmark.user_id).where(Bookmark.urn == content_urn)
            )
            for row in result.all():
                recipient_set.add(row[0])

        recipients = list(recipient_set)

    # Always exclude the actor
    return [uid for uid in recipients if uid != event.actor_id]


async def _get_delivery_channels(
    session: AsyncSession,
    user_id: UUID,
    notification_type: NotificationType,
) -> set[str]:
    """
    Resolve which channels to deliver to for a user + notification type.

    Loads user settings, merges with defaults, applies master switches.
    Uses a Valkey cache (15-min TTL) to avoid hitting the DB on every call.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    user_id : UUID
        Recipient user ID.
    notification_type : NotificationType
        The notification type.

    Returns
    -------
    set[str]
        Set of enabled channels: {"in_app", "browser", "email"}.

    """
    from uniffy.core.valkey.cache import CACHE_MISS
    from uniffy.domains.notifications.cache import get_cached_settings, set_cached_settings
    from uniffy.domains.settings.defaults import get_effective_notification_channels

    # Try cache first
    cached = await get_cached_settings(user_id)

    if cached is not CACHE_MISS:
        overrides = cached
    else:
        # Cache miss -- query DB and populate cache
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
