import asyncio
import time
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import select

from uniffy.core.errors import (
    BudgetExceededError,
    NotFoundError,
    PermissionDeniedError,
    ValidationError,
)
from uniffy.core.jobs.locks import acquire_owned_job_lock, release_owned_job_lock
from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.agents.run_log import AgentRunKind, AgentRunLog, AgentRunStatus
from uniffy.core.models.agents.skill_evaluation_run import (
    OPEN_EVALUATION_STATUSES,
    AgentSkillEvaluationRun,
    SkillEvaluationError,
)
from uniffy.domains.agents.budgets.operations import BudgetsOperations
from uniffy.domains.agents.providers.base import CompletionResult
from uniffy.domains.agents.providers.catalog import resolve_request_params
from uniffy.domains.agents.providers.operations import ProviderOperations
from uniffy.domains.agents.runtime.models.calls import safety_identifier
from uniffy.domains.agents.runtime.models.resolver import resolve_provider_and_model
from uniffy.domains.agents.runtime.runs.records import RunRecorder
from uniffy.domains.agents.runtime.runs.usage import RunUsageAccumulator
from uniffy.domains.agents.skills.evaluations.lifecycle import (
    EvaluationAccounting,
    claim_evaluation,
    finish_evaluation,
)
from uniffy.domains.agents.skills.evaluations.reader import require_evaluation_agent
from uniffy.domains.agents.skills.evaluations.runner import evaluate, judge
from uniffy.domains.agents.skills.evaluations.schemas import (
    EVALUATION_TIMEOUT_SECONDS,
    CaseFields,
    JudgeStatus,
)
from uniffy.infrastructure.database import open_session
from uniffy.infrastructure.valkey.ops import get_ops_client

logger = logger.bind(component="agents.skills.evaluations.jobs.jobs")


