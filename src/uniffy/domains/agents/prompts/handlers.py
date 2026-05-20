"""Prompt RPC handlers."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession
from uniffy_proto.agents.v1.prompts_pb2 import (
    CreatePromptRequest,
    CreatePromptResponse,
    DeletePromptRequest,
    DeletePromptResponse,
    GetPromptRequest,
    GetPromptResponse,
    ListPromptsRequest,
    ListPromptsResponse,
    UpdatePromptRequest,
    UpdatePromptResponse,
)
from uniffy_proto.common.v1.common_pb2 import PaginationResponse

from uniffy.core.auth.permissions import resolve_effective_policy
from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.converters.common_proto import (
    access_mode_from_proto,
    content_role_from_proto,
)
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.agents.prompt import AgentPrompt
from uniffy.core.types import ContentType
from uniffy.db import open_session
from uniffy.domains.agents.prompts.converters import prompt_to_proto
from uniffy.domains.agents.prompts.operations import PromptOperations
from uniffy.domains.auth.context import get_user_id_from_context


async def _resolve_effective_policy(
    session: AsyncSession,
    organization_id: UUID,
    prompt: AgentPrompt,
    checker: PermissionChecker | None = None,
):
    """Return the prompt's effective ``(access_mode, baseline_role)`` for proto emission."""
    permission_checker = checker or PermissionChecker(session)
    default_mode, default_baseline = await permission_checker.get_org_defaults(
        organization_id, ContentType.PROMPT,
    )
    return resolve_effective_policy(
        prompt.access_mode, prompt.baseline_role, default_mode, default_baseline,
    )


def _parse_uuid(value: str, field: str) -> UUID:
    """Parse a UUID string or raise ``INVALID_ARGUMENT``."""
    try:
        return UUID(value)
    except ValueError as exc:
        raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid {field}: {exc}") from exc


def _map_domain_error(operation: str, exc: Exception) -> ConnectError:
    """Translate a domain exception into the matching ``ConnectError``."""
    if isinstance(exc, NotFoundError):
        return ConnectError(Code.NOT_FOUND, str(exc) or "Not found")
    if isinstance(exc, ValidationError):
        return ConnectError(Code.INVALID_ARGUMENT, str(exc))
    if isinstance(exc, PermissionDeniedError):
        return ConnectError(Code.PERMISSION_DENIED, str(exc) or "Access denied")
    logger.error(f"Error in {operation}: {exc}", exc_info=True)
    return ConnectError(Code.INTERNAL, "Internal server error")


