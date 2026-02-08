"""Notification operations for CRUD and push subscription management.

This module handles all business logic for notifications including
list, mark as read, delete, and push subscription management.
"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import and_, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.notifications.notification import Notification
from uniffy.core.models.notifications.push_subscription import PushSubscription
from uniffy.core.models.shared import NotificationType


class NotificationOperations:
    """
    Notification CRUD operations.

    Notifications are user-scoped and do not use BaseContentOperations
    because they are system-generated, not user-created content.
    """

    def __init__(self, session: AsyncSession) -> None:
        """
        Initialize notification operations.

        Parameters
        ----------
        session : AsyncSession
            SQLAlchemy async session for database operations.

        """
        self.session = session

    async def list_notifications(
        self,
        user_id: UUID,
        organization_id: UUID,
        page: int = 1,
        page_size: int = 20,
        is_read: bool | None = None,
        notification_types: list[NotificationType] | None = None,
    ) -> tuple[list[Notification], int, int]:
        """
        List notifications for a user with optional filters.

        Parameters
        ----------
        user_id : UUID
            The recipient user ID.
        organization_id : UUID
            The organization context.
        page : int
            Page number (1-indexed).
        page_size : int
            Number of notifications per page.
        is_read : bool | None
            Filter by read status (None for all).
        notification_types : list[NotificationType] | None
            Filter by notification types.

        Returns
        -------
        tuple[list[Notification], int, int]
            (notifications, total_count, unread_count).

        """
        base_conditions = [
            Notification.user_id == user_id,
            Notification.organization_id == organization_id,
        ]

        if is_read is not None:
            base_conditions.append(Notification.is_read == is_read)

        if notification_types:
            base_conditions.append(Notification.notification_type.in_(notification_types))

        base_query = select(Notification).where(and_(*base_conditions))

        # Count total matching
        count_query = select(func.count()).select_from(base_query.subquery())
        total_count = (await self.session.execute(count_query)).scalar() or 0

        # Count unread (regardless of filters)
        unread_query = select(func.count()).where(
            and_(
                Notification.user_id == user_id,
                Notification.organization_id == organization_id,
                Notification.is_read == False,  # noqa: E712
            )
        )
        unread_count = (await self.session.execute(unread_query)).scalar() or 0

        # Fetch paginated results
        query = base_query.order_by(Notification.created_at.desc())
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self.session.execute(query)
        notifications = list(result.scalars().all())

        return (notifications, total_count, unread_count)

    async def get_unread_count(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> int:
        """
        Get the count of unread notifications.

        Parameters
        ----------
        user_id : UUID
            The recipient user ID.
        organization_id : UUID
            The organization context.

        Returns
        -------
        int
            Number of unread notifications.

        """
        query = select(func.count()).where(
            and_(
                Notification.user_id == user_id,
                Notification.organization_id == organization_id,
                Notification.is_read == False,  # noqa: E712
            )
        )
        result = (await self.session.execute(query)).scalar() or 0
        return result

    async def mark_as_read(
        self,
        user_id: UUID,
        notification_id: UUID,
    ) -> Notification | None:
        """
        Mark a single notification as read.

        Parameters
        ----------
        user_id : UUID
            The user ID (for ownership validation).
        notification_id : UUID
            The notification to mark as read.

        Returns
        -------
        Notification | None
            The updated notification, or None if not found.

        """
        result = await self.session.execute(
            select(Notification).where(
                and_(
                    Notification.id == notification_id,
                    Notification.user_id == user_id,
                )
            )
        )
        notification = result.scalars().first()

        if not notification:
            return None

        if not notification.is_read:
            notification.is_read = True
            notification.read_at = datetime.now(UTC)
            self.session.add(notification)
            await self.session.commit()
            await self.session.refresh(notification)

        return notification

    async def mark_all_as_read(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> int:
        """
        Mark all unread notifications as read for a user in an organization.

        Parameters
        ----------
        user_id : UUID
            The user ID.
        organization_id : UUID
            The organization context.

        Returns
        -------
        int
            Number of notifications marked as read.

        """
        now = datetime.now(UTC)
        stmt = (
            update(Notification)
            .where(
                and_(
                    Notification.user_id == user_id,
                    Notification.organization_id == organization_id,
                    Notification.is_read == False,  # noqa: E712
                )
            )
            .values(is_read=True, read_at=now)
        )
        result = await self.session.execute(stmt)
        await self.session.commit()
        return result.rowcount

    async def delete_notification(
        self,
        user_id: UUID,
        notification_id: UUID,
    ) -> bool:
        """
        Delete a notification.

        Parameters
        ----------
        user_id : UUID
            The user ID (for ownership validation).
        notification_id : UUID
            The notification to delete.

        Returns
        -------
        bool
            True if deleted, False if not found.

        """
        result = await self.session.execute(
            select(Notification).where(
                and_(
                    Notification.id == notification_id,
                    Notification.user_id == user_id,
                )
            )
        )
        notification = result.scalars().first()

        if not notification:
            return False

        await self.session.delete(notification)
        await self.session.commit()
        return True

    async def create_notifications_batch(
        self,
        notifications: list[Notification],
    ) -> list[Notification]:
        """
        Batch insert notifications.

        Parameters
        ----------
        notifications : list[Notification]
            List of notification models to insert.

        Returns
        -------
        list[Notification]
            The created notifications.

        """
        for notification in notifications:
            self.session.add(notification)
        await self.session.commit()
        return notifications


class PushSubscriptionOperations:
    """Push subscription CRUD operations."""

    def __init__(self, session: AsyncSession) -> None:
        """
        Initialize push subscription operations.

        Parameters
        ----------
        session : AsyncSession
            SQLAlchemy async session for database operations.

        """
        self.session = session

    async def register(
        self,
        user_id: UUID,
        endpoint: str,
        p256dh_key: str,
        auth_key: str,
        user_agent: str | None = None,
    ) -> PushSubscription:
        """
        Register or update a push subscription.

        If a subscription with the same user_id and endpoint exists,
        updates the keys. Otherwise creates a new subscription.

        Parameters
        ----------
        user_id : UUID
            The user ID.
        endpoint : str
            Web Push endpoint URL.
        p256dh_key : str
            VAPID p256dh key.
        auth_key : str
            VAPID auth key.
        user_agent : str | None
            Browser user agent.

        Returns
        -------
        PushSubscription
            The registered subscription.

        """
        # Check for existing subscription
        result = await self.session.execute(
            select(PushSubscription).where(
                and_(
                    PushSubscription.user_id == user_id,
                    PushSubscription.endpoint == endpoint,
                )
            )
        )
        existing = result.scalars().first()

        if existing:
            existing.p256dh_key = p256dh_key
            existing.auth_key = auth_key
            if user_agent:
                existing.user_agent = user_agent
            self.session.add(existing)
            await self.session.commit()
            await self.session.refresh(existing)
            return existing

        subscription = PushSubscription(
            user_id=user_id,
            endpoint=endpoint,
            p256dh_key=p256dh_key,
            auth_key=auth_key,
            user_agent=user_agent,
        )
        self.session.add(subscription)
        await self.session.commit()
        await self.session.refresh(subscription)
        return subscription

    async def unregister(
        self,
        user_id: UUID,
        endpoint: str,
    ) -> bool:
        """
        Unregister a push subscription by endpoint.

        Parameters
        ----------
        user_id : UUID
            The user ID.
        endpoint : str
            Web Push endpoint URL to remove.

        Returns
        -------
        bool
            True if removed, False if not found.

        """
        result = await self.session.execute(
            select(PushSubscription).where(
                and_(
                    PushSubscription.user_id == user_id,
                    PushSubscription.endpoint == endpoint,
                )
            )
        )
        subscription = result.scalars().first()

        if not subscription:
            return False

        await self.session.delete(subscription)
        await self.session.commit()
        return True

    async def get_subscriptions_for_user(
        self,
        user_id: UUID,
    ) -> list[PushSubscription]:
        """
        Get all push subscriptions for a user.

        Parameters
        ----------
        user_id : UUID
            The user ID.

        Returns
        -------
        list[PushSubscription]
            List of push subscriptions.

        """
        result = await self.session.execute(
            select(PushSubscription).where(PushSubscription.user_id == user_id)
        )
        return list(result.scalars().all())
