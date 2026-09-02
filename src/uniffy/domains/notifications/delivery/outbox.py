"""Database lifecycle for notification email outbox rows."""

from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum
from typing import Any
from uuid import UUID

from sqlalchemy import and_, delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.content.references import parse_urn
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.user import User
from uniffy.core.models.notifications.email_delivery import (
    NotificationEmailDelivery,
    NotificationEmailStatus,
)
from uniffy.core.types import ContentType, NotificationType
from uniffy.domains.notifications.delivery.timing import next_email_delivery_at
from uniffy.domains.notifications.preferences import (
    load_notification_overrides,
    resolve_email_frequency,
)
from uniffy.domains.permissions.access import ResourceAccessResolver, ResourceKey
from uniffy.domains.settings.defaults import get_effective_notification_channels
from uniffy.domains.settings.operations import get_user_timezone

_DIGEST_LIMIT = 500
_LEASE_DURATION = timedelta(minutes=10)
_TERMINAL_RETENTION = timedelta(days=30)
_TERMINAL_PURGE_LIMIT = 1000


class NotificationEmailTerminalReason(StrEnum):
    USER_INACTIVE = "user_inactive"
    ORGANIZATION_INACTIVE = "organization_inactive"
    EMAIL_UNVERIFIED = "email_unverified"
    PREFERENCE_DISABLED = "preference_disabled"
    ACCESS_REVOKED = "access_revoked"
    SUPPRESSION_LIST = "suppression_list"
    MAIL_NOT_CONFIGURED = "mail_not_configured"
    DELIVERY_FAILED = "delivery_failed"


@dataclass(frozen=True)
class RecipientContext:
    user: User
    organization: Organization
    notification_overrides: dict[str, Any] | None
    timezone: str | None
    actor_names: dict[UUID, str]


async def claim_email_delivery(
    session: AsyncSession,
    delivery_id: UUID,
    now: datetime,
) -> NotificationEmailDelivery | None:
    delivery = (
        await session.execute(
            select(NotificationEmailDelivery)
            .where(
                NotificationEmailDelivery.id == delivery_id,
                NotificationEmailDelivery.scheduled_for <= now,
                claimable_email_predicate(now),
            )
            .with_for_update(skip_locked=True)
        )
    ).scalar_one_or_none()
    if delivery is None:
        return None
    _claim(delivery, now)
    await session.commit()
    return delivery


async def claim_email_digest(
    session: AsyncSession,
    organization_id: UUID,
    user_id: UUID,
    frequency: str,
    window_end: datetime,
    now: datetime,
) -> list[NotificationEmailDelivery]:
    deliveries = list(
        (
            await session.execute(
                select(NotificationEmailDelivery)
                .where(
                    NotificationEmailDelivery.organization_id == organization_id,
                    NotificationEmailDelivery.user_id == user_id,
                    NotificationEmailDelivery.frequency == frequency,
                    NotificationEmailDelivery.scheduled_for <= window_end,
                    claimable_email_predicate(now),
                )
                .order_by(NotificationEmailDelivery.created_at)
                .limit(_DIGEST_LIMIT)
                .with_for_update(skip_locked=True)
            )
        )
        .scalars()
        .all()
    )
    for delivery in deliveries:
        _claim(delivery, now)
    if deliveries:
        await session.commit()
    return deliveries


async def prepare_email_recipient(
    session: AsyncSession,
    deliveries: list[NotificationEmailDelivery],
    now: datetime,
) -> RecipientContext | None:
    first = deliveries[0]
    user = await session.get(User, first.user_id)
    organization = await session.get(Organization, first.organization_id)
    if user is None or organization is None or not user.is_active:
        terminal_email_deliveries(
            deliveries,
            NotificationEmailStatus.SKIPPED,
            NotificationEmailTerminalReason.USER_INACTIVE,
            now,
        )
        return None
    if (
        not organization.is_active
        or organization.is_suspended
        or organization.deleted_at is not None
    ):
        terminal_email_deliveries(
            deliveries,
            NotificationEmailStatus.SKIPPED,
            NotificationEmailTerminalReason.ORGANIZATION_INACTIVE,
            now,
        )
        return None
    if not user.email or not user.email_verified:
        terminal_email_deliveries(
            deliveries,
            NotificationEmailStatus.SKIPPED,
            NotificationEmailTerminalReason.EMAIL_UNVERIFIED,
            now,
        )
        return None

    overrides = await load_notification_overrides(session, user.id)
    access_resolver = ResourceAccessResolver(session)
    subject = await access_resolver.subject(
        actor_id=user.id,
        organization_id=organization.id,
    )
    if not subject.is_active_member:
        terminal_email_deliveries(
            deliveries,
            NotificationEmailStatus.SKIPPED,
            NotificationEmailTerminalReason.USER_INACTIVE,
            now,
        )
        return None

    timezone = await get_user_timezone(session, user.id)
    current_frequency = resolve_email_frequency(overrides)
    for delivery in deliveries:
        try:
            notification_type = NotificationType(delivery.notification_type)
        except ValueError, TypeError:
            terminal_email_delivery(
                delivery,
                NotificationEmailStatus.SKIPPED,
                NotificationEmailTerminalReason.PREFERENCE_DISABLED,
                now,
            )
            continue
        channels = get_effective_notification_channels(notification_type, overrides)
        if not channels.get("email", False):
            terminal_email_delivery(
                delivery,
                NotificationEmailStatus.SKIPPED,
                NotificationEmailTerminalReason.PREFERENCE_DISABLED,
                now,
            )
            continue
        scheduled_for = next_email_delivery_at(
            current_frequency,
            overrides,
            timezone,
            at=delivery.created_at,
        )
        if delivery.frequency != current_frequency.value or scheduled_for > now:
            delivery.frequency = current_frequency.value
            release_email_delivery(delivery, scheduled_for=scheduled_for, now=now)
            continue

    await _drop_revoked_deliveries(session, access_resolver, deliveries, now)
    actor_ids = {delivery.actor_id for delivery in deliveries if delivery.actor_id}
    actor_names: dict[UUID, str] = {}
    if actor_ids:
        rows = (
            await session.execute(
                select(User.id, User.full_name, User.username).where(User.id.in_(actor_ids))
            )
        ).all()
        actor_names = {actor_id: full_name or username for actor_id, full_name, username in rows}
    return RecipientContext(
        user=user,
        organization=organization,
        notification_overrides=overrides,
        timezone=timezone,
        actor_names=actor_names,
    )


