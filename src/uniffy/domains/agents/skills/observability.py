from uuid import UUID

from loguru import logger
from prometheus_client import Counter

from uniffy.core.models.agents.skill_draft import AgentSkillDraft
from uniffy.core.models.agents.skill_invocation import (
    SkillInvocationErrorCode,
    SkillInvocationStatus,
)

logger = logger.bind(component="agents.skills.observability")

SKILL_INVOCATION_OUTCOMES = Counter(
    "uniffy_agent_skill_invocation_outcomes_total",
    "Persisted terminal skill invocation outcomes",
    ["status", "error"],
)
SKILL_GENERATION_STATES = Counter(
    "uniffy_agent_skill_generation_states_total",
    "Committed explicit skill generation transitions",
    ["status", "error"],
)


def record_invocation_outcome(
    *,
    invocation_id: UUID,
    organization_id: UUID,
    status: SkillInvocationStatus,
    error_code: SkillInvocationErrorCode | None,
    run_log_id: UUID | None,
    response_message_id: UUID | None,
) -> None:
    SKILL_INVOCATION_OUTCOMES.labels(status=status, error=error_code or "none").inc()
    logger.info(
        "Skill invocation settled",
        invocation_id=str(invocation_id),
        organization_id=str(organization_id),
        status=status,
        error_code=error_code,
        run_log_id=str(run_log_id) if run_log_id else None,
        response_message_id=str(response_message_id) if response_message_id else None,
    )


def record_generation_state(draft: AgentSkillDraft) -> None:
    SKILL_GENERATION_STATES.labels(status=draft.status, error=draft.generation_error or "none").inc()
    logger.info(
        "Skill generation transitioned",
        organization_id=str(draft.organization_id),
        draft_id=str(draft.id),
        invocation_id=str(draft.invocation_id) if draft.invocation_id else None,
        skill_version_id=str(draft.target_version_id) if draft.target_version_id else None,
        attempt=draft.generation_attempt,
        status=draft.status,
        error_code=draft.generation_error,
    )
