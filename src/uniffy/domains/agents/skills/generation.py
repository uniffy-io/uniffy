"""Explicit draft requests, deduplicated retries, and persisted terminal states."""

from datetime import UTC, datetime, timedelta
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.membership import is_active_member
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.jobs import JobEnqueueOutcome, enqueue_job_reconnecting
from uniffy.core.models.agents.skill import AgentSkill, AgentSkillSource
from uniffy.core.models.agents.skill_draft import (
    AgentSkillDraft,
    AgentSkillDraftKind,
    AgentSkillDraftStatus,
    SkillGenerationError,
)
from uniffy.domains.agents.access import is_agents_builder
from uniffy.domains.agents.skills.cards import publish_draft_card, stage_draft_card
from uniffy.domains.agents.skills.evidence import load_draft_evidence
from uniffy.domains.agents.skills.jobs.contracts import GENERATE_SKILL_DRAFT
from uniffy.domains.agents.skills.quotas import require_draft_capacity
from uniffy.domains.agents.skills.validation import (
    SKILL_RATIONALE_MAX,
    has_hard_injection,
    sanitize_skill_text,
)

logger = logger.bind(component="agents.skills.generation")

GENERATION_TIMEOUT_SECONDS = 300
GENERATION_PENDING_SECONDS = 900