async def purge_terminal_email_deliveries(session: AsyncSession, now: datetime) -> int:
    terminal_statuses = [
        NotificationEmailStatus.SENT.value,
        NotificationEmailStatus.SUPPRESSED.value,
        NotificationEmailStatus.SKIPPED.value,
        NotificationEmailStatus.FAILED.value,
    ]
    ids = list(
        (
            await session.execute(
                select(NotificationEmailDelivery.id)
                .where(
                    NotificationEmailDelivery.status.in_(terminal_statuses),
                    NotificationEmailDelivery.updated_at < now - _TERMINAL_RETENTION,
                )
                .order_by(NotificationEmailDelivery.updated_at)
                .limit(_TERMINAL_PURGE_LIMIT)
            )
        ).scalars()
    )
    if ids:
        await session.execute(
            delete(NotificationEmailDelivery).where(NotificationEmailDelivery.id.in_(ids))
        )
    return len(ids)


def claimable_email_predicate(now: datetime):
    return or_(
        NotificationEmailDelivery.status == NotificationEmailStatus.PENDING.value,
        and_(
            NotificationEmailDelivery.status == NotificationEmailStatus.PROCESSING.value,
            NotificationEmailDelivery.lease_expires_at < now,
        ),
    )


def release_email_delivery(
    delivery: NotificationEmailDelivery,
    *,
    scheduled_for: datetime,
    now: datetime,
) -> None:
    delivery.status = NotificationEmailStatus.PENDING
    delivery.scheduled_for = scheduled_for
    delivery.lease_expires_at = None
    delivery.updated_at = now


def terminal_email_deliveries(
    deliveries: list[NotificationEmailDelivery],
    status: NotificationEmailStatus,
    reason: NotificationEmailTerminalReason,
    now: datetime,
) -> None:
    for delivery in deliveries:
        terminal_email_delivery(delivery, status, reason, now)


def terminal_email_delivery(
    delivery: NotificationEmailDelivery,
    status: NotificationEmailStatus,
    reason: NotificationEmailTerminalReason,
    now: datetime,
) -> None:
    delivery.status = status
    delivery.terminal_reason = reason.value
    delivery.lease_expires_at = None
    delivery.updated_at = now


def mark_email_deliveries_sent(
    deliveries: list[NotificationEmailDelivery],
    provider_message_id: str | None,
    now: datetime,
) -> None:
    for delivery in deliveries:
        delivery.status = NotificationEmailStatus.SENT
        delivery.sent_at = now
        delivery.provider_message_id = provider_message_id
        delivery.lease_expires_at = None
        delivery.updated_at = now


async def _drop_revoked_deliveries(
    session: AsyncSession,
    access_resolver: ResourceAccessResolver,
    deliveries: list[NotificationEmailDelivery],
    now: datetime,
) -> None:
    keyed: dict[UUID, ResourceKey] = {}
    for delivery in deliveries:
        if delivery.status != NotificationEmailStatus.PROCESSING:
            continue
        target = _delivery_target(delivery)
        if target is not None:
            keyed[delivery.id] = ResourceKey(*target)
    if not keyed:
        return
    decisions = await access_resolver.resolve_page(
        actor_id=deliveries[0].user_id,
        organization_id=deliveries[0].organization_id,
        keys=keyed.values(),
    )
    for delivery in deliveries:
        key = keyed.get(delivery.id)
        if key is not None and not decisions[key].can_view:
            terminal_email_delivery(
                delivery,
                NotificationEmailStatus.SKIPPED,
                NotificationEmailTerminalReason.ACCESS_REVOKED,
                now,
            )


def _delivery_target(
    delivery: NotificationEmailDelivery,
) -> tuple[ContentType, UUID] | None:
    if delivery.content_type and delivery.content_id:
        try:
            return ContentType(delivery.content_type), delivery.content_id
        except ValueError, TypeError:
            return None
    return parse_urn(delivery.source_urn) if delivery.source_urn else None


def _claim(delivery: NotificationEmailDelivery, now: datetime) -> None:
    delivery.status = NotificationEmailStatus.PROCESSING
    delivery.lease_expires_at = now + _LEASE_DURATION
    delivery.attempt_count += 1
    delivery.updated_at = now
