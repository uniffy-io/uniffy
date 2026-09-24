"""Match live media sessions to current PostgreSQL authorization."""

from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.json_codec import JSONDecodeError, loads
from uniffy.core.models.calls import Call, CallParticipant
from uniffy.core.models.login.user_session import UserSession
from uniffy.domains.calls.livekit import LiveKitAdminClient, LiveKitApiError
from uniffy.domains.chat.access import ChatAccessChecker


def participant_jti(participant: dict[str, Any]) -> str:
    try:
        metadata = loads(participant.get("metadata") or "")
    except JSONDecodeError:
        return ""
    if not isinstance(metadata, dict):
        return ""
    jti = metadata.get("jti")
    return jti if isinstance(jti, str) else ""


def matches_media_session(
    participant: dict[str, Any], token_jti: str | None, session_jti: str | None
) -> bool:
    jti = participant_jti(participant)
    return bool(jti) and jti in (token_jti, session_jti)


def is_stale_session_event(
    participant: dict[str, Any], token_jti: str | None, session_jti: str | None = None
) -> bool:
    jti = participant_jti(participant)
    return bool(jti and (token_jti or session_jti)) and jti not in (token_jti, session_jti)


class MediaAdmission:
    def __init__(self, session: AsyncSession, client: LiveKitAdminClient) -> None:
        self._session = session
        self._client = client

    async def evict_if_unauthorized(self, call_id: UUID, room: str, identity: str) -> bool:
        # A delayed event must authorize the current SFU session, not its old payload.
        try:
            live = await self._client.get_participant(room, identity)
        except LiveKitApiError as exc:
            if exc.status_code == 404:
                return False
            raise
        allowed = await self._is_allowed(call_id, room, identity, live)
        await self._session.commit()
        if allowed:
            return False
        try:
            current = await self._client.get_participant(room, identity)
            if current.get("sid") != live.get("sid"):
                return False
            await self._client.remove_participant(room, identity)
        except LiveKitApiError as exc:
            if exc.status_code != 404:
                raise
        return True

    async def _is_allowed(
        self, call_id: UUID, room: str, identity: str, live: dict[str, Any]
    ) -> bool:
        result = await self._session.execute(
            select(Call, CallParticipant)
            .join(CallParticipant, CallParticipant.call_id == Call.id)
            .where(
                Call.id == call_id,
                Call.livekit_room_name == room,
                Call.ended_at.is_(None),
                CallParticipant.identity == identity,
                CallParticipant.left_at.is_(None),
            )
            .execution_options(populate_existing=True)
        )
        row = result.one_or_none()
        if row is None:
            return False
        call, participant = row
        if not matches_media_session(live, participant.token_jti, participant.session_jti):
            return False
        if participant.auth_session_id is not None:
            auth_session = await self._session.scalar(
                select(UserSession.id).where(
                    UserSession.id == participant.auth_session_id,
                    UserSession.user_id == participant.user_id,
                    UserSession.is_revoked.is_(False),
                )
            )
            if auth_session is None:
                return False
        access = ChatAccessChecker(self._session)
        try:
            channel = await access.get_channel(call.channel_id, call.organization_id)
            await access.check_access(participant.user_id, call.organization_id, channel)
        except NotFoundError, PermissionDeniedError:
            return False
        return not channel.is_archived
