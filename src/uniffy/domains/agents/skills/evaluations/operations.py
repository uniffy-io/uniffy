import asyncio
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import func, select

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.errors import ValidationError
from uniffy.core.models.agents.skill_evaluation_case import AgentSkillEvaluationCase
from uniffy.core.models.agents.skill_evaluation_run import (
    OPEN_EVALUATION_STATUSES,
    AgentSkillEvaluationRun,
)
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.domains.agents.skills.evaluations.access import EvaluationTarget, resolve_target
from uniffy.domains.agents.skills.evaluations.cases import (
    case_scope_filter,
    lock_evaluation_admission,
)
from uniffy.domains.agents.skills.evaluations.lifecycle import enqueue_evaluation
from uniffy.domains.agents.skills.evaluations.observability import record_evaluation_state
from uniffy.domains.agents.skills.evaluations.reader import (
    EvaluationReader,
    require_evaluation_agent,
)
from uniffy.domains.agents.skills.evaluations.schemas import (
    EVALUATION_QUEUE_SECONDS,
    MAX_CASES,
    MAX_OPEN_RUNS,
    snapshot_digest,
)
from uniffy.domains.agents.skills.evaluations.snapshots import capture_configuration


class EvaluationOperations(EvaluationReader):
    async def request(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        request_id: UUID,
        agent_id: UUID,
        target: EvaluationTarget,
        case_ids: list[UUID],
        judge: bool = False,
        model_override: str = "",
        judge_model: str = "",
    ) -> list[AgentSkillEvaluationRun]:
        agent = await require_evaluation_agent(
            self.session, user_id=user_id, organization_id=organization_id, agent_id=agent_id
        )
        if len(case_ids) > MAX_CASES or len(set(case_ids)) != len(case_ids):
            raise ValidationError("cases", "Select at most 25 distinct evaluation cases")
        digest = snapshot_digest({
            "agent_id": str(agent_id),
            "skill_version_id": str(target.skill_version_id) if target.skill_version_id else None,
            "draft_id": str(target.draft_id) if target.draft_id else None,
            "draft_content": target.draft_content,
            "case_ids": sorted(str(value) for value in case_ids),
            "judge": judge,
            "model_override": model_override,
            "judge_model": judge_model,
        })
        await lock_evaluation_admission(self.session, organization_id)
        existing = list(
            (
                await self.session.execute(
                    select(AgentSkillEvaluationRun)
                    .where(
                        AgentSkillEvaluationRun.organization_id == organization_id,
                        AgentSkillEvaluationRun.request_id == request_id,
                    )
                    .order_by(AgentSkillEvaluationRun.id)
                    .limit(MAX_CASES)
                )
            )
            .scalars()
            .all()
        )
        if existing:
            if any(run.owner_id != user_id or run.request_digest != digest for run in existing):
                raise ValidationError(
                    "request_id", "This evaluation request ID has already been used"
                )
            return existing
        scope, skill = await resolve_target(self.session, organization_id, target)
        query = select(AgentSkillEvaluationCase).where(
            AgentSkillEvaluationCase.organization_id == organization_id,
            case_scope_filter(scope),
            AgentSkillEvaluationCase.is_deleted.is_(False),
        )
        if case_ids:
            query = query.where(AgentSkillEvaluationCase.id.in_(case_ids))
        cases = list(
            (
                await self.session.execute(
                    query.order_by(AgentSkillEvaluationCase.id).limit(MAX_CASES + 1)
                )
            )
            .scalars()
            .all()
        )
        if (
            not cases
            or len(cases) > MAX_CASES
            or (case_ids and {case.id for case in cases} != set(case_ids))
        ):
            raise ValidationError("cases", "The selected evaluation cases are unavailable")
        open_runs = (
            await self.session.scalar(
                select(func.count())
                .select_from(AgentSkillEvaluationRun)
                .where(
                    AgentSkillEvaluationRun.organization_id == organization_id,
                    AgentSkillEvaluationRun.status.in_(OPEN_EVALUATION_STATUSES),
                )
            )
            or 0
        )
        if open_runs + len(cases) > MAX_OPEN_RUNS:
            raise ValidationError("evaluation", "Wait for current evaluations to finish")
        configuration = await capture_configuration(
            self.session,
            organization_id=organization_id,
            agent=agent,
            skill=skill,
            model_override=model_override,
            judge_model=judge_model,
        )
        target_digest = snapshot_digest(skill)
        runs = [
            AgentSkillEvaluationRun(
                organization_id=organization_id,
                owner_id=user_id,
                request_id=request_id,
                request_digest=digest,
                case_id=case.id,
                agent_id=agent_id,
                skill_id=scope.skill_id,
                skill_version_id=target.skill_version_id,
                version_number=skill["version_number"],
                draft_id=target.draft_id,
                target_digest=target_digest,
                snapshot={**configuration, "case": case.fields, "judge": judge},
                deadline_at=datetime.now(UTC) + timedelta(seconds=EVALUATION_QUEUE_SECONDS),
            )
            for case in cases
        ]
        self.session.add_all(runs)
        await write_audit_event(
            self.session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=Action.AGENT_EVALUATION_REQUESTED,
            resource_type=AuditResourceType.SKILL_EVALUATION_RUN,
            resource_id=request_id,
            details={
                "agent_id": str(agent_id),
                "run_ids": [str(run.id) for run in runs],
                "judge": judge,
                "target_digest": target_digest,
            },
        )
        await self.session.commit()
        for run in runs:
            record_evaluation_state(run)
        await asyncio.gather(*(enqueue_evaluation(run.id) for run in runs))
        return list(
            (
                await self.session.execute(
                    select(AgentSkillEvaluationRun)
                    .where(
                        AgentSkillEvaluationRun.organization_id == organization_id,
                        AgentSkillEvaluationRun.request_id == request_id,
                    )
                    .order_by(AgentSkillEvaluationRun.id)
                    .execution_options(populate_existing=True)
                )
            )
            .scalars()
            .all()
        )
