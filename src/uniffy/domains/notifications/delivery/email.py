"""Durable staging adapter for notification email."""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.database import SessionFactory
from uniffy.core.events.types import NotificationEvent
from uniffy.core.jobs import enqueue_job
from uniffy.core.mail import MailConfig
from uniffy.core.mail.config import MAIL_NAMESPACE
from uniffy.core.models.notifications.email_delivery import (
    NotificationEmailDelivery,
    NotificationEmailStatus,
)
from uniffy.core.models.settings.org_setting import OrgSetting
from uniffy.domains.notifications.delivery.base import DeliveryAdapter, NotificationChannel
from uniffy.domains.notifications.delivery.timing import next_email_delivery_at
from uniffy.domains.notifications.jobs.contracts import SEND_NOTIFICATION_EMAIL
from uniffy.domains.notifications.preferences import (
    get_delivery_preferences,
    resolve_email_frequency,
)
from uniffy.domains.settings.defaults import EmailFrequency
from uniffy.domains.settings.preferences import get_user_timezone

logger = logger.bind(component="notifications.delivery.email")


@dataclass(frozen=True)
class StagedEmailDelivery:
    id: UUID
    frequency: EmailFrequency
    scheduled_for: datetime


class EmailAdapter(DeliveryAdapter):
    """Stage notification email in PostgreSQL before queue dispatch."""

    def __init__(self, session_factory: SessionFactory) -> None:
        self._session_factory = session_factory

    @property
    def channel_name(self) -> NotificationChannel:
        return NotificationChannel.EMAIL

    async def startup(self) -> None:
        if os.getenv("ENVIRONMENT", "development").lower() != "production":  # noqa: PLR2004
            return
        if MailConfig.from_env() is not None:
            return

        async with self._session_factory() as session:
            row = (
                await session.execute(
                    select(OrgSetting).where(OrgSetting.namespace == MAIL_NAMESPACE).limit(1)
                )
            ).scalar_one_or_none()
            if row is not None:
                return

        logger.warning(
            "Notification email is disabled: configure MAIL_* defaults or per-org mail settings"
        )

    async def stage_with_session(
        self,
        session: AsyncSession,
        user_id: UUID,
        event: NotificationEvent,
        notification_overrides: dict[str, Any] | None,
        *,
        timezone: str | None,
        at: datetime | None = None,
    ) -> StagedEmailDelivery | None:
        frequency = resolve_email_frequency(notification_overrides)
        scheduled_for = next_email_delivery_at(
            frequency,
            notification_overrides,
            timezone,
            at=at,
        )
        statement = (
            pg_insert(NotificationEmailDelivery)
            .values(
                event_id=event.event_id,
                organization_id=event.organization_id,
                user_id=user_id,
                actor_id=event.actor_id,
                notification_type=event.notification_type.value,
                title=event.title,
                body=event.body,
                source_urn=event.source_urn,
                content_type=event.content_type.value if event.content_type else None,
                content_id=event.content_id,
                notification_metadata=event.metadata,
                frequency=frequency.value,
                status=NotificationEmailStatus.PENDING.value,
                scheduled_for=scheduled_for,
            )
            .on_conflict_do_nothing(index_elements=["event_id", "user_id"])
            .returning(NotificationEmailDelivery.id)
        )
        delivery_id = (await session.execute(statement)).scalar_one_or_none()
        if delivery_id is None:
            return None
        return StagedEmailDelivery(
            id=delivery_id,
            frequency=frequency,
            scheduled_for=scheduled_for,
        )

    async def enqueue_if_due(self, delivery: StagedEmailDelivery) -> bool:
        if delivery.frequency is not EmailFrequency.INSTANT:
            return True
        if delivery.scheduled_for > datetime.now(UTC):
            return True
        try:
            await enqueue_job(
                SEND_NOTIFICATION_EMAIL,
                str(delivery.id),
                _job_id=f"notification_email:{delivery.id}",
            )
        except RuntimeError:
            logger.warning(f"Email delivery {delivery.id} remains pending: queue unavailable")
            return False
        except Exception:
            logger.opt(exception=True).warning(
                f"Email delivery {delivery.id} remains pending: enqueue failed"
            )
            return False
        return True

    async def deliver(self, user_id: UUID, event: NotificationEvent) -> bool:
        async with self._session_factory() as session:
            channels, overrides = await get_delivery_preferences(
                session,
                user_id,
                event.notification_type,
            )
            if NotificationChannel.EMAIL not in channels:
                return False
            timezone = await get_user_timezone(session, user_id)
            staged = await self.stage_with_session(
                session,
                user_id,
                event,
                overrides,
                timezone=timezone,
            )
            await session.commit()
        if staged is None:
            return True
        await self.enqueue_if_due(staged)
        return True
