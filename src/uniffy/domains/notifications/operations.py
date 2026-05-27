"""Notification CRUD and push subscription operations."""

from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import and_, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.notifications.notification import Notification
from uniffy.core.models.notifications.push_subscription import PushSubscription
from uniffy.core.models.shared import NotificationType


class NotificationOperations:
    """Notification CRUD - user-scoped, not BaseContentOperations."""

    def __init__(self, session: AsyncSession) -> None:
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
        """Return ``(notifications, total_count, unread_count)`` for the user."""
        base_conditions = [
            Notification.user_id == user_id,
            Notification.organization_id == organization_id,
        ]

        if is_read is not None:
            base_conditions.append(Notification.is_read == is_read)

        if notification_types:
            base_conditions.append(Notification.notification_type.in_(notification_types))

        base_query = select(Notification).where(and_(*base_conditions))

        count_query = select(func.count()).select_from(base_query.subquery())
        total_count = (await self.session.execute(count_query)).scalar() or 0

        # Unread total ignores filters - the badge counts every unread row.
        unread_query = select(func.count()).where(
            and_(
                Notification.user_id == user_id,
                Notification.organization_id == organization_id,
                Notification.is_read == False,  # noqa: E712
            )
        )
        unread_count = (await self.session.execute(unread_query)).scalar() or 0

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

    async def search_notifications(
        self,
        user_id: UUID,
        organization_id: UUID,
        query: str = "",
        page: int = 1,
        page_size: int = 20,
        is_read: bool | None = None,
        notification_types: list[NotificationType] | None = None,
        date_from: datetime | None = None,
        date_to: datetime | None = None,
        actor_id: UUID | None = None,
    ) -> tuple[list[Notification], int, int]:
        """Search notifications by free text + filters; returns ``(rows, total, unread)``."""
        base_conditions = [
            Notification.user_id == user_id,
            Notification.organization_id == organization_id,
        ]

        if is_read is not None:
            base_conditions.append(Notification.is_read == is_read)

        if notification_types:
            base_conditions.append(Notification.notification_type.in_(notification_types))

        if date_from is not None:
            base_conditions.append(Notification.created_at >= date_from)

        if date_to is not None:
            base_conditions.append(Notification.created_at <= date_to)

        if actor_id is not None:
            base_conditions.append(Notification.actor_id == actor_id)

        if query.strip():
            search_term = f"%{query.strip().lower()}%"
            base_conditions.append(
                func.lower(Notification.title).like(search_term)
                | func.lower(Notification.body).like(search_term)
            )

        base_query = select(Notification).where(and_(*base_conditions))

        count_query = select(func.count()).select_from(base_query.subquery())
        total_count = (await self.session.execute(count_query)).scalar() or 0

        unread_query = select(func.count()).where(
            and_(
                Notification.user_id == user_id,
                Notification.organization_id == organization_id,
                Notification.is_read == False,  # noqa: E712
            )
        )
        unread_count = (await self.session.execute(unread_query)).scalar() or 0

        results_query = base_query.order_by(Notification.created_at.desc())
        results_query = results_query.offset((page - 1) * page_size).limit(page_size)

        result = await self.session.execute(results_query)
        notifications = list(result.scalars().all())

        return (notifications, total_count, unread_count)

    async def get_notification_stats(
        self,
        user_id: UUID,
        organization_id: UUID,
        days: int = 30,
    ) -> tuple[
        list[tuple[str, int, int, int]],
        list[tuple[NotificationType, int]],
        int,
        int,
        int,
    ]:
        """Return ``(daily_stats, type_stats, total, unread, read)`` over the last ``days``."""
        cutoff = datetime.now(UTC) - timedelta(days=days)
        base_conditions = [
            Notification.user_id == user_id,
            Notification.organization_id == organization_id,
            Notification.created_at >= cutoff,
        ]

        # Daily stats
        date_col = func.date(Notification.created_at).label("day")
        daily_query = (
            select(
                date_col,
                func.count().label("total"),
                func.count().filter(Notification.is_read == False).label("unread"),  # noqa: E712
                func.count().filter(Notification.is_read == True).label("read"),  # noqa: E712
            )
            .where(and_(*base_conditions))
            .group_by(date_col)
            .order_by(date_col)
        )
        daily_result = await self.session.execute(daily_query)
        daily_stats = [(str(row.day), row.total, row.unread, row.read) for row in daily_result.all()]

        type_query = (
            select(
                Notification.notification_type,
                func.count().label("count"),
            )
            .where(and_(*base_conditions))
            .group_by(Notification.notification_type)
            .order_by(func.count().desc())
        )
        type_result = await self.session.execute(type_query)
        type_stats = [(row.notification_type, row.count) for row in type_result.all()]

        total_query = select(func.count()).where(and_(*base_conditions))
        total_count = (await self.session.execute(total_query)).scalar() or 0

        unread_query = select(func.count()).where(
            and_(
                *base_conditions,
                Notification.is_read == False,  # noqa: E712
            )
        )
        unread_count = (await self.session.execute(unread_query)).scalar() or 0

        read_count = total_count - unread_count

        return (daily_stats, type_stats, total_count, unread_count, read_count)

    async def mark_read_by_source_urn(
        self,
        user_id: UUID,
        organization_id: UUID,
        source_urn: str,
    ) -> int:
        """Cascade-mark notifications whose ``source_urn`` matches as read."""
        if not source_urn:
            return 0

        now = datetime.now(UTC)
        stmt = (
            update(Notification)
            .where(
                and_(
                    Notification.user_id == user_id,
                    Notification.organization_id == organization_id,
                    Notification.source_urn == source_urn,
                    Notification.is_read == False,  # noqa: E712
                )
            )
            .values(is_read=True, read_at=now)
        )
        result = await self.session.execute(stmt)
        await self.session.commit()
        return result.rowcount

    async def bulk_mark_as_read(
        self,
        user_id: UUID,
        notification_ids: list[UUID],
    ) -> int:
        if not notification_ids:
            return 0

        now = datetime.now(UTC)
        stmt = (
            update(Notification)
            .where(
                and_(
                    Notification.user_id == user_id,
                    Notification.id.in_(notification_ids),
                    Notification.is_read == False,  # noqa: E712
                )
            )
            .values(is_read=True, read_at=now)
        )
        result = await self.session.execute(stmt)
        await self.session.commit()
        return result.rowcount

    async def bulk_delete_notifications(
        self,
        user_id: UUID,
        notification_ids: list[UUID],
    ) -> int:
        if not notification_ids:
            return 0

        result = await self.session.execute(
            select(Notification).where(
                and_(
                    Notification.user_id == user_id,
                    Notification.id.in_(notification_ids),
                )
            )
        )
        notifications = list(result.scalars().all())

        for notification in notifications:
            await self.session.delete(notification)

        await self.session.commit()
        return len(notifications)

    async def create_notifications_batch(
        self,
        notifications: list[Notification],
    ) -> list[Notification]:
        for notification in notifications:
            self.session.add(notification)
        await self.session.commit()
        return notifications


class PushSubscriptionOperations:
    """Push subscription CRUD."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def register(
        self,
        user_id: UUID,
        endpoint: str,
        p256dh_key: str,
        auth_key: str,
        user_agent: str | None = None,
    ) -> PushSubscription:
        """Upsert a push subscription by ``(user_id, endpoint)``."""
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
        result = await self.session.execute(
            select(PushSubscription).where(PushSubscription.user_id == user_id)
        )
        return list(result.scalars().all())
