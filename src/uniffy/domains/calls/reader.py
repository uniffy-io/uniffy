from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uniffy_proto.calls.v1.calls_pb import CallAvailability

from uniffy.core.errors import NotFoundError
from uniffy.core.models.calls import Call
from uniffy.domains.calls.config import LiveKitConfigError, get_livekit_config, get_turn_config
from uniffy.domains.calls.livekit import LiveKitApiError, get_livekit_admin_client
from uniffy.domains.calls.policy import load_call_policy
from uniffy.domains.chat.access import ChatAccessChecker


class CallReader:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.access = ChatAccessChecker(session)

    async def availability(self, user_id: UUID, organization_id: UUID) -> CallAvailability:
        await self.access.require_org_member(user_id, organization_id)
        policy = await load_call_policy(self.session, organization_id)
        if policy is not None and not policy.calls_enabled:
            return CallAvailability.DISABLED
        try:
            get_livekit_config()
            get_turn_config()
        except LiveKitConfigError:
            return CallAvailability.NOT_CONFIGURED
        return CallAvailability.READY

    async def get_state(
        self, user_id: UUID, organization_id: UUID, call_id: UUID
    ) -> tuple[Call, bool]:
        call = await self.session.scalar(
            select(Call).where(Call.id == call_id, Call.organization_id == organization_id)
        )
        if call is None:
            raise NotFoundError("call", call_id)
        channel = await self.access.get_channel(call.channel_id, organization_id)
        await self.access.check_access(user_id, organization_id, channel)
        can_moderate = call.host_user_id == user_id or await self.access.require_elevated(
            user_id, organization_id, call.channel_id
        )
        return call, can_moderate


async def probe_call_media() -> CallAvailability:
    try:
        await get_livekit_admin_client().list_rooms(names=["uniffy-health-check"])
    except LiveKitApiError, LiveKitConfigError:
        return CallAvailability.UNREACHABLE
    return CallAvailability.READY