class PromptsHandlers:
    """RPC handlers for ``agents.v1.PromptsService``."""

    async def create_prompt(
        self,
        request: CreatePromptRequest,
        ctx: RequestContext,
    ) -> CreatePromptResponse:
        """Create a new prompt template."""
        user_id = get_user_id_from_context(ctx)
        org_id = _parse_uuid(request.organization_id, "organization_id")

        owner_id: UUID | None = None
        if request.HasField("owner_id") and request.owner_id:
            owner_id = _parse_uuid(request.owner_id, "owner_id")

        access_mode = access_mode_from_proto(request.access_mode) if request.access_mode else None
        baseline_role = (
            content_role_from_proto(request.baseline_role) if request.baseline_role else None
        )

        name = request.name if request.HasField("name") and request.name else None

        try:
            async with open_session() as session:
                ops = PromptOperations(session)
                prompt = await ops.create_prompt(
                    user_id=user_id,
                    organization_id=org_id,
                    display_name=request.display_name,
                    name=name,
                    description=request.description,
                    content=request.content,
                    owner_id=owner_id,
                    access_mode=access_mode,
                    baseline_role=baseline_role,
                )
                eff_mode, eff_baseline = await _resolve_effective_policy(
                    session, org_id, prompt,
                )
                return CreatePromptResponse(
                    prompt=prompt_to_proto(
                        prompt,
                        effective_access_mode=eff_mode,
                        effective_baseline_role=eff_baseline,
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("create_prompt", exc) from exc

    async def get_prompt(
        self,
        request: GetPromptRequest,
        ctx: RequestContext,
    ) -> GetPromptResponse:
        """Get a prompt by ID."""
        user_id = get_user_id_from_context(ctx)
        org_id = _parse_uuid(request.organization_id, "organization_id")
        prompt_id = _parse_uuid(request.prompt_id, "prompt_id")

        try:
            async with open_session() as session:
                ops = PromptOperations(session)
                prompt = await ops.get_prompt(
                    user_id=user_id,
                    organization_id=org_id,
                    prompt_id=prompt_id,
                )
                eff_mode, eff_baseline = await _resolve_effective_policy(
                    session, org_id, prompt,
                )
                return GetPromptResponse(
                    prompt=prompt_to_proto(
                        prompt,
                        effective_access_mode=eff_mode,
                        effective_baseline_role=eff_baseline,
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("get_prompt", exc) from exc

    async def list_prompts(
        self,
        request: ListPromptsRequest,
        ctx: RequestContext,
    ) -> ListPromptsResponse:
        """List prompts visible to the user."""
        user_id = get_user_id_from_context(ctx)
        org_id = _parse_uuid(request.organization_id, "organization_id")

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
                ops = PromptOperations(session)
                prompts, total = await ops.list_prompts(
                    user_id=user_id,
                    organization_id=org_id,
                    page=page,
                    page_size=page_size,
                )
                total_pages = (total + page_size - 1) // page_size if total > 0 else 0
                checker = PermissionChecker(session)
                default_mode, default_baseline = await checker.get_org_defaults(
                    org_id, ContentType.PROMPT,
                )
                proto_prompts = []
                for p in prompts:
                    eff_mode, eff_baseline = resolve_effective_policy(
                        p.access_mode, p.baseline_role, default_mode, default_baseline,
                    )
                    proto_prompts.append(
                        prompt_to_proto(
                            p,
                            effective_access_mode=eff_mode,
                            effective_baseline_role=eff_baseline,
                        )
                    )
                return ListPromptsResponse(
                    prompts=proto_prompts,
                    pagination=PaginationResponse(
                        page=page,
                        page_size=page_size,
                        total_count=total,
                        total_pages=total_pages,
                    ),
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("list_prompts", exc) from exc

    async def update_prompt(
        self,
        request: UpdatePromptRequest,
        ctx: RequestContext,
    ) -> UpdatePromptResponse:
        """Update a prompt."""
        user_id = get_user_id_from_context(ctx)
        org_id = _parse_uuid(request.organization_id, "organization_id")
        prompt_id = _parse_uuid(request.prompt_id, "prompt_id")

        name = request.name if request.HasField("name") else None
        display_name = request.display_name if request.HasField("display_name") else None
        description = request.description if request.HasField("description") else None
        content = request.content if request.HasField("content") else None

        try:
            async with open_session() as session:
                ops = PromptOperations(session)
                prompt = await ops.update_prompt(
                    user_id=user_id,
                    organization_id=org_id,
                    prompt_id=prompt_id,
                    name=name,
                    display_name=display_name,
                    description=description,
                    content=content,
                )
                eff_mode, eff_baseline = await _resolve_effective_policy(
                    session, org_id, prompt,
                )
                return UpdatePromptResponse(
                    prompt=prompt_to_proto(
                        prompt,
                        effective_access_mode=eff_mode,
                        effective_baseline_role=eff_baseline,
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("update_prompt", exc) from exc

    async def delete_prompt(
        self,
        request: DeletePromptRequest,
        ctx: RequestContext,
    ) -> DeletePromptResponse:
        """Delete a prompt."""
        user_id = get_user_id_from_context(ctx)
        org_id = _parse_uuid(request.organization_id, "organization_id")
        prompt_id = _parse_uuid(request.prompt_id, "prompt_id")

        try:
            async with open_session() as session:
                ops = PromptOperations(session)
                await ops.delete_prompt(
                    user_id=user_id,
                    organization_id=org_id,
                    prompt_id=prompt_id,
                )
                return DeletePromptResponse(success=True)
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("delete_prompt", exc) from exc
