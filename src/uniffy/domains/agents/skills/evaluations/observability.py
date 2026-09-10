from loguru import logger
from prometheus_client import Counter

from uniffy.core.models.agents.skill_evaluation_run import AgentSkillEvaluationRun

logger = logger.bind(component="agents.skills.evaluations.observability")

SKILL_EVALUATION_STATES = Counter(
    "uniffy_agent_skill_evaluation_states_total",
    "Committed explicitly requested skill evaluation transitions",
    ["status", "error"],
)


def record_evaluation_state(run: AgentSkillEvaluationRun) -> None:
    SKILL_EVALUATION_STATES.labels(status=run.status, error=run.error or "none").inc()
    logger.info(
        "Skill evaluation transitioned",
        organization_id=str(run.organization_id),
        evaluation_id=str(run.id),
        request_id=str(run.request_id),
        case_id=str(run.case_id),
        agent_id=str(run.agent_id),
        target_digest=run.target_digest,
        status=run.status,
        error_code=run.error,
        run_log_id=str(run.run_log_id) if run.run_log_id else None,
    )
