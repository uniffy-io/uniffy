"""Execute explicitly requested draft attempts without running workspace tools."""

import asyncio
import time
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import select, update

from uniffy.core.errors import (
    BudgetExceededError,
    NotFoundError,
    PermissionDeniedError,
    ValidationError,
)
from uniffy.core.jobs.locks import acquire_owned_job_lock, release_owned_job_lock
from uniffy.core.json_codec import dumps_str
from uniffy.core.models.agents.run_log import AgentRunStatus
from uniffy.core.models.agents.skill_draft import (
    AgentSkillDraft,
    AgentSkillDraftStatus,
    SkillGenerationError,
)
from uniffy.domains.agents.budgets.operations import BudgetsOperations
from uniffy.domains.agents.providers.base import CompletionResult
from uniffy.domains.agents.providers.catalog import resolve_request_params
from uniffy.domains.agents.providers.operations import ProviderOperations
from uniffy.domains.agents.runtime.models.calls import safety_identifier
from uniffy.domains.agents.runtime.models.resolver import resolve_provider_and_model
from uniffy.domains.agents.runtime.runs.records import RunRecorder
from uniffy.domains.agents.runtime.runs.usage import RunUsageAccumulator
from uniffy.domains.agents.skills.cards import publish_draft_card, stage_draft_card
from uniffy.domains.agents.skills.evidence import load_draft_evidence
from uniffy.domains.agents.skills.generation import GENERATION_TIMEOUT_SECONDS
from uniffy.domains.agents.skills.proposal import GENERATION_PROMPT, parse_proposal
from uniffy.domains.agents.skills.validation import CleanSkillFields
from uniffy.infrastructure.database import open_session
from uniffy.infrastructure.valkey.ops import get_ops_client

logger = logger.bind(component="agents.skills.jobs.jobs")


async def _finish(
    draft_id: UUID,
    attempt: int,
    *,
    proposal: CleanSkillFields | None = None,
    error: SkillGenerationError | None = None,
    only_if_expired: bool = False,
) -> None:
    async with open_session() as session:
        draft = (
            await session.execute(
                select(AgentSkillDraft)
                .where(
                    AgentSkillDraft.id == draft_id,
                    AgentSkillDraft.generation_attempt == attempt,
                    AgentSkillDraft.status == AgentSkillDraftStatus.GENERATING,
                    AgentSkillDraft.is_deleted.is_(False),
                )
                .with_for_update()
            )
        ).scalar_one_or_none()
        if draft is None:
            return
        if only_if_expired and (
            draft.generation_deadline_at is None or draft.generation_deadline_at >= datetime.now(UTC)
        ):
            return
        if proposal is not None:
            try:
                await load_draft_evidence(session, draft)
            except (PermissionDeniedError, NotFoundError, ValidationError) as exc:
                raise PermissionDeniedError(
                    "generate", "The selected evidence is unavailable"
                ) from exc
            draft.name = proposal.name
            draft.display_name = proposal.display_name
            draft.description = proposal.description
            draft.content = proposal.content
            draft.status = AgentSkillDraftStatus.PENDING
        else:
            draft.status = AgentSkillDraftStatus.GENERATION_FAILED
        draft.generation_error = error
        draft.updated_at = datetime.now(UTC)
        await stage_draft_card(session, draft)
        await session.commit()
        await session.refresh(draft)
        await publish_draft_card(session, draft)


