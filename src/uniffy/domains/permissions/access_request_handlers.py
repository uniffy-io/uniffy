"""ConnectRPC handlers for content access requests."""

from math import ceil
from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.common.v1.common_pb2 import PaginationResponse
from uniffy_proto.permissions.v1.permissions_pb2 import (
    ACCESS_REQUEST_DECISION_APPROVE,
    ACCESS_REQUEST_DECISION_DENY,
    ACCESS_REQUEST_STATE_APPROVED,
    ACCESS_REQUEST_STATE_CANCELED,
    ACCESS_REQUEST_STATE_DENIED,
    ACCESS_REQUEST_STATE_PENDING,
    CancelAccessRequestRequest,
    CancelAccessRequestResponse,
    GetAccessRequestRequest,
    GetAccessRequestResponse,
    GetMyAccessRequestStatusesRequest,
    GetMyAccessRequestStatusesResponse,
    ListAccessRequestsRequest,
    ListAccessRequestsResponse,
    RequestAccessRequest,
    RequestAccessResponse,
    RespondToAccessRequestRequest,
    RespondToAccessRequestResponse,
)

from uniffy.core.converters.common_proto import content_role_from_proto, content_type_from_proto
from uniffy.core.converters.proto import optional_timestamp
from uniffy.core.errors import (
    ConflictError,
    NotFoundError,
    PermissionDeniedError,
    RateLimitExceededError,
    ValidationError,
)
from uniffy.core.models.permissions.content_access_request import ContentAccessRequestState
from uniffy.core.types import ContentRole, ContentType
from uniffy.db import open_session
from uniffy.domains.auth.context import get_user_id_from_context
from uniffy.domains.permissions.access_requests import (
    AccessRequestDecision,
    ContentAccessRequestOperations,
)
from uniffy.domains.permissions.converters import (
    access_request_outcome_to_proto,
    access_request_status_to_proto,
    access_request_view_to_proto,
)

logger = logger.bind(component="permissions.access_request_handlers")


def _parse_uuid(value: str, field: str) -> UUID:
    try:
        return UUID(value)
    except ValueError as exc:
        raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid {field}") from exc


def _resolve_content_type(proto_type: int) -> ContentType:
    content_type = content_type_from_proto(proto_type)
    if content_type is None:
        raise ConnectError(Code.INVALID_ARGUMENT, "Invalid content type")
    return content_type


def _resolve_role(proto_role: int) -> ContentRole:
    role = content_role_from_proto(proto_role)
    if role is None:
        raise ConnectError(Code.INVALID_ARGUMENT, "Invalid content role")
    return role


def _map_domain_error(exc: Exception) -> ConnectError:
    if isinstance(exc, PermissionDeniedError):
        return ConnectError(Code.PERMISSION_DENIED, str(exc))
    if isinstance(exc, NotFoundError):
        return ConnectError(Code.NOT_FOUND, str(exc))
    if isinstance(exc, ValidationError):
        return ConnectError(Code.INVALID_ARGUMENT, str(exc))
    if isinstance(exc, ConflictError):
        return ConnectError(Code.ABORTED, str(exc))
    if isinstance(exc, RateLimitExceededError):
        return ConnectError(Code.RESOURCE_EXHAUSTED, str(exc))
    logger.exception("Unhandled error in access request handler")
    return ConnectError(Code.INTERNAL, "Internal server error")


def _state_from_proto(value: int) -> ContentAccessRequestState:
    mapping = {
        ACCESS_REQUEST_STATE_PENDING: ContentAccessRequestState.PENDING,
        ACCESS_REQUEST_STATE_APPROVED: ContentAccessRequestState.APPROVED,
        ACCESS_REQUEST_STATE_DENIED: ContentAccessRequestState.DENIED,
        ACCESS_REQUEST_STATE_CANCELED: ContentAccessRequestState.CANCELED,
    }
    state = mapping.get(value)
    if state is None:
        raise ConnectError(Code.INVALID_ARGUMENT, "Invalid access request state")
    return state


def _decision_from_proto(value: int) -> AccessRequestDecision:
    if value == ACCESS_REQUEST_DECISION_APPROVE:
        return AccessRequestDecision.APPROVE
    if value == ACCESS_REQUEST_DECISION_DENY:
        return AccessRequestDecision.DENY
    raise ConnectError(Code.INVALID_ARGUMENT, "Invalid access request decision")


