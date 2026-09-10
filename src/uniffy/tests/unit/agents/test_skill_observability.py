from unittest.mock import Mock

from uniffy.core.json_codec import dumps_str
from uniffy.core.models.agents.skill_draft import (
    AgentSkillDraft,
    AgentSkillDraftKind,
    AgentSkillDraftStatus,
)
from uniffy.core.models.agents.skill_invocation import SkillInvocationStatus
from uniffy.core.types import generate_id
from uniffy.domains.agents.skills import observability


def test_generation_observations_exclude_content_and_identifier_labels(monkeypatch):
    logger = Mock()
    monkeypatch.setattr(observability, "logger", logger)
    draft = AgentSkillDraft(
        organization_id=generate_id(),
        owner_id=generate_id(),
        kind=AgentSkillDraftKind.CREATE,
        name="private-name",
        content="private-content",
        rationale="private-explanation",
        status=AgentSkillDraftStatus.PENDING,
        generation_attempt=1,
    )
    observability.record_generation_state(draft)
    details = logger.info.call_args.kwargs
    assert details["draft_id"] == str(draft.id)
    assert "private-" not in dumps_str(details)
    for metric in observability.SKILL_GENERATION_STATES.collect():
        for sample in metric.samples:
            assert set(sample.labels) <= {"status", "error"}
            assert str(draft.id) not in sample.labels.values()


def test_invocation_observations_correlate_without_response_content(monkeypatch):
    logger = Mock()
    monkeypatch.setattr(observability, "logger", logger)
    invocation_id, response_id = generate_id(), generate_id()
    observability.record_invocation_outcome(
        invocation_id=invocation_id,
        organization_id=generate_id(),
        status=SkillInvocationStatus.COMPLETED,
        error_code=None,
        run_log_id=None,
        response_message_id=response_id,
    )
    details = logger.info.call_args.kwargs
    assert details["invocation_id"] == str(invocation_id)
    assert details["response_message_id"] == str(response_id)
    assert "content" not in details
    for metric in observability.SKILL_INVOCATION_OUTCOMES.collect():
        for sample in metric.samples:
            assert set(sample.labels) <= {"status", "error"}