async def _generate(draft_id: UUID, attempt: int) -> None:
    async with open_session() as session:
        claimed = (
            await session.execute(
                update(AgentSkillDraft)
                .where(
                    AgentSkillDraft.id == draft_id,
                    AgentSkillDraft.generation_attempt == attempt,
                    AgentSkillDraft.status == AgentSkillDraftStatus.GENERATING,
                    AgentSkillDraft.generation_started_at.is_(None),
                    AgentSkillDraft.generation_deadline_at > datetime.now(UTC),
                    AgentSkillDraft.is_deleted.is_(False),
                )
                .values(
                    generation_started_at=datetime.now(UTC),
                    generation_deadline_at=datetime.now(UTC)
                    + timedelta(seconds=GENERATION_TIMEOUT_SECONDS + 60),
                )
                .returning(AgentSkillDraft.id)
            )
        ).scalar_one_or_none()
        await session.commit()
        if claimed is None:
            return
        draft = await session.get(AgentSkillDraft, draft_id)
        try:
            evidence = await load_draft_evidence(session, draft)
        except (PermissionDeniedError, NotFoundError, ValidationError) as exc:
            raise PermissionDeniedError("generate", "The selected evidence is unavailable") from exc
        await BudgetsOperations(session).check_preflight(
            user_id=draft.owner_id, organization_id=draft.organization_id
        )
        try:
            provider, key_id, model = await resolve_provider_and_model(
                session,
                ProviderOperations(session),
                organization_id=draft.organization_id,
                agent=evidence.agent,
                model_override=evidence.model_override,
            )
        except NotFoundError, ValidationError:
            await _finish(draft_id, attempt, error=SkillGenerationError.PROVIDER_REQUIRED)
            return

        target = evidence.version
        payload = {
            "requested_change": draft.rationale,
            "messages": evidence.messages,
            "skill": None
            if target is None
            else {
                "name": target.name,
                "display_name": target.display_name,
                "description": target.description,
                "content": target.content,
                "version": target.version_number,
                "requires_tools": target.requires_tools,
                "supported_surfaces": target.supported_surfaces,
            },
        }
        organization_id = draft.organization_id
        user_id = draft.owner_id
        agent_id = evidence.agent.id
        session_id = draft.session_id
        channel_id = draft.channel_id
        params = resolve_request_params(
            agent_params=evidence.agent.model_params or {},
            override_params={},
            provider=provider.name,
            model_id=model,
        )
        # Release the read transaction before waiting on the provider.
        await session.rollback()
        usage = RunUsageAccumulator()
        started = time.monotonic()
        status = AgentRunStatus.ERROR
        result: CompletionResult | None = None
        try:
            response = await provider.chat_completion(
                messages=[{"role": "user", "content": dumps_str(payload)}],
                model=model,
                system=GENERATION_PROMPT,
                tools=None,
                stream=False,
                params=params,
                safety_identifier=safety_identifier(
                    organization_id=organization_id, user_id=user_id
                ),
            )
            if not isinstance(response, CompletionResult):
                raise ValidationError("proposal", "The provider returned an invalid draft")
            result = response
            usage.record_result(
                provider=provider.name, provider_key_id=key_id, result=result, model=model
            )
            status = AgentRunStatus.SUCCESS
        finally:
            await RunRecorder(session).record(
                session_id=session_id,
                channel_id=channel_id,
                agent_id=agent_id,
                user_id=user_id,
                organization_id=organization_id,
                model=model,
                usage=usage,
                tool_calls=None,
                tool_iterations=0,
                duration_ms=int((time.monotonic() - started) * 1000),
                status=status,
                error=None if status == AgentRunStatus.SUCCESS else "skill_draft_generation_failed",
                provider_key_id=key_id,
            )
        if result.tool_calls:
            raise ValidationError("proposal", "Draft generation cannot execute tools")
        await _finish(draft_id, attempt, proposal=parse_proposal(result.content))


async def generate_skill_draft(ctx: dict[str, Any], draft_id: str, attempt: int) -> None:
    identifier = UUID(draft_id)
    client = get_ops_client()
    token = None
    key = f"skill-draft-lock:{identifier}:{attempt}"
    if client is None:
        await _finish(identifier, attempt, error=SkillGenerationError.QUEUE_UNAVAILABLE)
        return
    try:
        token = await acquire_owned_job_lock(client, key, GENERATION_TIMEOUT_SECONDS + 60)
        if token is None:
            return
        async with asyncio.timeout(GENERATION_TIMEOUT_SECONDS):
            await _generate(identifier, attempt)
    except PermissionDeniedError, NotFoundError:
        await _finish(identifier, attempt, error=SkillGenerationError.ACCESS_REVOKED)
    except BudgetExceededError:
        await _finish(identifier, attempt, error=SkillGenerationError.BUDGET_EXCEEDED)
    except ValidationError:
        await _finish(identifier, attempt, error=SkillGenerationError.INVALID_PROPOSAL)
    except TimeoutError, asyncio.CancelledError:
        await _finish(identifier, attempt, error=SkillGenerationError.INTERRUPTED)
    except Exception:
        logger.opt(exception=True).warning(
            "Skill draft generation failed", draft_id=draft_id, attempt=attempt
        )
        await _finish(identifier, attempt, error=SkillGenerationError.GENERATION_FAILED)
    finally:
        if token is not None:
            try:
                await release_owned_job_lock(client, key, token)
            except Exception:
                logger.warning("Skill draft lock release failed", draft_id=draft_id, attempt=attempt)


async def expire_skill_draft_generations(ctx: dict[str, Any]) -> None:
    async with open_session() as session:
        overdue = (
            await session.execute(
                select(AgentSkillDraft.id, AgentSkillDraft.generation_attempt)
                .where(
                    AgentSkillDraft.status == AgentSkillDraftStatus.GENERATING,
                    AgentSkillDraft.generation_deadline_at < datetime.now(UTC),
                    AgentSkillDraft.is_deleted.is_(False),
                )
                .order_by(AgentSkillDraft.generation_deadline_at, AgentSkillDraft.id)
                .limit(100)
            )
        ).all()
    for draft_id, attempt in overdue:
        await _finish(
            draft_id,
            attempt,
            error=SkillGenerationError.INTERRUPTED,
            only_if_expired=True,
        )