async def _execute(run_id: UUID) -> None:
    if not await claim_evaluation(run_id):
        return
    async with open_session() as session:
        run = await session.get(AgentSkillEvaluationRun, run_id)
        if run is None:
            return
        session.expunge(run)
        snapshot = run.snapshot
        usage = RunUsageAccumulator()
        started = time.monotonic()
        result = None
        error = None
        judge_result = {"status": JudgeStatus.NOT_REQUESTED}
        model = ""
        key_id = None
        calls = 0
        tool_rounds = 0
        accounting = EvaluationAccounting()
        try:
            async with asyncio.timeout(EVALUATION_TIMEOUT_SECONDS):
                await require_evaluation_agent(
                    session,
                    user_id=run.owner_id,
                    organization_id=run.organization_id,
                    agent_id=run.agent_id,
                )
                agent = Agent(
                    id=run.agent_id,
                    organization_id=run.organization_id,
                    owner_id=run.owner_id,
                    **snapshot["agent"],
                )
                try:
                    provider, key_id, model = await resolve_provider_and_model(
                        session,
                        ProviderOperations(session),
                        organization_id=run.organization_id,
                        agent=agent,
                        model_override=snapshot["model_override"] or None,
                    )
                except NotFoundError, ValidationError:
                    error = SkillEvaluationError.PROVIDER_REQUIRED
                if error is None:

                    async def complete(
                        messages: list[dict], system: str, tools: list[dict]
                    ) -> CompletionResult:
                        nonlocal calls
                        await BudgetsOperations(session).check_preflight(
                            user_id=run.owner_id, organization_id=run.organization_id
                        )
                        params = resolve_request_params(
                            agent_params=agent.model_params or {},
                            override_params={},
                            provider=provider.name,
                            model_id=model,
                        )
                        await session.rollback()
                        response = await provider.chat_completion(
                            messages=messages,
                            model=model,
                            system=system,
                            tools=tools or None,
                            stream=False,
                            params=params,
                            safety_identifier=safety_identifier(
                                organization_id=run.organization_id, user_id=run.owner_id
                            ),
                        )
                        calls += 1
                        if not isinstance(response, CompletionResult):
                            raise ValidationError("evaluation", "Invalid provider response")
                        usage.record_result(
                            provider=provider.name,
                            provider_key_id=key_id,
                            result=response,
                            model=model,
                        )
                        return response

                    case = CaseFields.model_validate(snapshot["case"])
                    result = await evaluate(
                        complete,
                        case=case,
                        system_prompt=snapshot["system_prompt"],
                        schemas=snapshot["schemas"],
                    )
                    tool_rounds = max(calls - 1, 0)
                    if snapshot["judge"] and case.rubric:
                        original_provider, original_key, original_model = provider, key_id, model
                        try:
                            provider, key_id, model = await resolve_provider_and_model(
                                session,
                                ProviderOperations(session),
                                organization_id=run.organization_id,
                                agent=agent,
                                model_override=snapshot["judge_model"] or original_model,
                            )
                            judge_result = await judge(complete, case=case, result=result)
                        except BudgetExceededError:
                            judge_result = {"status": JudgeStatus.ERROR, "error": "budget_exceeded"}
                        except NotFoundError, ValidationError:
                            judge_result = {
                                "status": JudgeStatus.ERROR,
                                "error": "provider_required",
                            }
                        except Exception:
                            judge_result = {"status": JudgeStatus.ERROR, "error": "provider_error"}
                        finally:
                            provider, key_id, model = original_provider, original_key, original_model
        except PermissionDeniedError, NotFoundError:
            error = SkillEvaluationError.ACCESS_REVOKED
        except BudgetExceededError:
            error = SkillEvaluationError.BUDGET_EXCEEDED
        except ValidationError:
            error = SkillEvaluationError.INVALID_RESPONSE
        except TimeoutError, asyncio.CancelledError:
            if result is None:
                error = SkillEvaluationError.INTERRUPTED
            else:
                judge_result = {"status": JudgeStatus.ERROR, "error": "interrupted"}
        except Exception:
            error = SkillEvaluationError.PROVIDER_ERROR
            logger.warning("Evaluation provider failed", evaluation_id=str(run_id))
        finally:
            duration_ms = int((time.monotonic() - started) * 1000)
            if model:
                await session.rollback()
                run_log_id = await RunRecorder(session).record(
                    session_id=None,
                    agent_id=run.agent_id,
                    user_id=run.owner_id,
                    organization_id=run.organization_id,
                    model=model,
                    usage=usage,
                    tool_calls=None,
                    tool_iterations=tool_rounds,
                    duration_ms=duration_ms,
                    status=AgentRunStatus.ERROR if error else AgentRunStatus.SUCCESS,
                    error=error,
                    provider_key_id=key_id,
                    kind=AgentRunKind.EVALUATION,
                )
                log = await session.get(AgentRunLog, run_log_id) if run_log_id else None
                accounting = EvaluationAccounting(
                    model=model,
                    run_log_id=run_log_id,
                    cost=log.cost if log else None,
                    cost_currency=log.cost_currency if log else None,
                    input_tokens=usage.input_tokens,
                    output_tokens=usage.output_tokens,
                    duration_ms=duration_ms,
                )
            await finish_evaluation(
                run_id,
                result=result if error is None else None,
                error=error,
                judge_result=judge_result,
                accounting=accounting,
            )


async def run_skill_evaluation(ctx: dict[str, Any], run_id: str) -> None:
    identifier = UUID(run_id)
    client = get_ops_client()
    if client is None:
        await finish_evaluation(
            identifier, error=SkillEvaluationError.QUEUE_UNAVAILABLE, only_queued=True
        )
        return
    key = f"skill-evaluation-lock:{identifier}"
    token = None
    try:
        token = await acquire_owned_job_lock(client, key, EVALUATION_TIMEOUT_SECONDS + 60)
        if token is not None:
            await _execute(identifier)
    except Exception:
        logger.warning("Evaluation worker failed", evaluation_id=run_id)
        await finish_evaluation(identifier, error=SkillEvaluationError.INTERRUPTED)
    finally:
        if token is not None:
            try:
                await release_owned_job_lock(client, key, token)
            except Exception:
                logger.warning("Evaluation lock release failed", evaluation_id=run_id)


async def expire_skill_evaluations(ctx: dict[str, Any]) -> None:
    async with open_session() as session:
        overdue = (
            (
                await session.execute(
                    select(AgentSkillEvaluationRun.id)
                    .where(
                        AgentSkillEvaluationRun.status.in_(OPEN_EVALUATION_STATUSES),
                        AgentSkillEvaluationRun.deadline_at < datetime.now(UTC),
                    )
                    .order_by(AgentSkillEvaluationRun.deadline_at, AgentSkillEvaluationRun.id)
                    .limit(100)
                )
            )
            .scalars()
            .all()
        )
    for run_id in overdue:
        await finish_evaluation(run_id, error=SkillEvaluationError.INTERRUPTED, only_if_expired=True)
