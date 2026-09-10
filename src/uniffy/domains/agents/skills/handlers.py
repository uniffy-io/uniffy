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
    GetSkillCompatibilityRequest,
    GetSkillCompatibilityResponse,
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
    SkillCompatibility,
    SkillMetric,
    UpdateSkillRequest,
    UpdateSkillResponse,
)
from uniffy_proto.common.v1.common_pb2 import PaginationResponse

from uniffy.core.auth.principal import current_user_id, resolve_organization_id
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.agents.skill import SkillSurface
from uniffy.domains.agents.skills.converters import (
    runnable_skill_to_proto,
    skill_draft_to_proto,
    skill_to_proto,
    skill_version_to_proto,
)
from uniffy.domains.agents.skills.generation_handlers import SkillGenerationHandlers
from uniffy.domains.agents.skills.metrics import SkillMetricsReader
from uniffy.domains.agents.skills.operations import SkillOperations
from uniffy.infrastructure.database import open_session

logger = logger.bind(component="agents.skills.handlers")


class SkillsHandlers(SkillGenerationHandlers):
    """RPC handlers for skills service."""

    async def get_skill_compatibility(
        self, request: GetSkillCompatibilityRequest, ctx: RequestContext
    ) -> GetSkillCompatibilityResponse:
        organization_id = resolve_organization_id(request.organization_id)
        try:
            agent_id = UUID(request.agent_id)
        except ValueError as exc:
            raise ValidationError("agent_id", "Invalid agent ID") from exc
        async with open_session() as session:
            diagnostics = await SkillOperations(session).get_skill_compatibility(
                user_id=current_user_id(),
                organization_id=organization_id,
                agent_id=agent_id,
            )
            return GetSkillCompatibilityResponse(
                skills=[
                    SkillCompatibility(
                        skill_id=str(item.skill_id),
                        version_id=str(item.version_id) if item.version_id else "",
                        version_number=item.version_number,
                        missing_tools=list(item.missing_tools),
                        unsupported_surfaces=list(item.unsupported_surfaces),
                        unavailable=item.unavailable,
                        display_name=item.display_name,
                        retired=item.retired,
                    )
                    for item in diagnostics
                ]
            )

    async def create_skill(
        self,
        request: CreateSkillRequest,
        ctx: RequestContext,
    ) -> CreateSkillResponse:
        user_id = current_user_id()

        try:
            org_id = resolve_organization_id(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization ID format")

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
                )
                active_number = await ops.resolve_active_version_number(skill)
                return CreateSkillResponse(
                    skill=skill_to_proto(skill, active_version_number=active_number)
                )

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
        requires_tools = (
            list(request.requires_tools.names) if request.HasField("requires_tools") else None
        )

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
                    requires_tools=requires_tools,
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
        user_id = current_user_id()

        try:
            org_id = resolve_organization_id(request.organization_id)
            agent_id = UUID(request.agent_id)
            surface = SkillSurface(request.surface)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async with open_session() as session:
                ops = SkillOperations(session)
                skills = await ops.list_runnable_skills(
                    user_id=user_id,
                    organization_id=org_id,
                    agent_id=agent_id,
                    surface=surface,
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
                    requires_tools=list(request.requires_tools),
                    supported_surfaces=list(request.supported_surfaces),
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
                    requires_tools=list(request.requires_tools),
                    supported_surfaces=list(request.supported_surfaces),
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
        user_id = current_user_id()

        try:
            org_id = resolve_organization_id(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization ID format")

        try:
            async with open_session() as session:
                try:
                    skill_id = UUID(request.skill_id) if request.skill_id else None
                except ValueError:
                    raise ValidationError("skill_id", "Invalid skill ID") from None
                page = await SkillMetricsReader(session).read(
                    user_id=user_id,
                    organization_id=org_id,
                    skill_id=skill_id,
                    window_days=request.window_days or 30,
                    page_size=request.page_size or 200,
                    cursor=request.cursor,
                )
                response = GetSkillMetricsResponse(
                    metrics=[SkillMetric(**metric) for metric in page.metrics],
                    next_cursor=page.next_cursor,
                )
                response.window_start.FromDatetime(page.window_start)
                response.window_end.FromDatetime(page.window_end)
                return response

        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))

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
