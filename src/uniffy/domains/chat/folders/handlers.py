"""Agent-chat folder RPC handlers."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.chat.v1.chat_pb2 import (
    AgentChatFolder,
    CreateAgentFolderRequest,
    CreateAgentFolderResponse,
    DeleteAgentFolderRequest,
    DeleteAgentFolderResponse,
    ListAgentFoldersRequest,
    ListAgentFoldersResponse,
    RenameAgentFolderRequest,
    RenameAgentFolderResponse,
    SetAgentChatFolderRequest,
    SetAgentChatFolderResponse,
)

from uniffy.core.auth.principal import current_user_id, resolve_organization_id
from uniffy.core.errors import NotFoundError, ValidationError
from uniffy.core.models.chat.agent_folder import ChatAgentFolder
from uniffy.db import open_session
from uniffy.domains.chat.folders.operations import AgentFolderOperations

logger = logger.bind(component="chat.folders.handlers")


def _folder_to_proto(folder: ChatAgentFolder) -> AgentChatFolder:
    return AgentChatFolder(id=str(folder.id), name=folder.name, position=folder.position)


def _handle_error(e: Exception) -> None:
    if isinstance(e, NotFoundError):
        raise ConnectError(Code.NOT_FOUND, str(e))
    if isinstance(e, ValidationError):
        raise ConnectError(Code.INVALID_ARGUMENT, str(e))
    logger.exception(f"Unexpected error: {e}")
    raise ConnectError(Code.INTERNAL, "Internal error")


class AgentFolderHandlers:
    async def create_agent_folder(
        self,
        request: CreateAgentFolderRequest,
        ctx: RequestContext,
    ) -> CreateAgentFolderResponse:
        user_id = current_user_id()
        try:
            org_id = resolve_organization_id(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        try:
            async with open_session() as session:
                ops = AgentFolderOperations(session)
                folder = await ops.create(user_id, org_id, request.name)
                return CreateAgentFolderResponse(folder=_folder_to_proto(folder))
        except (ValidationError, NotFoundError) as e:
            _handle_error(e)

    async def rename_agent_folder(
        self,
        request: RenameAgentFolderRequest,
        ctx: RequestContext,
    ) -> RenameAgentFolderResponse:
        user_id = current_user_id()
        try:
            org_id = resolve_organization_id(request.organization_id)
            folder_id = UUID(request.folder_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async with open_session() as session:
                ops = AgentFolderOperations(session)
                folder = await ops.rename(user_id, org_id, folder_id, request.name)
                return RenameAgentFolderResponse(folder=_folder_to_proto(folder))
        except (ValidationError, NotFoundError) as e:
            _handle_error(e)

    async def delete_agent_folder(
        self,
        request: DeleteAgentFolderRequest,
        ctx: RequestContext,
    ) -> DeleteAgentFolderResponse:
        user_id = current_user_id()
        try:
            org_id = resolve_organization_id(request.organization_id)
            folder_id = UUID(request.folder_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async with open_session() as session:
                ops = AgentFolderOperations(session)
                await ops.delete(user_id, org_id, folder_id)
                return DeleteAgentFolderResponse()
        except (ValidationError, NotFoundError) as e:
            _handle_error(e)

    async def list_agent_folders(
        self,
        request: ListAgentFoldersRequest,
        ctx: RequestContext,
    ) -> ListAgentFoldersResponse:
        user_id = current_user_id()
        try:
            org_id = resolve_organization_id(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        async with open_session() as session:
            ops = AgentFolderOperations(session)
            folders = await ops.list_folders(user_id, org_id)
            return ListAgentFoldersResponse(folders=[_folder_to_proto(f) for f in folders])

    async def set_agent_chat_folder(
        self,
        request: SetAgentChatFolderRequest,
        ctx: RequestContext,
    ) -> SetAgentChatFolderResponse:
        user_id = current_user_id()
        try:
            org_id = resolve_organization_id(request.organization_id)
            channel_id = UUID(request.channel_id)
            folder_id = (
                UUID(request.folder_id)
                if request.HasField("folder_id") and request.folder_id
                else None
            )
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async with open_session() as session:
                ops = AgentFolderOperations(session)
                await ops.set_chat_folder(user_id, org_id, channel_id, folder_id)
                return SetAgentChatFolderResponse()
        except (ValidationError, NotFoundError) as e:
            _handle_error(e)