class SkillDraftGeneration:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def request(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        request_id: UUID,
        agent_id: UUID,
        evidence_message_ids: list[UUID],
        rationale: str,
        session_id: UUID | None = None,
        channel_id: UUID | None = None,
        thread_root_id: UUID | None = None,
        invocation_id: UUID | None = None,
    ) -> AgentSkillDraft:
        rationale = sanitize_skill_text(rationale).strip()
        if not rationale or len(rationale) > SKILL_RATIONALE_MAX:
            raise ValidationError("rationale", "Describe the desired skill in 1 to 2000 characters")
        if has_hard_injection(rationale):
            raise ValidationError(
                "rationale", "The explanation contains a disallowed instruction delimiter"
            )

        candidate = AgentSkillDraft(
            id=request_id,
            organization_id=organization_id,
            owner_id=user_id,
            proposed_by_agent_id=agent_id,
            session_id=session_id,
            channel_id=channel_id,
            thread_root_id=thread_root_id,
            evidence_message_ids=[str(value) for value in evidence_message_ids],
            invocation_id=invocation_id,
            rationale=rationale,
            kind=AgentSkillDraftKind.CREATE,
            status=AgentSkillDraftStatus.GENERATING,
            generation_attempt=1,
            generation_deadline_at=datetime.now(UTC) + timedelta(seconds=GENERATION_PENDING_SECONDS),
        )
        evidence = await load_draft_evidence(self._session, candidate)
        # The membership lock also serializes duplicate request IDs from the same actor.
        await require_draft_capacity(self._session, user_id, organization_id, exclude_id=request_id)
        existing = await self._session.get(AgentSkillDraft, request_id)
        if existing is not None:
            fields = (
                "organization_id",
                "owner_id",
                "proposed_by_agent_id",
                "session_id",
                "channel_id",
                "thread_root_id",
                "evidence_message_ids",
                "invocation_id",
                "rationale",
            )
            if any(getattr(existing, field) != getattr(candidate, field) for field in fields):
                raise ValidationError("request_id", "This request ID has already been used")
            return existing

        if evidence.version is not None:
            version = evidence.version
            source = await self._session.get(AgentSkill, version.skill_id)
            candidate.target_version_id = version.id
            candidate.target_version_number = version.version_number
            candidate.name = version.name
            candidate.display_name = version.display_name
            candidate.requires_tools = list(version.requires_tools or [])
            candidate.supported_surfaces = list(version.supported_surfaces or [])
            if source is not None and source.source == AgentSkillSource.ORGANIZATION:
                candidate.target_skill_id = version.skill_id
                candidate.kind = AgentSkillDraftKind.EDIT

        self._session.add(candidate)
        await stage_draft_card(self._session, candidate)
        await self._session.commit()
        await self._session.refresh(candidate)
        await publish_draft_card(self._session, candidate, created=True)
        await self.enqueue(candidate)
        return candidate

    async def retry(
        self, *, user_id: UUID, organization_id: UUID, draft_id: UUID, expected_attempt: int
    ) -> AgentSkillDraft:
        draft = await self.get(user_id=user_id, organization_id=organization_id, draft_id=draft_id)
        if draft.owner_id != user_id or draft.generation_attempt < 1:
            raise PermissionDeniedError("retry", "Only the requester can retry generation")
        await load_draft_evidence(self._session, draft)
        result = await self._session.execute(
            select(AgentSkillDraft)
            .where(
                AgentSkillDraft.id == draft_id, AgentSkillDraft.organization_id == organization_id
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        draft = result.scalar_one()
        if draft.generation_attempt != expected_attempt:
            return draft
        if draft.status != AgentSkillDraftStatus.GENERATION_FAILED:
            raise ValidationError("draft_id", "Only failed generation can be retried")

        draft.status = AgentSkillDraftStatus.GENERATING
        draft.generation_attempt += 1
        draft.generation_error = None
        draft.generation_started_at = None
        draft.generation_deadline_at = datetime.now(UTC) + timedelta(
            seconds=GENERATION_PENDING_SECONDS
        )
        await stage_draft_card(self._session, draft)
        await self._session.commit()
        await self._session.refresh(draft)
        await publish_draft_card(self._session, draft)
        await self.enqueue(draft)
        return draft

    async def get(self, *, user_id: UUID, organization_id: UUID, draft_id: UUID) -> AgentSkillDraft:
        if not await is_active_member(user_id, organization_id, self._session):
            raise PermissionDeniedError("view", "Active organization membership is required")
        draft = (
            await self._session.execute(
                select(AgentSkillDraft).where(
                    AgentSkillDraft.id == draft_id,
                    AgentSkillDraft.organization_id == organization_id,
                )
            )
        ).scalar_one_or_none()
        if draft is None:
            raise NotFoundError("AgentSkillDraft", str(draft_id))
        if not await is_agents_builder(self._session, user_id, organization_id):
            if draft.owner_id != user_id or draft.generation_attempt < 1:
                raise PermissionDeniedError("view", "This draft is unavailable")
            await load_draft_evidence(self._session, draft)
        return draft

    async def enqueue(self, draft: AgentSkillDraft) -> None:
        draft_id = draft.id
        attempt = draft.generation_attempt
        try:
            result = await enqueue_job_reconnecting(
                GENERATE_SKILL_DRAFT,
                str(draft.id),
                draft.generation_attempt,
                _job_id=f"skill-draft:{draft.id}:{draft.generation_attempt}",
            )
            if result.outcome in (JobEnqueueOutcome.ENQUEUED, JobEnqueueOutcome.DEDUPLICATED):
                return
        except Exception:
            logger.opt(exception=True).warning(
                "Skill draft queue unavailable", draft_id=str(draft.id)
            )
        # An uncertain enqueue can have reached the worker; never overwrite a claimed attempt.
        current = (
            await self._session.execute(
                select(AgentSkillDraft)
                .where(
                    AgentSkillDraft.id == draft_id,
                    AgentSkillDraft.generation_attempt == attempt,
                    AgentSkillDraft.status == AgentSkillDraftStatus.GENERATING,
                    AgentSkillDraft.generation_started_at.is_(None),
                    AgentSkillDraft.is_deleted.is_(False),
                )
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if current is None:
            await self._session.refresh(draft)
            return
        draft = current
        draft.status = AgentSkillDraftStatus.GENERATION_FAILED
        draft.generation_error = SkillGenerationError.QUEUE_UNAVAILABLE
        await stage_draft_card(self._session, draft)
        await self._session.commit()
        await self._session.refresh(draft)
        await publish_draft_card(self._session, draft)