class AccessRequestHandlers:
    async def request_access(
        self,
        request: RequestAccessRequest,
        ctx: RequestContext,
    ) -> RequestAccessResponse:
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        try:
            async with open_session() as session:
                result = await ContentAccessRequestOperations(session).request_access(
                    requester_id=user_id,
                    organization_id=organization_id,
                    requested_urn=request.requested_urn,
                    message=request.message,
                )
                response = RequestAccessResponse(
                    outcome=access_request_outcome_to_proto(result.outcome)
                )
                if result.view is not None:
                    response.access_request.CopyFrom(access_request_view_to_proto(result.view))
                retry_at = optional_timestamp(result.can_request_again_at)
                if retry_at is not None:
                    response.can_request_again_at.CopyFrom(retry_at)
                return response
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc

    async def get_my_access_request_statuses(
        self,
        request: GetMyAccessRequestStatusesRequest,
        ctx: RequestContext,
    ) -> GetMyAccessRequestStatusesResponse:
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        try:
            async with open_session() as session:
                statuses = await ContentAccessRequestOperations(session).get_my_statuses(
                    requester_id=user_id,
                    organization_id=organization_id,
                    requested_urns=list(request.requested_urns),
                )
                response = GetMyAccessRequestStatusesResponse()
                response.statuses.extend(
                    access_request_status_to_proto(status) for status in statuses
                )
                return response
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc

    async def get_access_request(
        self,
        request: GetAccessRequestRequest,
        ctx: RequestContext,
    ) -> GetAccessRequestResponse:
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        request_id = _parse_uuid(request.request_id, "request_id")
        try:
            async with open_session() as session:
                view = await ContentAccessRequestOperations(session).get_access_request(
                    actor_user_id=user_id,
                    organization_id=organization_id,
                    request_id=request_id,
                )
                return GetAccessRequestResponse(access_request=access_request_view_to_proto(view))
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc

    async def list_access_requests(
        self,
        request: ListAccessRequestsRequest,
        ctx: RequestContext,
    ) -> ListAccessRequestsResponse:
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        canonical_content_type = None
        if request.HasField("canonical_content_type"):
            canonical_content_type = _resolve_content_type(request.canonical_content_type)
        canonical_content_id = None
        if request.HasField("canonical_content_id"):
            canonical_content_id = _parse_uuid(
                request.canonical_content_id,
                "canonical_content_id",
            )
        state = _state_from_proto(request.state) if request.HasField("state") else None

        page = 1
        page_size = 50
        if request.HasField("pagination"):
            page = max(request.pagination.page, 1)
            page_size = min(max(request.pagination.page_size, 1), 100)

        try:
            async with open_session() as session:
                result = await ContentAccessRequestOperations(session).list_access_requests(
                    actor_user_id=user_id,
                    organization_id=organization_id,
                    canonical_content_type=canonical_content_type,
                    canonical_content_id=canonical_content_id,
                    state=state,
                    page=page,
                    page_size=page_size,
                )
                response = ListAccessRequestsResponse(
                    pagination=PaginationResponse(
                        page=result.page,
                        page_size=result.page_size,
                        total_count=result.total_items,
                        total_pages=(
                            ceil(result.total_items / result.page_size) if result.total_items else 0
                        ),
                    )
                )
                response.access_requests.extend(
                    access_request_view_to_proto(view) for view in result.requests
                )
                return response
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc

    async def respond_to_access_request(
        self,
        request: RespondToAccessRequestRequest,
        ctx: RequestContext,
    ) -> RespondToAccessRequestResponse:
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        request_id = _parse_uuid(request.request_id, "request_id")
        decision = _decision_from_proto(request.decision)
        approved_role = (
            _resolve_role(request.approved_role) if request.HasField("approved_role") else None
        )
        try:
            async with open_session() as session:
                view = await ContentAccessRequestOperations(session).respond(
                    actor_user_id=user_id,
                    organization_id=organization_id,
                    request_id=request_id,
                    decision=decision,
                    approved_role=approved_role,
                    decision_note=request.decision_note,
                )
                return RespondToAccessRequestResponse(
                    access_request=access_request_view_to_proto(view)
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc

    async def cancel_access_request(
        self,
        request: CancelAccessRequestRequest,
        ctx: RequestContext,
    ) -> CancelAccessRequestResponse:
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        request_id = _parse_uuid(request.request_id, "request_id")
        try:
            async with open_session() as session:
                view = await ContentAccessRequestOperations(session).cancel(
                    requester_id=user_id,
                    organization_id=organization_id,
                    request_id=request_id,
                )
                return CancelAccessRequestResponse(access_request=access_request_view_to_proto(view))
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc
