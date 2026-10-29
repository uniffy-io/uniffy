"""Reconcile reordered LiveKit events against current call state."""

import asyncio
from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import select

from uniffy.core.models.calls import Call, CallEndReason
from uniffy.core.webhooks import WebhookVerificationError
from uniffy.domains.calls.admission import MediaAdmission, is_stale_session_event
from uniffy.domains.calls.config import get_livekit_config
from uniffy.domains.calls.livekit import get_livekit_admin_client
from uniffy.domains.calls.metrics import WEBHOOK_EVENTS, WEBHOOK_VERIFICATION, MediaEvent, Outcome
from uniffy.domains.calls.operations import CallOperations
from uniffy.domains.calls.publishing import CallPublishing
from uniffy.domains.calls.tokens import LiveKitTokenMinter, parse_room_call_id
from uniffy.infrastructure.database import open_session

logger = logger.bind(component="calls.webhook")


class LiveKitWebhookProvider:
    def __init__(self) -> None:
        self._minter = LiveKitTokenMinter(get_livekit_config())

    def verify(self, body: bytes, auth_header: str) -> dict[str, Any]:
        try:
            event = self._minter.verify_webhook(body, auth_header)
            if not isinstance(event, dict):
                raise WebhookVerificationError("Webhook event must be an object")
        except Exception:
            WEBHOOK_VERIFICATION.labels(Outcome.ERROR).inc()
            logger.warning("Call webhook verification failed")
            raise
        WEBHOOK_VERIFICATION.labels(Outcome.SUCCESS).inc()
        return event

    async def process(self, event: dict[str, Any]) -> None:
        try:
            kind = MediaEvent(event.get("event"))
        except TypeError, ValueError:
            kind = MediaEvent.UNKNOWN
        room = event.get("room")
        room_name = room.get("name") if isinstance(room, dict) else None
        call_id = parse_room_call_id(room_name) if isinstance(room_name, str) else None
        outcome = Outcome.SUCCESS
        with logger.contextualize(call_id=str(call_id) if call_id else None, event=kind):
            try:
                if call_id is None:
                    outcome = Outcome.SKIPPED
                elif kind == MediaEvent.PARTICIPANT_JOINED:
                    await self._on_participant_joined(call_id, room_name, event)
                elif kind in (MediaEvent.PARTICIPANT_LEFT, MediaEvent.PARTICIPANT_ABORTED):
                    await self._on_participant_left(call_id, room_name, event)
                elif kind == MediaEvent.ROOM_FINISHED:
                    await self._on_room_finished(call_id, room_name)
                else:
                    outcome = Outcome.SKIPPED
            except asyncio.CancelledError:
                outcome = Outcome.CANCELLED
                raise
            except Exception:
                outcome = Outcome.ERROR
                logger.exception("Call webhook processing failed")
                raise
            finally:
                WEBHOOK_EVENTS.labels(kind, outcome).inc()
                logger.bind(outcome=outcome).info("Call webhook processed")

    async def _on_participant_joined(
        self, call_id: UUID, room_name: str, event: dict[str, Any]
    ) -> None:
        identity = (event.get("participant") or {}).get("identity", "")
        if not identity:
            return
        async with open_session() as session:
            evicted = await MediaAdmission(
                session, get_livekit_admin_client()
            ).evict_if_unauthorized(call_id, room_name, identity)
            if not evicted:
                call = await _load_call(session, call_id, room_name)
                if call is not None and (call.publishing_revision > 0 or call.town_hall):
                    await CallPublishing(session).sync(call_id)

    async def _on_participant_left(
        self, call_id: UUID, room_name: str, event: dict[str, Any]
    ) -> None:
        participant_data = event.get("participant") or {}
        identity = participant_data.get("identity", "")
        if not identity:
            return
        async with open_session() as session:
            call = await _load_call(session, call_id, room_name)
            if call is None or call.ended_at is not None:
                return
            ops = CallOperations(session)
            participant = await ops.get_active_participant(call_id, identity)
            if participant is None:
                return
            if is_stale_session_event(
                participant_data, participant.token_jti, participant.session_jti
            ):
                return
            await ops.mark_participant_left(call, participant)

    async def _on_room_finished(self, call_id: UUID, room_name: str) -> None:
        async with open_session() as session:
            call = await _load_call(session, call_id, room_name)
            if call is None or call.ended_at is not None:
                return
            ops = CallOperations(session)
            await ops.end_call_internal(call, CallEndReason.ALL_LEFT)


async def _load_call(session, call_id: UUID, room_name: str) -> Call | None:
    result = await session.execute(
        select(Call).where(Call.id == call_id, Call.livekit_room_name == room_name)
    )
    return result.scalar_one_or_none()
