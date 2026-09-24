"""Calls-owned implementation of the channel and revocation lifecycle ports."""

from collections.abc import Sequence
from uuid import UUID

from loguru import logger
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.database import SessionFactory
from uniffy.core.models.calls import Call, CallEndReason, CallParticipant
from uniffy.domains.calls.config import LiveKitConfigError
from uniffy.domains.calls.lifecycle import CallEvictionReason
from uniffy.domains.calls.operations import CallOperations

logger = logger.bind(component="calls.channels")


class CallsLifecycle:
    def __init__(self, session_factory: SessionFactory) -> None:
        self._session_factory = session_factory

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

    async def evict_user(
        self,
        session: AsyncSession,
        user_id: UUID,
        *,
        reason: CallEvictionReason,
        organization_id: UUID | None = None,
        session_ids: Sequence[UUID] | None = None,
        actor_user_id: UUID | None = None,
    ) -> None:
        del session
        try:
            async with self._session_factory() as call_session:
                await CallOperations(call_session).evict_user(
                    user_id,
                    reason=reason,
                    organization_id=organization_id,
                    session_ids=session_ids,
                    actor_user_id=actor_user_id,
                )
        except LiveKitConfigError:
            return
        except Exception:
            logger.opt(exception=True).warning(
                f"call eviction deferred to the reconciler for user={user_id} reason={reason.value}"
            )

    async def stage_transfer_session(
        self,
        session: AsyncSession,
        from_session_id: UUID,
        to_session_id: UUID,
    ) -> None:
        await session.execute(
            update(CallParticipant)
            .where(
                CallParticipant.auth_session_id == from_session_id,
                CallParticipant.left_at.is_(None),
            )
            .values(auth_session_id=to_session_id)
            .execution_options(synchronize_session=False)
        )

    async def end_for_organization(
        self,
        session: AsyncSession,
        organization_id: UUID,
        reason: CallEndReason,
        actor_user_id: UUID | None = None,
    ) -> None:
        del session
        try:
            async with self._session_factory() as call_session:
                await CallOperations(call_session).end_calls_for_organization(
                    organization_id, reason, actor_user_id=actor_user_id
                )
        except LiveKitConfigError:
            return
        except Exception:
            logger.opt(exception=True).warning(
                f"org call teardown deferred to the reconciler for org={organization_id}"
            )
