"""LiveKit webhook provider: SFU state changes reconcile into call state.

Events arrive at-least-once and possibly out of order, so every handler is
idempotent: it re-checks current DB state before mutating.
"""

from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import select

from uniffy.core.json_codec import loads
from uniffy.core.models.calls import Call, CallEndReason
from uniffy.db import open_session
from uniffy.domains.calls.config import get_livekit_config
from uniffy.domains.calls.livekit_client import LiveKitApiError, get_livekit_admin_client
from uniffy.domains.calls.operations import CallOperations
from uniffy.domains.calls.tokens import LiveKitTokenMinter, parse_room_call_id

logger = logger.bind(component="calls.webhook")


def _participant_jti(participant: dict[str, Any]) -> str:
    """jti of the token the SFU session was established with (from minted metadata)."""
    try:
        return (loads(participant.get("metadata") or "") or {}).get("jti", "")
    except ValueError:
        return ""


def _is_stale_session_event(
    participant_data: dict[str, Any], row_jti: str | None, session_jti: str | None = None
) -> bool:
    """An event whose jti matches neither the latest token nor the jti the live SFU session was
    established with belongs to a session already replaced by a grace rejoin, so it must not touch
    current state. Matching session_jti keeps a live session's events flowing across a mid-call
    token refresh, which advances token_jti but is never handed to the Room."""
    event_jti = _participant_jti(participant_data)
    if not event_jti:
        return False
    if event_jti in (row_jti, session_jti):
        return False
    return bool(row_jti or session_jti)


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
        """Evict a live SFU session that has no active membership row.

        A legitimate join always has a row because it commits before the client ever receives its
        token. The DB is the single authority: a revoked, stolen, or otherwise orphaned session
        (including one whose participant_joined we never saw) is converged here and by the
        reconciler.
        """
        participant = event.get("participant") or {}
        identity = participant.get("identity", "")
        if not identity:
            return
        async with open_session() as session:
            call = await _load_call(session, call_id)
            ops = CallOperations(session)
            if (
                call is None
                or call.ended_at is not None
                or await ops.get_active_participant(call_id, identity) is None
            ):
                logger.warning(
                    f"Evicting SFU session with no active membership "
                    f"on call={call_id} identity={identity}"
                )
                client = get_livekit_admin_client()
                try:
                    await client.remove_participant(room_name, identity)
                except LiveKitApiError as exc:
                    if exc.status_code != 404:
                        raise

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
            if _is_stale_session_event(
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
