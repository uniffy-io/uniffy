"""Calls-owned implementation of the chat channel lifecycle port."""

from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.calls import Call, CallEndReason
from uniffy.domains.calls.config import LiveKitConfigError
from uniffy.domains.calls.operations import CallOperations

logger = logger.bind(component="calls.channels")


class CallsChannelLifecycle:
    async def end_for_channel_archive(
        self,
        session: AsyncSession,
        channel_id: UUID,
    ) -> None:
        result = await session.execute(
            select(Call).where(Call.channel_id == channel_id, Call.ended_at.is_(None))
        )
        call = result.scalar_one_or_none()
        if call is None:
            return
        try:
            operations = CallOperations(session)
        except LiveKitConfigError:
            logger.warning(
                "Active call {} in channel {} but LiveKit is not configured",
                call.id,
                channel_id,
            )
            return
        await operations.end_call_internal(call, CallEndReason.CHANNEL_ARCHIVED)

    async def remove_member(
        self,
        session: AsyncSession,
        channel_id: UUID,
        user_id: UUID,
    ) -> None:
        result = await session.execute(
            select(Call).where(Call.channel_id == channel_id, Call.ended_at.is_(None))
        )
        call = result.scalar_one_or_none()
        if call is None:
            return
        try:
            operations = CallOperations(session)
        except LiveKitConfigError:
            return
        await operations.remove_channel_member(call, user_id)
