"""Thin ConnectRPC handlers for CallService."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.calls.v1.calls_pb import (
    CallAvailability,
    DeclineCallRequest,
    DeclineCallResponse,
    EndCallRequest,
    EndCallResponse,
    GetActiveCallRequest,
    GetActiveCallResponse,
    GetCallAvailabilityRequest,
    GetCallAvailabilityResponse,
    GetCallRecordRequest,
    GetCallRecordResponse,
    GetCallStateRequest,
    GetCallStateResponse,
    GetOrgCallPolicyRequest,
    GetOrgCallPolicyResponse,
    IceServer,
    InitiateCallRequest,
    InitiateCallResponse,
    JoinCallRequest,
    JoinCallResponse,
    KickParticipantRequest,
    KickParticipantResponse,
    LeaveCallRequest,
    LeaveCallResponse,
    ListActiveCallsRequest,
    ListActiveCallsResponse,
    ListCallHistoryRequest,
    ListCallHistoryResponse,
    MuteParticipantRequest,
    MuteParticipantResponse,
    RefreshCallTokenRequest,
    RefreshCallTokenResponse,
    ReportCallActivityRequest,
    ReportCallActivityResponse,
    ReportMediaStateRequest,
    ReportMediaStateResponse,
    SendCallReactionRequest,
    SendCallReactionResponse,
    SetCallModeRequest,
    SetCallModeResponse,
    SetCallSpeakerRequest,
    SetCallSpeakerResponse,
    SetHandRaisedRequest,
    SetHandRaisedResponse,
    UpdateOrgCallPolicyRequest,
    UpdateOrgCallPolicyResponse,
)
from uniffy_proto.calls.v1.calls_pb import IceTransportPolicy as _ProtoIceTransportPolicy

from uniffy.core.auth.principal import current_session_id, current_user_id
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.calls import ScreenShareQuality
from uniffy.core.models.chat.channel import ChannelType
from uniffy.domains.calls.activity import CallActivityOperations
from uniffy.domains.calls.config import LiveKitConfigError, get_livekit_config, get_turn_config
from uniffy.domains.calls.converters import call_to_proto, org_policy_to_proto, participant_to_proto
from uniffy.domains.calls.history import CallHistoryReader
from uniffy.domains.calls.invitations import CallInvitations
from uniffy.domains.calls.livekit import LiveKitUnavailableError
from uniffy.domains.calls.metrics import RINGS, RingOutcome
from uniffy.domains.calls.operations import CallOperations
from uniffy.domains.calls.participation import CallParticipation
from uniffy.domains.calls.publishing import CallPublishing, town_hall_allowed
from uniffy.domains.calls.reader import CallReader, probe_call_media
from uniffy.domains.calls.telemetry import call_context, observe_join
from uniffy.domains.calls.turn import mint_turn_credentials
from uniffy.infrastructure.database import open_session

logger = logger.bind(component="calls.handlers")


def _parse_uuid(value: str, field: str) -> UUID:
    try:
        return UUID(value)
    except ValueError as exc:
        raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid {field}: {exc}") from exc


def _require_device_id(value: str) -> str:
    device_id = value.strip()
    if not device_id or len(device_id) > 64:
        raise ConnectError(Code.INVALID_ARGUMENT, "Invalid device_id")
    return device_id


def _optional_device_label(request) -> str | None:
    if not request.has_field("device_label"):
        return None
    # Column cap; the label is display-only, so truncation beats rejection.
    return request.device_label[:120]


def _ice_fields(user_id: UUID) -> dict:
    """Kwargs for join-shaped responses: TURN relay config, or empty in direct mode."""
    config = get_turn_config()
    if config is None:
        return {}
    creds = mint_turn_credentials(user_id, config)
    return {
        "ice_servers": [
            IceServer(urls=list(creds.urls), username=creds.username, credential=creds.credential)
        ],
        "ice_transport_policy": _ProtoIceTransportPolicy.RELAY,
    }


def _map_domain_error(operation: str, exc: Exception) -> ConnectError:
    if isinstance(exc, NotFoundError):
        return ConnectError(Code.NOT_FOUND, str(exc) or "Not found")
    if isinstance(exc, ValidationError):
        return ConnectError(Code.INVALID_ARGUMENT, str(exc))
    if isinstance(exc, PermissionDeniedError):
        return ConnectError(Code.PERMISSION_DENIED, str(exc) or "Access denied")
    if isinstance(exc, LiveKitUnavailableError):
        return ConnectError(Code.UNAVAILABLE, "Calls are temporarily unavailable")
    if isinstance(exc, LiveKitConfigError):
        return ConnectError(Code.UNAVAILABLE, "Calls are not configured on this deployment")
    logger.exception(f"Error in {operation}: {exc}")
    return ConnectError(Code.INTERNAL, "Internal error")


class CallHandlers:
    async def list_call_history(
        self, request: ListCallHistoryRequest, ctx: RequestContext
    ) -> ListCallHistoryResponse:
        async with open_session() as session:
            records, cursor = await CallHistoryReader(session).list_history(
                current_user_id(),
                _parse_uuid(request.organization_id, "organization_id"),
                channel_id=_parse_uuid(request.channel_id, "channel_id")
                if request.has_field("channel_id")
                else None,
                cursor=request.cursor,
                page_size=request.page_size,
            )
            return ListCallHistoryResponse(records=records, next_cursor=cursor)

    async def report_call_activity(
        self, request: ReportCallActivityRequest, ctx: RequestContext
    ) -> ReportCallActivityResponse:
        async with open_session() as session:
            return await CallActivityOperations(session).report(
                current_user_id(),
                _parse_uuid(request.organization_id, "organization_id"),
                _parse_uuid(request.call_id, "call_id"),
                current_session_id(),
                _require_device_id(request.device_id),
                _parse_uuid(request.participant_id, "participant_id")
                if request.participant_id
                else None,
                list(request.chunks),
            )

    async def get_call_record(
        self, request: GetCallRecordRequest, ctx: RequestContext
    ) -> GetCallRecordResponse:
        async with open_session() as session:
            record, participants, cursor = await CallHistoryReader(session).get_record(
                current_user_id(),
                _parse_uuid(request.organization_id, "organization_id"),
                _parse_uuid(request.call_id, "call_id"),
                cursor=request.participant_cursor,
                page_size=request.page_size,
            )
            return GetCallRecordResponse(
                record=record, participants=participants, next_participant_cursor=cursor
            )

    @call_context
    async def get_call_availability(
        self, request: GetCallAvailabilityRequest, ctx: RequestContext
    ) -> GetCallAvailabilityResponse:
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        allowed = False
        async with open_session() as session:
            reader = CallReader(session)
            availability = await reader.availability(current_user_id(), organization_id)
            if request.channel_id:
                channel = await reader.access.get_channel(
                    _parse_uuid(request.channel_id, "channel_id"), organization_id
                )
                await reader.access.check_access(current_user_id(), organization_id, channel)
                allowed = (
                    channel.channel_type in (ChannelType.PUBLIC, ChannelType.PRIVATE)
                    and not channel.is_archived
                    and await town_hall_allowed(session, organization_id, channel.id)
                )
        if request.check_media and availability == CallAvailability.READY:
            availability = await probe_call_media()
        return GetCallAvailabilityResponse(availability=availability, town_hall_allowed=allowed)

    @call_context
    async def get_call_state(
        self, request: GetCallStateRequest, ctx: RequestContext
    ) -> GetCallStateResponse:
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        call_id = _parse_uuid(request.call_id, "call_id")
        async with open_session() as session:
            call, can_moderate = await CallReader(session).get_state(
                current_user_id(), organization_id, call_id
            )
            return GetCallStateResponse(call=call_to_proto(call, []), can_moderate=can_moderate)

    @call_context
    @observe_join
    async def initiate_call(
        self, request: InitiateCallRequest, ctx: RequestContext
    ) -> InitiateCallResponse:
        user_id = current_user_id()
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        channel_id = _parse_uuid(request.channel_id, "channel_id")
        device_id = _require_device_id(request.device_id)
        device_label = _optional_device_label(request)

        async with open_session() as session:
            try:
                ops = CallOperations(session)
                call, participants, token, joined_existing = await ops.initiate_call(
                    user_id,
                    organization_id,
                    channel_id,
                    device_id,
                    device_label,
                    current_session_id(),
                    town_hall=request.town_hall,
                    title=request.title if request.has_field("title") else None,
                    calendar_event_id=(
                        request.calendar_event_id if request.has_field("calendar_event_id") else None
                    ),
                )
                profiles = await ops.resolve_profiles([p.user_id for p in participants])
                cap = await ops.resolve_screen_share_ceiling(organization_id, call.call_type)
                ice_fields = _ice_fields(user_id)
            except Exception as exc:
                raise _map_domain_error("initiate_call", exc) from exc

        return InitiateCallResponse(
            call=call_to_proto(call, participants, profiles),
            ws_url=get_livekit_config().ws_url,
            livekit_token=token.token,
            joined_existing=joined_existing,
            screen_share_quality_cap=int(cap),
            **ice_fields,
        )

    @call_context
    @observe_join
    async def join_call(self, request: JoinCallRequest, ctx: RequestContext) -> JoinCallResponse:
        user_id = current_user_id()
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        call_id = _parse_uuid(request.call_id, "call_id")
        device_id = _require_device_id(request.device_id)
        device_label = _optional_device_label(request)

        async with open_session() as session:
            try:
                ops = CallOperations(session)
                call, participants, token = await ops.join_call(
                    user_id,
                    organization_id,
                    call_id,
                    device_id,
                    device_label,
                    current_session_id(),
                )
                profiles = await ops.resolve_profiles([p.user_id for p in participants])
                cap = await ops.resolve_screen_share_ceiling(organization_id, call.call_type)
                ice_fields = _ice_fields(user_id)
            except Exception as exc:
                raise _map_domain_error("join_call", exc) from exc

        return JoinCallResponse(
            call=call_to_proto(call, participants, profiles),
            ws_url=get_livekit_config().ws_url,
            livekit_token=token.token,
            screen_share_quality_cap=int(cap),
            **ice_fields,
        )

    @call_context
    async def leave_call(self, request: LeaveCallRequest, ctx: RequestContext) -> LeaveCallResponse:
        user_id = current_user_id()
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        call_id = _parse_uuid(request.call_id, "call_id")
        device_id = _require_device_id(request.device_id)

        async with open_session() as session:
            try:
                await CallOperations(session).leave_call(
                    user_id, organization_id, call_id, device_id
                )
            except Exception as exc:
                raise _map_domain_error("leave_call", exc) from exc
        return LeaveCallResponse(success=True)

    @call_context
    async def end_call(self, request: EndCallRequest, ctx: RequestContext) -> EndCallResponse:
        user_id = current_user_id()
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        call_id = _parse_uuid(request.call_id, "call_id")

        async with open_session() as session:
            try:
                await CallOperations(session).end_call(user_id, organization_id, call_id)
            except Exception as exc:
                raise _map_domain_error("end_call", exc) from exc
        return EndCallResponse(success=True)

    @call_context
    async def refresh_call_token(
        self, request: RefreshCallTokenRequest, ctx: RequestContext
    ) -> RefreshCallTokenResponse:
        user_id = current_user_id()
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        call_id = _parse_uuid(request.call_id, "call_id")
        device_id = _require_device_id(request.device_id)

        async with open_session() as session:
            try:
                token = await CallOperations(session).refresh_token(
                    user_id, organization_id, call_id, device_id, current_session_id()
                )
            except Exception as exc:
                raise _map_domain_error("refresh_call_token", exc) from exc
        return RefreshCallTokenResponse(livekit_token=token.token)

    @call_context
    async def get_active_call(
        self, request: GetActiveCallRequest, ctx: RequestContext
    ) -> GetActiveCallResponse:
        user_id = current_user_id()
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        channel_id = _parse_uuid(request.channel_id, "channel_id")

        async with open_session() as session:
            try:
                ops = CallOperations(session)
                found = await ops.get_active_call(user_id, organization_id, channel_id)
                if found is None:
                    return GetActiveCallResponse()
                call, participants = found
                profiles = await ops.resolve_profiles([p.user_id for p in participants])
            except Exception as exc:
                raise _map_domain_error("get_active_call", exc) from exc

        return GetActiveCallResponse(call=call_to_proto(call, participants, profiles))

    @call_context
    async def list_active_calls(
        self, request: ListActiveCallsRequest, ctx: RequestContext
    ) -> ListActiveCallsResponse:
        user_id = current_user_id()
        organization_id = _parse_uuid(request.organization_id, "organization_id")

        async with open_session() as session:
            try:
                ops = CallOperations(session)
                found = await ops.list_active_calls_for_user(user_id, organization_id)
                user_ids = {p.user_id for _, participants in found for p in participants}
                profiles = await ops.resolve_profiles(list(user_ids))
            except Exception as exc:
                raise _map_domain_error("list_active_calls", exc) from exc

        return ListActiveCallsResponse(
            calls=[call_to_proto(call, participants, profiles) for call, participants in found]
        )

    @call_context
    async def decline_call(
        self, request: DeclineCallRequest, ctx: RequestContext
    ) -> DeclineCallResponse:
        user_id = current_user_id()
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        call_id = _parse_uuid(request.call_id, "call_id")
        async with open_session() as session:
            try:
                await CallInvitations(session).decline(user_id, organization_id, call_id)
            except Exception as exc:
                raise _map_domain_error("decline_call", exc) from exc
        RINGS.labels(RingOutcome.DECLINED).inc()
        logger.info("Call ring declined")
        return DeclineCallResponse(success=True)

    @call_context
    async def kick_participant(
        self, request: KickParticipantRequest, ctx: RequestContext
    ) -> KickParticipantResponse:
        user_id = current_user_id()
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        call_id = _parse_uuid(request.call_id, "call_id")

        async with open_session() as session:
            try:
                await CallOperations(session).kick_participant(
                    user_id, organization_id, call_id, request.identity
                )
            except Exception as exc:
                raise _map_domain_error("kick_participant", exc) from exc
        return KickParticipantResponse(success=True)

    @call_context
    async def mute_participant(
        self, request: MuteParticipantRequest, ctx: RequestContext
    ) -> MuteParticipantResponse:
        user_id = current_user_id()
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        call_id = _parse_uuid(request.call_id, "call_id")

        async with open_session() as session:
            try:
                await CallOperations(session).mute_participant(
                    user_id, organization_id, call_id, request.identity
                )
            except Exception as exc:
                raise _map_domain_error("mute_participant", exc) from exc
        return MuteParticipantResponse(success=True)

    @call_context
    async def get_org_call_policy(
        self, request: GetOrgCallPolicyRequest, ctx: RequestContext
    ) -> GetOrgCallPolicyResponse:
        user_id = current_user_id()
        organization_id = _parse_uuid(request.organization_id, "organization_id")

        async with open_session() as session:
            try:
                policy = await CallOperations(session).get_org_policy_view(user_id, organization_id)
            except Exception as exc:
                raise _map_domain_error("get_org_call_policy", exc) from exc
        return GetOrgCallPolicyResponse(policy=org_policy_to_proto(policy))

    @call_context
    async def update_org_call_policy(
        self, request: UpdateOrgCallPolicyRequest, ctx: RequestContext
    ) -> UpdateOrgCallPolicyResponse:
        user_id = current_user_id()
        organization_id = _parse_uuid(request.organization_id, "organization_id")

        async with open_session() as session:
            try:
                policy = await CallOperations(session).update_org_policy(
                    user_id,
                    organization_id,
                    calls_enabled=request.calls_enabled,
                    town_hall_enabled=request.town_hall_enabled
                    if request.has_field("town_hall_enabled")
                    else None,
                    town_hall_channel_ids=tuple(
                        str(_parse_uuid(uid, "channel_id")) for uid in request.town_hall_channel_ids
                    )
                    if request.has_field("town_hall_enabled")
                    else None,
                    max_participants=request.max_participants,
                    max_duration_minutes=request.max_duration_minutes,
                    max_screen_share_quality_direct=ScreenShareQuality(
                        request.max_screen_share_quality_direct
                    ),
                    max_screen_share_quality_group=ScreenShareQuality(
                        request.max_screen_share_quality_group
                    ),
                    max_screen_share_quality_channel=ScreenShareQuality(
                        request.max_screen_share_quality_channel
                    ),
                )
            except Exception as exc:
                raise _map_domain_error("update_org_call_policy", exc) from exc
        return UpdateOrgCallPolicyResponse(policy=org_policy_to_proto(policy))

    @call_context
    async def report_media_state(
        self, request: ReportMediaStateRequest, ctx: RequestContext
    ) -> ReportMediaStateResponse:
        user_id = current_user_id()
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        call_id = _parse_uuid(request.call_id, "call_id")
        device_id = _require_device_id(request.device_id)

        async with open_session() as session:
            try:
                await CallOperations(session).update_media_state(
                    user_id,
                    organization_id,
                    call_id,
                    device_id,
                    mic_enabled=request.mic_enabled,
                    camera_enabled=request.camera_enabled,
                    screen_sharing=request.screen_sharing,
                )
            except Exception as exc:
                raise _map_domain_error("report_media_state", exc) from exc
        return ReportMediaStateResponse(success=True)

    async def set_hand_raised(
        self, request: SetHandRaisedRequest, ctx: RequestContext
    ) -> SetHandRaisedResponse:
        async with open_session() as session:
            participation = CallParticipation(session)
            participant = await participation.set_hand(
                current_user_id(),
                _parse_uuid(request.organization_id, "organization_id"),
                _parse_uuid(request.call_id, "call_id"),
                _require_device_id(request.device_id),
                current_session_id(),
                raised=request.raised,
                identity=request.identity or None,
            )
            profile = await participation.calls.chat.resolve_profile(participant.user_id)
            return SetHandRaisedResponse(
                participant=participant_to_proto(
                    participant,
                    profile.display_name,
                    profile.avatar_url,
                )
            )

    async def send_call_reaction(
        self, request: SendCallReactionRequest, ctx: RequestContext
    ) -> SendCallReactionResponse:
        async with open_session() as session:
            await CallParticipation(session).react(
                current_user_id(),
                _parse_uuid(request.organization_id, "organization_id"),
                _parse_uuid(request.call_id, "call_id"),
                _require_device_id(request.device_id),
                current_session_id(),
                reaction=request.reaction,
            )
        return SendCallReactionResponse()

    async def set_call_mode(
        self, request: SetCallModeRequest, ctx: RequestContext
    ) -> SetCallModeResponse:
        async with open_session() as session:
            try:
                call = await CallPublishing(session).set_mode(
                    current_user_id(),
                    _parse_uuid(request.organization_id, "organization_id"),
                    _parse_uuid(request.call_id, "call_id"),
                    town_hall=request.town_hall,
                )
                ops = CallOperations(session)
                participants = await ops.list_active_participants(call.id)
                profiles = await ops.resolve_profiles([p.user_id for p in participants])
                return SetCallModeResponse(call=call_to_proto(call, participants, profiles))
            except Exception as exc:
                raise _map_domain_error("set_call_mode", exc) from exc

    async def set_call_speaker(
        self, request: SetCallSpeakerRequest, ctx: RequestContext
    ) -> SetCallSpeakerResponse:
        async with open_session() as session:
            try:
                call = await CallPublishing(session).set_speaker(
                    current_user_id(),
                    _parse_uuid(request.organization_id, "organization_id"),
                    _parse_uuid(request.call_id, "call_id"),
                    _parse_uuid(request.user_id, "user_id"),
                    speaker=request.speaker,
                )
                ops = CallOperations(session)
                participants = await ops.list_active_participants(call.id)
                profiles = await ops.resolve_profiles([p.user_id for p in participants])
                return SetCallSpeakerResponse(call=call_to_proto(call, participants, profiles))
            except Exception as exc:
                raise _map_domain_error("set_call_speaker", exc) from exc
