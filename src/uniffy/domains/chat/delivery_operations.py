"""Operator repair for failed chat projections without replaying completed work."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.errors import NotFoundError, ValidationError
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.chat.delivery import ChatDelivery, ChatDeliveryEffect, ChatDeliveryStatus


async def retry_failed_delivery(
    session: AsyncSession,
    *,
    organization_id: UUID,
    message_id: UUID,
    effect: ChatDeliveryEffect,
    operator: str,
    reason: str,
) -> None:
    if not operator.strip() or not reason.strip():
        raise ValidationError("operator", "Operator and reason are required")
    row = await session.scalar(
        select(ChatDelivery)
        .where(
            ChatDelivery.organization_id == organization_id,
            ChatDelivery.message_id == message_id,
            ChatDelivery.effect == effect,
        )
        .with_for_update()
    )
    if row is None:
        raise NotFoundError("chat delivery", message_id)
    if row.status != ChatDeliveryStatus.FAILED:
        raise ValidationError("status", "Only failed delivery work can be retried")
    await write_audit_event(
        session,
        organization_id=organization_id,
        actor_user_id=None,
        action=Action.CHAT_DELIVERY_RETRIED,
        resource_type=AuditResourceType.CHAT_MESSAGE,
        resource_id=message_id,
        details={
            "operator": operator,
            "reason": reason,
            "effect": effect.value,
            "attempts": row.attempts,
        },
    )
    row.status = ChatDeliveryStatus.PENDING
    row.attempts = 0
    row.last_error = None
    row.dispatched_at = None
    row.available_at = datetime.now(UTC)
    await session.commit()
