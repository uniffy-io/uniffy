"""Presence RPC handlers - thin layer delegating to operations."""

from datetime import UTC, datetime
from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from google.protobuf.timestamp_pb2 import Timestamp
from loguru import logger
from uniffy_proto.presence.v1.presence_pb2 import (
    ClearCustomStatusRequest,
    ClearCustomStatusResponse,
    GetBulkPresenceRequest,
    GetBulkPresenceResponse,
    SetCustomStatusRequest,
    SetCustomStatusResponse,
    SetPresenceRequest,
    SetPresenceResponse,
    UserPresence,
)

from uniffy.db import open_session
from uniffy.domains.auth.context import (
    get_organization_id_from_context,
    get_user_id_from_context,
)
from uniffy.domains.presence.converters import (
    proto_status_to_string,
    string_to_proto_status,
)
from uniffy.domains.presence.operations import PresenceOperations


class PresenceHandlers:
    async def set_presence(
        self,
        request: SetPresenceRequest,
        ctx: RequestContext,
    ) -> SetPresenceResponse:
        """Heartbeat; publishes a change event when the status differs from the previous value."""
        user_id = get_user_id_from_context(ctx)

        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id format")

        status_string = proto_status_to_string(request.status)
        client = request.client or "web"

        try:
            async with open_session() as session:
                ops = PresenceOperations(session)
                await ops.set_presence(user_id, organization_id, status_string, client)
                return SetPresenceResponse()

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error setting presence: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_bulk_presence(
        self,
        request: GetBulkPresenceRequest,
        ctx: RequestContext,
    ) -> GetBulkPresenceResponse:
        get_user_id_from_context(ctx)

        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id format")

        if len(request.user_ids) > 200:
            raise ConnectError(
                Code.INVALID_ARGUMENT,
                "Maximum 200 user IDs per request",
            )

        try:
            async with open_session() as session:
                ops = PresenceOperations(session)
                results = await ops.get_bulk_presence(
                    organization_id,
                    [UUID(uid) for uid in request.user_ids],
                )

                response = GetBulkPresenceResponse()
                for uid, data in results.items():
                    # Protobuf maps don't allow direct message assignment; access in-place.
                    presence = response.presences[uid]
                    presence.status = string_to_proto_status(
                        data.get("status", "offline"),
                    )

                    last_active = data.get("last_active")
                    if last_active:
                        ts = Timestamp()
                        ts.FromDatetime(datetime.fromisoformat(last_active))
                        presence.last_active.CopyFrom(ts)

                    custom = data.get("custom_status")
                    if custom:
                        presence.status_emoji = custom.get("emoji", "")
                        presence.status_text = custom.get("text", "")
                        if custom.get("expires_at"):
                            exp_ts = Timestamp()
                            exp_ts.FromDatetime(
                                datetime.fromisoformat(custom["expires_at"]),
                            )
                            presence.status_expires_at.CopyFrom(exp_ts)

                return response

        except ConnectError:
            raise
        except ValueError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except Exception as e:
            logger.error(f"Error getting bulk presence: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def set_custom_status(
        self,
        request: SetCustomStatusRequest,
        ctx: RequestContext,
    ) -> SetCustomStatusResponse:
        user_id = get_user_id_from_context(ctx)
        organization_id = get_organization_id_from_context(ctx)

        if not request.text and not request.emoji:
            raise ConnectError(
                Code.INVALID_ARGUMENT,
                "Either emoji or text is required",
            )

        expires_at = None
        if request.HasField("expires_at"):
            expires_at = request.expires_at.ToDatetime().replace(tzinfo=UTC)

        try:
            async with open_session() as session:
                ops = PresenceOperations(session)
                custom_data = await ops.set_custom_status(
                    user_id,
                    organization_id,
                    request.emoji,
                    request.text,
                    expires_at,
                )

                presence = UserPresence(
                    status_emoji=custom_data.get("emoji", ""),
                    status_text=custom_data.get("text", ""),
                )
                if custom_data.get("expires_at"):
                    ts = Timestamp()
                    ts.FromDatetime(datetime.fromisoformat(custom_data["expires_at"]))
                    presence.status_expires_at.CopyFrom(ts)

                return SetCustomStatusResponse(presence=presence)

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error setting custom status: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def clear_custom_status(
        self,
        request: ClearCustomStatusRequest,
        ctx: RequestContext,
    ) -> ClearCustomStatusResponse:
        user_id = get_user_id_from_context(ctx)
        organization_id = get_organization_id_from_context(ctx)

        try:
            async with open_session() as session:
                ops = PresenceOperations(session)
                await ops.clear_custom_status(user_id, organization_id)
                return ClearCustomStatusResponse()

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error clearing custom status: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")
