"""Chat draft RPC handlers."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from google.protobuf.timestamp_pb2 import Timestamp
from loguru import logger
from uniffy_proto.chat.v1.chat_pb2 import (
    ChatDraft as ProtoChatDraft,
)
from uniffy_proto.chat.v1.chat_pb2 import (
    DeleteDraftRequest,
    DeleteDraftResponse,
    ListDraftsRequest,
    ListDraftsResponse,
    SaveDraftRequest,
    SaveDraftResponse,
)

from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.chat.draft import ChatDraft
from uniffy.db import open_session
from uniffy.domains.auth.context import get_user_id_from_context
from uniffy.domains.chat.drafts.operations import ChatDraftOperations

logger = logger.bind(component="chat.drafts.handlers")


def _handle_error(e: Exception) -> None:
    if isinstance(e, NotFoundError):
        raise ConnectError(Code.NOT_FOUND, str(e))
    if isinstance(e, PermissionDeniedError):
        raise ConnectError(Code.PERMISSION_DENIED, str(e))
    if isinstance(e, ValidationError):
        raise ConnectError(Code.INVALID_ARGUMENT, str(e))
    logger.exception("Unexpected error in drafts handler")
    raise ConnectError(Code.INTERNAL, "Internal error")


def draft_to_proto(draft: ChatDraft) -> ProtoChatDraft:
    proto = ProtoChatDraft(
        channel_id=str(draft.channel_id),
        content=draft.content,
    )
    if draft.root_message_id is not None:
        proto.root_message_id = str(draft.root_message_id)
    if draft.updated_at is not None:
        ts = Timestamp()
        ts.FromDatetime(draft.updated_at)
        proto.updated_at.CopyFrom(ts)
    return proto


def _parse_root_message_id(request: SaveDraftRequest | DeleteDraftRequest) -> UUID | None:
    if not request.HasField("root_message_id"):
        return None
    try:
        return UUID(request.root_message_id)
    except ValueError:
        raise ConnectError(Code.INVALID_ARGUMENT, "Invalid root_message_id")


class DraftHandlers:
    async def save_draft(
        self,
        request: SaveDraftRequest,
        ctx: RequestContext,
    ) -> SaveDraftResponse:
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
            channel_id = UUID(request.channel_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")
        root_message_id = _parse_root_message_id(request)

        try:
            async with open_session() as session:
                ops = ChatDraftOperations(session)
                draft = await ops.save_draft(
                    user_id=user_id,
                    organization_id=org_id,
                    channel_id=channel_id,
                    root_message_id=root_message_id,
                    content=request.content,
                    client_session_id=request.client_session_id,
                )
                return SaveDraftResponse(draft=draft_to_proto(draft))
        except (NotFoundError, PermissionDeniedError, ValidationError) as e:
            _handle_error(e)

    async def delete_draft(
        self,
        request: DeleteDraftRequest,
        ctx: RequestContext,
    ) -> DeleteDraftResponse:
        user_id = get_user_id_from_context(ctx)
        try:
            channel_id = UUID(request.channel_id)
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")
        root_message_id = _parse_root_message_id(request)

        try:
            async with open_session() as session:
                ops = ChatDraftOperations(session)
                await ops.delete_draft(
                    user_id=user_id,
                    organization_id=org_id,
                    channel_id=channel_id,
                    root_message_id=root_message_id,
                    client_session_id=request.client_session_id,
                )
                return DeleteDraftResponse()
        except (NotFoundError, PermissionDeniedError, ValidationError) as e:
            _handle_error(e)

    async def list_drafts(
        self,
        request: ListDraftsRequest,
        ctx: RequestContext,
    ) -> ListDraftsResponse:
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        try:
            async with open_session() as session:
                ops = ChatDraftOperations(session)
                drafts = await ops.list_drafts(user_id, org_id)
                return ListDraftsResponse(drafts=[draft_to_proto(d) for d in drafts])
        except (NotFoundError, PermissionDeniedError, ValidationError) as e:
            _handle_error(e)
