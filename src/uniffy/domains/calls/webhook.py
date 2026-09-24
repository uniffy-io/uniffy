"""Reconcile reordered LiveKit events against current call state."""

from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import select

from uniffy.core.models.calls import Call, CallEndReason
from uniffy.domains.calls.admission import MediaAdmission, is_stale_session_event
from uniffy.domains.calls.config import get_livekit_config
from uniffy.domains.calls.livekit import get_livekit_admin_client
from uniffy.domains.calls.operations import CallOperations
from uniffy.domains.calls.tokens import LiveKitTokenMinter, parse_room_call_id
from uniffy.infrastructure.database import open_session

logger = logger.bind(component="calls.webhook")


class LiveKitWebhookProvider:
    def __init__(self) -> None:
        self._minter = LiveKitTokenMinter(get_livekit_config())

    def verify(self, body: bytes, auth_header: str) -> dict[str, Any]:
        return self._minter.verify_webhook(body, auth_header)

    async def process(self, event: dict[str, Any]) -> None:
        event_name = event.get("event", "")
        room_name = (event.get("room") or {}).get("name", "")
        call_id = parse_room_call_id(room_name)
        if call_id is None:
            logger.warning(f"Webhook for unrecognized room name: {room_name}")
            return

        if event_name == "participant_joined":  # noqa: PLR2004
            await self._on_participant_joined(call_id, room_name, event)
        elif event_name in ("participant_left", "participant_connection_aborted"):
            # Aborted = signaling succeeded but media never connected; the
            # participant row exists and must be released like a leave.
            await self._on_participant_left(call_id, event)
        elif event_name == "room_finished":  # noqa: PLR2004
            await self._on_room_finished(call_id)
        # Track publish/mute events are ignored: LiveKit emits no mute webhook and
        # a muted mic stays published, so roster mic/camera/screen state is synced
        # by the client via ReportMediaState, not inferred from track events.

    async def _on_participant_joined(
        self, call_id: UUID, room_name: str, event: dict[str, Any]
    ) -> None:
        identity = (event.get("participant") or {}).get("identity", "")
        if not identity:
            return
        async with open_session() as session:
            await MediaAdmission(session, get_livekit_admin_client()).evict_if_unauthorized(
                call_id, room_name, identity
            )

    async def _on_participant_left(self, call_id: UUID, event: dict[str, Any]) -> None:
        participant_data = event.get("participant") or {}
        identity = participant_data.get("identity", "")
        if not identity:
            return
        async with open_session() as session:
            call = await _load_call(session, call_id)
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

    async def _on_room_finished(self, call_id: UUID) -> None:
        async with open_session() as session:
            call = await _load_call(session, call_id)
            if call is None or call.ended_at is not None:
                return
            ops = CallOperations(session)
            await ops.end_call_internal(call, CallEndReason.ALL_LEFT)


async def _load_call(session, call_id: UUID) -> Call | None:
    result = await session.execute(select(Call).where(Call.id == call_id))
    return result.scalar_one_or_none()
