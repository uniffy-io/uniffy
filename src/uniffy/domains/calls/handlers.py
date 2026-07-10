"""Thin ConnectRPC handlers for CallService."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.calls.v1.calls_pb2 import (
    DeclineCallRequest,
    DeclineCallResponse,
    EndCallRequest,
    EndCallResponse,
    GetActiveCallRequest,
    GetActiveCallResponse,
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
    MuteParticipantRequest,
    MuteParticipantResponse,
    RefreshCallTokenRequest,
    RefreshCallTokenResponse,
    ReportMediaStateRequest,
    ReportMediaStateResponse,
)

from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.db import open_session
from uniffy.domains.auth.context import get_user_id_from_context
from uniffy.domains.calls.config import LiveKitConfigError, get_livekit_config
from uniffy.domains.calls.converters import call_to_proto
from uniffy.domains.calls.livekit_client import LiveKitUnavailableError
from uniffy.domains.calls.operations import CallOperations

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
    if not request.HasField("device_label"):
        return None
    # Column cap; the label is display-only, so truncation beats rejection.
    return request.device_label[:120]


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
    async def initiate_call(
        self, request: InitiateCallRequest, ctx: RequestContext
    ) -> InitiateCallResponse:
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        channel_id = _parse_uuid(request.channel_id, "channel_id")
        device_id = _require_device_id(request.device_id)
        device_label = _optional_device_label(request)

        async with open_session() as session:
            try:
                ops = CallOperations(session)
                call, participants, token, joined_existing = await ops.initiate_call(
                    user_id, organization_id, channel_id, device_id, device_label
                )
                profiles = await ops.resolve_profiles([p.user_id for p in participants])
            except Exception as exc:
                raise _map_domain_error("initiate_call", exc) from exc

        return InitiateCallResponse(
            call=call_to_proto(call, participants, profiles),
            ws_url=get_livekit_config().ws_url,
            livekit_token=token.token,
            joined_existing=joined_existing,
        )

    async def join_call(self, request: JoinCallRequest, ctx: RequestContext) -> JoinCallResponse:
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        call_id = _parse_uuid(request.call_id, "call_id")
        device_id = _require_device_id(request.device_id)
        device_label = _optional_device_label(request)

        async with open_session() as session:
            try:
                ops = CallOperations(session)
                call, participants, token = await ops.join_call(
                    user_id, organization_id, call_id, device_id, device_label
                )
                profiles = await ops.resolve_profiles([p.user_id for p in participants])
            except Exception as exc:
                raise _map_domain_error("join_call", exc) from exc

        return JoinCallResponse(
            call=call_to_proto(call, participants, profiles),
            ws_url=get_livekit_config().ws_url,
            livekit_token=token.token,
        )

    async def leave_call(
        self, request: LeaveCallRequest, ctx: RequestContext
    ) -> LeaveCallResponse:
        user_id = get_user_id_from_context(ctx)
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

    async def end_call(self, request: EndCallRequest, ctx: RequestContext) -> EndCallResponse:
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        call_id = _parse_uuid(request.call_id, "call_id")

        async with open_session() as session:
            try:
                await CallOperations(session).end_call(user_id, organization_id, call_id)
            except Exception as exc:
                raise _map_domain_error("end_call", exc) from exc
        return EndCallResponse(success=True)

    async def refresh_call_token(
        self, request: RefreshCallTokenRequest, ctx: RequestContext
    ) -> RefreshCallTokenResponse:
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        call_id = _parse_uuid(request.call_id, "call_id")
        device_id = _require_device_id(request.device_id)

        async with open_session() as session:
            try:
                token = await CallOperations(session).refresh_token(
                    user_id, organization_id, call_id, device_id
                )
            except Exception as exc:
                raise _map_domain_error("refresh_call_token", exc) from exc
        return RefreshCallTokenResponse(livekit_token=token.token)

    async def get_active_call(
        self, request: GetActiveCallRequest, ctx: RequestContext
    ) -> GetActiveCallResponse:
        user_id = get_user_id_from_context(ctx)
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

    async def list_active_calls(
        self, request: ListActiveCallsRequest, ctx: RequestContext
    ) -> ListActiveCallsResponse:
        user_id = get_user_id_from_context(ctx)
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

    async def decline_call(
        self, request: DeclineCallRequest, ctx: RequestContext
    ) -> DeclineCallResponse:
        # Acknowledge-only until missed-call records land with the push flow;
        # the caller's ring toast dismisses locally on timeout.
        get_user_id_from_context(ctx)
        _parse_uuid(request.organization_id, "organization_id")
        _parse_uuid(request.call_id, "call_id")
        return DeclineCallResponse(success=True)

    async def kick_participant(
        self, request: KickParticipantRequest, ctx: RequestContext
    ) -> KickParticipantResponse:
        user_id = get_user_id_from_context(ctx)
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

    async def mute_participant(
        self, request: MuteParticipantRequest, ctx: RequestContext
    ) -> MuteParticipantResponse:
        user_id = get_user_id_from_context(ctx)
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

    async def report_media_state(
        self, request: ReportMediaStateRequest, ctx: RequestContext
    ) -> ReportMediaStateResponse:
        user_id = get_user_id_from_context(ctx)
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
