"""Agent skills RPC handlers - thin layer delegating to operations."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.agents.v1.skills_pb2 import (
    CreateSkillRequest,
    CreateSkillResponse,
    DeleteSkillRequest,
    DeleteSkillResponse,
    GetSkillRequest,
    GetSkillResponse,
    ListSkillsRequest,
    ListSkillsResponse,
    UpdateSkillRequest,
    UpdateSkillResponse,
)
from uniffy_proto.common.v1.common_pb2 import PaginationResponse

from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.db import open_session
from uniffy.domains.agents.skills.converters import skill_to_proto
from uniffy.domains.agents.skills.operations import SkillOperations
from uniffy.domains.auth.context import get_user_id_from_context


class SkillsHandlers:
    """RPC handlers for skills service."""

    async def create_skill(
        self,
        request: CreateSkillRequest,
        ctx: RequestContext,
    ) -> CreateSkillResponse:
        """Handle create_skill RPC call.

        Parameters
        ----------
        request : CreateSkillRequest
            The request with skill details.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        SkillResponse
            The created skill.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization ID format")

        always_active = request.always_active if request.HasField("always_active") else False
        owner_id: UUID | None = None
        if request.HasField("owner_id") and request.owner_id:
            try:
                owner_id = UUID(request.owner_id)
            except ValueError:
                raise ConnectError(Code.INVALID_ARGUMENT, "Invalid owner ID format")

        try:
            async with open_session() as session:
                ops = SkillOperations(session)
                skill = await ops.create_skill(
                    user_id=user_id,
                    organization_id=org_id,
                    name=request.name,
                    display_name=request.display_name,
                    description=request.description,
                    content=request.content,
                    always_active=always_active,
                    owner_id=owner_id,
                )
                return CreateSkillResponse(skill=skill_to_proto(skill))

        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error creating skill: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_skill(
        self,
        request: GetSkillRequest,
        ctx: RequestContext,
    ) -> GetSkillResponse:
        """Handle get_skill RPC call.

        Parameters
        ----------
        request : GetSkillRequest
            The request with skill ID.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        SkillResponse
            The skill.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            skill_id = UUID(request.skill_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async with open_session() as session:
                ops = SkillOperations(session)
                skill = await ops.get_skill(
                    user_id=user_id,
                    organization_id=org_id,
                    skill_id=skill_id,
                )
                return GetSkillResponse(skill=skill_to_proto(skill))

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Skill not found")
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error getting skill: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_skills(
        self,
        request: ListSkillsRequest,
        ctx: RequestContext,
    ) -> ListSkillsResponse:
        """Handle list_skills RPC call.

        Parameters
        ----------
        request : ListSkillsRequest
            The request with organization ID and pagination.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        ListSkillsResponse
            Paginated list of skills.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization ID format")

        page = 1
        page_size = 50
        if request.HasField("pagination"):
            page = request.pagination.page if request.pagination.page > 0 else 1
            page_size = min(
                request.pagination.page_size if request.pagination.page_size > 0 else 50,
                100,
            )

        try:
            async with open_session() as session:
                ops = SkillOperations(session)
                skills, total = await ops.list_skills(
                    user_id=user_id,
                    organization_id=org_id,
                    page=page,
                    page_size=page_size,
                )
                total_pages = (total + page_size - 1) // page_size if total > 0 else 0
                return ListSkillsResponse(
                    skills=[skill_to_proto(s) for s in skills],
                    pagination=PaginationResponse(
                        page=page,
                        page_size=page_size,
                        total_count=total,
                        total_pages=total_pages,
                    ),
                )

        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error listing skills: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_skill(
        self,
        request: UpdateSkillRequest,
        ctx: RequestContext,
    ) -> UpdateSkillResponse:
        """Handle update_skill RPC call.

        Parameters
        ----------
        request : UpdateSkillRequest
            The request with updated fields.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        SkillResponse
            The updated skill.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            skill_id = UUID(request.skill_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        name = request.name if request.HasField("name") else None
        display_name = request.display_name if request.HasField("display_name") else None
        description = request.description if request.HasField("description") else None
        content = request.content if request.HasField("content") else None
        always_active = request.always_active if request.HasField("always_active") else None

        try:
            async with open_session() as session:
                ops = SkillOperations(session)
                skill = await ops.update_skill(
                    user_id=user_id,
                    organization_id=org_id,
                    skill_id=skill_id,
                    name=name,
                    display_name=display_name,
                    description=description,
                    content=content,
                    always_active=always_active,
                )
                return UpdateSkillResponse(skill=skill_to_proto(skill))

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Skill not found")
        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error updating skill: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def delete_skill(
        self,
        request: DeleteSkillRequest,
        ctx: RequestContext,
    ) -> DeleteSkillResponse:
        """Handle delete_skill RPC call.

        Parameters
        ----------
        request : DeleteSkillRequest
            The request with skill ID.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        DeleteSkillResponse
            Success response.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            skill_id = UUID(request.skill_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async with open_session() as session:
                ops = SkillOperations(session)
                await ops.delete_skill(
                    user_id=user_id,
                    organization_id=org_id,
                    skill_id=skill_id,
                )
                return DeleteSkillResponse(success=True)

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Skill not found")
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error deleting skill: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")
