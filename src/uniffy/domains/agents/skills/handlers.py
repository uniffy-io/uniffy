"""Agent skills RPC handlers - thin layer delegating to operations."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.agents.v1.skills_pb2 import (
    CreateSkillDraftRequest,
    CreateSkillDraftResponse,
    CreateSkillRequest,
    CreateSkillResponse,
    DeleteSkillRequest,
    DeleteSkillResponse,
    DiscardSkillDraftRequest,
    DiscardSkillDraftResponse,
    GetSkillDraftRequest,
    GetSkillDraftResponse,
    GetSkillMetricsRequest,
    GetSkillMetricsResponse,
    GetSkillRequest,
    GetSkillResponse,
    GetSkillVersionRequest,
    GetSkillVersionResponse,
    ListRunnableSkillsRequest,
    ListRunnableSkillsResponse,
    ListSkillDraftsRequest,
    ListSkillDraftsResponse,
    ListSkillsRequest,
    ListSkillsResponse,
    ListSkillVersionsRequest,
    ListSkillVersionsResponse,
    RevertSkillRequest,
    RevertSkillResponse,
    SaveSkillDraftRequest,
    SaveSkillDraftResponse,
    SetMainSkillVersionRequest,
    SetMainSkillVersionResponse,
    SkillMetric,
    UpdateSkillRequest,
    UpdateSkillResponse,
)
from uniffy_proto.common.v1.common_pb2 import PaginationResponse

from uniffy.core.auth.principal import current_user_id, resolve_organization_id
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.db import open_session
from uniffy.domains.agents.skills.converters import (
    runnable_skill_to_proto,
    skill_draft_to_proto,
    skill_to_proto,
    skill_version_to_proto,
)
from uniffy.domains.agents.skills.operations import SkillOperations

logger = logger.bind(component="agents.skills.handlers")


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
        user_id = current_user_id()

        try:
            org_id = resolve_organization_id(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization ID format")

        always_active = request.always_active if request.HasField("always_active") else False

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
                )
                return CreateSkillResponse(skill=skill_to_proto(skill))

        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error creating skill: {e}")
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
        user_id = current_user_id()

        try:
            org_id = resolve_organization_id(request.organization_id)
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
                active_number = await ops.resolve_active_version_number(skill)
                return GetSkillResponse(
                    skill=skill_to_proto(skill, active_version_number=active_number)
                )

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Skill not found")
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error getting skill: {e}")
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
        user_id = current_user_id()

        try:
            org_id = resolve_organization_id(request.organization_id)
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
                active_numbers = await ops.resolve_active_version_numbers(skills)
                total_pages = (total + page_size - 1) // page_size if total > 0 else 0
                return ListSkillsResponse(
                    skills=[
                        skill_to_proto(s, active_version_number=active_numbers[s.id]) for s in skills
                    ],
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
            logger.exception(f"Error listing skills: {e}")
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
        user_id = current_user_id()

        try:
            org_id = resolve_organization_id(request.organization_id)
            skill_id = UUID(request.skill_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        name = request.name if request.HasField("name") else None
        display_name = request.display_name if request.HasField("display_name") else None
        description = request.description if request.HasField("description") else None
        content = request.content if request.HasField("content") else None
        when_to_use = request.when_to_use if request.HasField("when_to_use") else None
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
                    when_to_use=when_to_use,
                    always_active=always_active,
                )
                active_number = await ops.resolve_active_version_number(skill)
                return UpdateSkillResponse(
                    skill=skill_to_proto(skill, active_version_number=active_number)
                )

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Skill not found")
        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error updating skill: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_runnable_skills(
        self,
        request: ListRunnableSkillsRequest,
        ctx: RequestContext,
    ) -> ListRunnableSkillsResponse:
        """Handle list_runnable_skills RPC call (slash-command menu)."""
        user_id = current_user_id()

        try:
            org_id = resolve_organization_id(request.organization_id)
            agent_id = UUID(request.agent_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async with open_session() as session:
                ops = SkillOperations(session)
                skills = await ops.list_runnable_skills(
                    user_id=user_id,
                    organization_id=org_id,
                    agent_id=agent_id,
                )
                return ListRunnableSkillsResponse(
                    skills=[runnable_skill_to_proto(s) for s in skills],
                )

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Agent not found")
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error listing runnable skills: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def create_skill_draft(
        self,
        request: CreateSkillDraftRequest,
        ctx: RequestContext,
    ) -> CreateSkillDraftResponse:
        """Handle create_skill_draft RPC call."""
        user_id = current_user_id()

        try:
            org_id = resolve_organization_id(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization ID format")

        target_skill_id: UUID | None = None
        if request.HasField("target_skill_id") and request.target_skill_id:
            try:
                target_skill_id = UUID(request.target_skill_id)
            except ValueError:
                raise ConnectError(Code.INVALID_ARGUMENT, "Invalid target skill ID format")

        try:
            async with open_session() as session:
                ops = SkillOperations(session)
                draft = await ops.create_skill_draft(
                    user_id=user_id,
                    organization_id=org_id,
                    kind=request.kind,
                    target_skill_id=target_skill_id,
                    name=request.name,
                    display_name=request.display_name,
                    description=request.description,
                    content=request.content,
                    when_to_use=request.when_to_use,
                    requires_tools=list(request.requires_tools),
                    requires_context=list(request.requires_context),
                    suggested_always_active=request.suggested_always_active,
                    rationale=request.rationale,
                )
                return CreateSkillDraftResponse(draft=skill_draft_to_proto(draft))

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Target skill not found")
        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error creating skill draft: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_skill_draft(
        self,
        request: GetSkillDraftRequest,
        ctx: RequestContext,
    ) -> GetSkillDraftResponse:
        """Handle get_skill_draft RPC call."""
        user_id = current_user_id()

        try:
            org_id = resolve_organization_id(request.organization_id)
            draft_id = UUID(request.draft_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async with open_session() as session:
                ops = SkillOperations(session)
                draft = await ops.get_skill_draft(
                    user_id=user_id,
                    organization_id=org_id,
                    draft_id=draft_id,
                )
                return GetSkillDraftResponse(draft=skill_draft_to_proto(draft))

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Draft not found")
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error getting skill draft: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_skill_drafts(
        self,
        request: ListSkillDraftsRequest,
        ctx: RequestContext,
    ) -> ListSkillDraftsResponse:
        """Handle list_skill_drafts RPC call (drafts inbox)."""
        user_id = current_user_id()

        try:
            org_id = resolve_organization_id(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization ID format")

        status = request.status if request.HasField("status") else "pending"
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
                drafts, total = await ops.list_skill_drafts(
                    user_id=user_id,
                    organization_id=org_id,
                    status=status,
                    page=page,
                    page_size=page_size,
                )
                total_pages = (total + page_size - 1) // page_size if total > 0 else 0
                return ListSkillDraftsResponse(
                    drafts=[skill_draft_to_proto(d) for d in drafts],
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
            logger.exception(f"Error listing skill drafts: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def save_skill_draft(
        self,
        request: SaveSkillDraftRequest,
        ctx: RequestContext,
    ) -> SaveSkillDraftResponse:
        """Handle save_skill_draft RPC call: draft -> skill version."""
        user_id = current_user_id()

        try:
            org_id = resolve_organization_id(request.organization_id)
            draft_id = UUID(request.draft_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async with open_session() as session:
                ops = SkillOperations(session)
                skill, version = await ops.save_skill_draft(
                    user_id=user_id,
                    organization_id=org_id,
                    draft_id=draft_id,
                    name=request.name,
                    display_name=request.display_name,
                    description=request.description,
                    content=request.content,
                    when_to_use=request.when_to_use,
                    requires_tools=list(request.requires_tools),
                    requires_context=list(request.requires_context),
                    suggested_always_active=request.suggested_always_active,
                    change_summary=request.change_summary,
                    allow_replace=request.allow_replace,
                )
                active_number = await ops.resolve_active_version_number(skill)
                return SaveSkillDraftResponse(
                    skill=skill_to_proto(skill, active_version_number=active_number),
                    version=skill_version_to_proto(version),
                )

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Draft not found")
        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error saving skill draft: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def discard_skill_draft(
        self,
        request: DiscardSkillDraftRequest,
        ctx: RequestContext,
    ) -> DiscardSkillDraftResponse:
        """Handle discard_skill_draft RPC call."""
        user_id = current_user_id()

        try:
            org_id = resolve_organization_id(request.organization_id)
            draft_id = UUID(request.draft_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async with open_session() as session:
                ops = SkillOperations(session)
                await ops.discard_skill_draft(
                    user_id=user_id,
                    organization_id=org_id,
                    draft_id=draft_id,
                )
                return DiscardSkillDraftResponse(success=True)

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Draft not found")
        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error discarding skill draft: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_skill_versions(
        self,
        request: ListSkillVersionsRequest,
        ctx: RequestContext,
    ) -> ListSkillVersionsResponse:
        """Handle list_skill_versions RPC call (version history timeline)."""
        user_id = current_user_id()

        try:
            org_id = resolve_organization_id(request.organization_id)
            skill_id = UUID(request.skill_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

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
                versions, total, skill = await ops.list_skill_versions(
                    user_id=user_id,
                    organization_id=org_id,
                    skill_id=skill_id,
                    page=page,
                    page_size=page_size,
                )
                active_number = await ops.resolve_active_version_number(skill)
                total_pages = (total + page_size - 1) // page_size if total > 0 else 0
                return ListSkillVersionsResponse(
                    versions=[skill_version_to_proto(v) for v in versions],
                    pagination=PaginationResponse(
                        page=page,
                        page_size=page_size,
                        total_count=total,
                        total_pages=total_pages,
                    ),
                    active_version_number=active_number,
                    active_version_pinned=bool(skill.active_version_pinned),
                    latest_version_number=skill.latest_version_number or 1,
                )

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Skill not found")
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error listing skill versions: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_skill_version(
        self,
        request: GetSkillVersionRequest,
        ctx: RequestContext,
    ) -> GetSkillVersionResponse:
        """Handle get_skill_version RPC call."""
        user_id = current_user_id()

        try:
            org_id = resolve_organization_id(request.organization_id)
            skill_id = UUID(request.skill_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async with open_session() as session:
                ops = SkillOperations(session)
                version = await ops.get_skill_version(
                    user_id=user_id,
                    organization_id=org_id,
                    skill_id=skill_id,
                    version_number=request.version_number,
                )
                return GetSkillVersionResponse(version=skill_version_to_proto(version))

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Version not found")
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error getting skill version: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def set_main_skill_version(
        self,
        request: SetMainSkillVersionRequest,
        ctx: RequestContext,
    ) -> SetMainSkillVersionResponse:
        """Handle set_main_skill_version RPC call (pin / follow latest)."""
        user_id = current_user_id()

        try:
            org_id = resolve_organization_id(request.organization_id)
            skill_id = UUID(request.skill_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        version_number = request.version_number if request.HasField("version_number") else None

        try:
            async with open_session() as session:
                ops = SkillOperations(session)
                skill = await ops.set_main_skill_version(
                    user_id=user_id,
                    organization_id=org_id,
                    skill_id=skill_id,
                    version_number=version_number,
                    follow_latest=request.follow_latest,
                )
                active_number = await ops.resolve_active_version_number(skill)
                return SetMainSkillVersionResponse(
                    skill=skill_to_proto(skill, active_version_number=active_number)
                )

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Skill or version not found")
        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error setting main skill version: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def revert_skill(
        self,
        request: RevertSkillRequest,
        ctx: RequestContext,
    ) -> RevertSkillResponse:
        """Handle revert_skill RPC call (copy an earlier version to the head)."""
        user_id = current_user_id()

        try:
            org_id = resolve_organization_id(request.organization_id)
            skill_id = UUID(request.skill_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async with open_session() as session:
                ops = SkillOperations(session)
                skill, version = await ops.revert_skill(
                    user_id=user_id,
                    organization_id=org_id,
                    skill_id=skill_id,
                    version_number=request.version_number,
                )
                active_number = await ops.resolve_active_version_number(skill)
                return RevertSkillResponse(
                    skill=skill_to_proto(skill, active_version_number=active_number),
                    version=skill_version_to_proto(version),
                )

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Skill or version not found")
        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error reverting skill: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_skill_metrics(
        self,
        request: GetSkillMetricsRequest,
        ctx: RequestContext,
    ) -> GetSkillMetricsResponse:
        """Handle get_skill_metrics RPC call (org-admin metrics view)."""
        user_id = current_user_id()

        try:
            org_id = resolve_organization_id(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization ID format")

        try:
            async with open_session() as session:
                ops = SkillOperations(session)
                data = await ops.get_skill_metrics(
                    user_id=user_id,
                    organization_id=org_id,
                )
                return GetSkillMetricsResponse(
                    metrics=[
                        SkillMetric(
                            skill_id=str(m["skill_id"]),
                            display_name=m["display_name"],
                            origin=m["origin"],
                            injected_count=m["injected"],
                            viewed_count=m["viewed"],
                            invoked_count=m["invoked"],
                        )
                        for m in data["metrics"]
                    ],
                    positive_feedback_count=data["positive"],
                    negative_feedback_count=data["negative"],
                    pending_agent_drafts=data["pending_agent_drafts"],
                )

        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error getting skill metrics: {e}")
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
        user_id = current_user_id()

        try:
            org_id = resolve_organization_id(request.organization_id)
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
            logger.exception(f"Error deleting skill: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")
