"""Explicit generation RPCs carry evidence identifiers, never client transcripts."""

from uuid import UUID

from connectrpc.request import RequestContext
from uniffy_proto.agents.v1.skills_pb import (
    GenerateSkillDraftRequest,
    GenerateSkillDraftResponse,
    RetrySkillDraftGenerationRequest,
    RetrySkillDraftGenerationResponse,
)

from uniffy.core.auth.principal import current_user_id, resolve_organization_id
from uniffy.core.errors import ValidationError
from uniffy.domains.agents.skills.converters import skill_draft_to_proto
from uniffy.domains.agents.skills.generation import SkillDraftGeneration
from uniffy.infrastructure.database import open_session


class SkillGenerationHandlers:
    async def generate_skill_draft(
        self, request: GenerateSkillDraftRequest, ctx: RequestContext
    ) -> GenerateSkillDraftResponse:
        try:
            organization_id = resolve_organization_id(request.organization_id)
            request_id = UUID(request.request_id)
            agent_id = UUID(request.agent_id)
            evidence_ids = [UUID(value) for value in request.evidence_message_ids]
            session_id = UUID(request.session_id) if request.has_field("session_id") else None
            channel_id = UUID(request.channel_id) if request.has_field("channel_id") else None
            root_id = UUID(request.thread_root_id) if request.has_field("thread_root_id") else None
            invocation_id = (
                UUID(request.invocation_id) if request.has_field("invocation_id") else None
            )
        except ValueError as exc:
            raise ValidationError("id", "Invalid ID format") from exc
        async with open_session() as session:
            draft = await SkillDraftGeneration(session).request(
                user_id=current_user_id(),
                organization_id=organization_id,
                request_id=request_id,
                agent_id=agent_id,
                evidence_message_ids=evidence_ids,
                rationale=request.rationale,
                session_id=session_id,
                channel_id=channel_id,
                thread_root_id=root_id,
                invocation_id=invocation_id,
            )
            return GenerateSkillDraftResponse(draft=skill_draft_to_proto(draft))

    async def retry_skill_draft_generation(
        self, request: RetrySkillDraftGenerationRequest, ctx: RequestContext
    ) -> RetrySkillDraftGenerationResponse:
        try:
            organization_id = resolve_organization_id(request.organization_id)
            draft_id = UUID(request.draft_id)
        except ValueError as exc:
            raise ValidationError("id", "Invalid ID format") from exc
        async with open_session() as session:
            draft = await SkillDraftGeneration(session).retry(
                user_id=current_user_id(),
                organization_id=organization_id,
                draft_id=draft_id,
                expected_attempt=request.expected_attempt,
            )
            return RetrySkillDraftGenerationResponse(draft=skill_draft_to_proto(draft))
