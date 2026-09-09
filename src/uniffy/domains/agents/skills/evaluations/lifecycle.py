from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID

from loguru import logger
from sqlalchemy import select, update

from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.jobs import JobEnqueueOutcome, enqueue_job_reconnecting
from uniffy.core.models.agents.skill_evaluation_run import (
    OPEN_EVALUATION_STATUSES,
    AgentSkillEvaluationRun,
    SkillEvaluationError,
    SkillEvaluationStatus,
)
from uniffy.domains.agents.skills.evaluations.jobs.contracts import RUN_SKILL_EVALUATION
from uniffy.domains.agents.skills.evaluations.observability import record_evaluation_state
from uniffy.domains.agents.skills.evaluations.reader import require_evaluation_agent
from uniffy.domains.agents.skills.evaluations.runner import EvaluationResult
from uniffy.domains.agents.skills.evaluations.schemas import EVALUATION_TIMEOUT_SECONDS
from uniffy.infrastructure.database import open_session

logger = logger.bind(component="agents.skills.evaluations.lifecycle")


@dataclass(frozen=True)
class EvaluationAccounting:
    model: str = ""
    run_log_id: UUID | None = None
    cost: Decimal | None = None
    cost_currency: str | None = None
    input_tokens: int = 0
    output_tokens: int = 0
    duration_ms: int = 0


async def claim_evaluation(run_id: UUID) -> bool:
    async with open_session() as session:
        changed = await session.execute(
            update(AgentSkillEvaluationRun)
            .where(
                AgentSkillEvaluationRun.id == run_id,
                AgentSkillEvaluationRun.status == SkillEvaluationStatus.QUEUED,
                AgentSkillEvaluationRun.deadline_at > datetime.now(UTC),
            )
            .values(
                status=SkillEvaluationStatus.RUNNING,
                started_at=datetime.now(UTC),
                deadline_at=datetime.now(UTC) + timedelta(seconds=EVALUATION_TIMEOUT_SECONDS + 60),
            )
            .returning(AgentSkillEvaluationRun.id)
        )
        claimed = changed.scalar_one_or_none() is not None
        await session.commit()
        if claimed:
            run = await session.get(AgentSkillEvaluationRun, run_id)
            record_evaluation_state(run)
        return claimed


async def finish_evaluation(
    run_id: UUID,
    *,
    result: EvaluationResult | None = None,
    error: SkillEvaluationError | None = None,
    judge_result: dict | None = None,
    accounting: EvaluationAccounting | None = None,
    only_queued: bool = False,
    only_if_expired: bool = False,
) -> None:
    async with open_session() as session:
        run = (
            await session.execute(
                select(AgentSkillEvaluationRun)
                .where(
                    AgentSkillEvaluationRun.id == run_id,
                    AgentSkillEvaluationRun.status.in_(OPEN_EVALUATION_STATUSES),
                )
                .with_for_update()
            )
        ).scalar_one_or_none()
        if run is None or (only_queued and run.status != SkillEvaluationStatus.QUEUED):
            return
        if only_if_expired and run.deadline_at >= datetime.now(UTC):
            return
        if result is not None:
            try:
                await require_evaluation_agent(
                    session,
                    user_id=run.owner_id,
                    organization_id=run.organization_id,
                    agent_id=run.agent_id,
                )
            except PermissionDeniedError, NotFoundError:
                result = None
                error = SkillEvaluationError.ACCESS_REVOKED
                judge_result = None
        run.status = result.status if result else SkillEvaluationStatus.ERROR
        run.error = error
        run.completed_at = datetime.now(UTC)
        if result is not None:
            run.output = result.output
            run.observations = result.observations
        run.judge_result = judge_result or {}
        for key, value in asdict(accounting or EvaluationAccounting()).items():
            setattr(run, key, value)
        await session.commit()
        await session.refresh(run)
        record_evaluation_state(run)


async def enqueue_evaluation(run_id: UUID) -> None:
    try:
        result = await enqueue_job_reconnecting(
            RUN_SKILL_EVALUATION, str(run_id), _job_id=f"skill-evaluation:{run_id}"
        )
        if result.outcome in (JobEnqueueOutcome.ENQUEUED, JobEnqueueOutcome.DEDUPLICATED):
            return
    except Exception:
        logger.warning("Evaluation queue unavailable", evaluation_id=str(run_id))
    await finish_evaluation(run_id, error=SkillEvaluationError.QUEUE_UNAVAILABLE, only_queued=True)
