from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.errors import NotFoundError, ValidationError
from uniffy.core.models.agents.skill_evaluation_case import AgentSkillEvaluationCase
from uniffy.core.models.agents.skill_evaluation_run import AgentSkillEvaluationRun
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.login.organization import Organization
from uniffy.domains.agents.access import require_agents_builder
from uniffy.domains.agents.skills.evaluations.access import EvaluationScope, resolve_scope
from uniffy.domains.agents.skills.evaluations.schemas import MAX_CASES, clean_case_fields


def case_scope_filter(scope: EvaluationScope):
    return (
        AgentSkillEvaluationCase.skill_id == scope.skill_id
        if scope.skill_id is not None
        else AgentSkillEvaluationCase.draft_id == scope.draft_id
    )


async def lock_evaluation_admission(session: AsyncSession, organization_id: UUID) -> None:
    await session.execute(
        select(Organization.id).where(Organization.id == organization_id).with_for_update()
    )


async def stage_publish_evaluations(
    session: AsyncSession, *, organization_id: UUID, draft_id: UUID, skill_id: UUID
) -> None:
    count = await session.scalar(
        select(func.count())
        .select_from(AgentSkillEvaluationCase)
        .where(
            AgentSkillEvaluationCase.organization_id == organization_id,
            AgentSkillEvaluationCase.is_deleted.is_(False),
            or_(
                AgentSkillEvaluationCase.skill_id == skill_id,
                AgentSkillEvaluationCase.draft_id == draft_id,
            ),
        )
    )
    if (count or 0) > MAX_CASES:
        raise ValidationError(
            "cases",
            "Remove evaluation cases before combining these libraries; a skill supports at most 25",
        )
    await session.execute(
        update(AgentSkillEvaluationCase)
        .where(
            AgentSkillEvaluationCase.organization_id == organization_id,
            AgentSkillEvaluationCase.draft_id == draft_id,
        )
        .values(skill_id=skill_id, draft_id=None)
    )
    await session.execute(
        update(AgentSkillEvaluationRun)
        .where(
            AgentSkillEvaluationRun.organization_id == organization_id,
            AgentSkillEvaluationRun.draft_id == draft_id,
        )
        .values(skill_id=skill_id)
    )


class EvaluationCases:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list(
        self, *, user_id: UUID, organization_id: UUID, scope: EvaluationScope
    ) -> list[AgentSkillEvaluationCase]:
        await require_agents_builder(self.session, user_id, organization_id)
        scope = await resolve_scope(self.session, organization_id, scope)
        return list(
            (
                await self.session.execute(
                    select(AgentSkillEvaluationCase)
                    .where(
                        AgentSkillEvaluationCase.organization_id == organization_id,
                        case_scope_filter(scope),
                        AgentSkillEvaluationCase.is_deleted.is_(False),
                    )
                    .order_by(AgentSkillEvaluationCase.created_at, AgentSkillEvaluationCase.id)
                    .limit(MAX_CASES)
                )
            )
            .scalars()
            .all()
        )

    async def create(
        self, *, user_id: UUID, organization_id: UUID, scope: EvaluationScope, fields: dict
    ) -> AgentSkillEvaluationCase:
        await require_agents_builder(self.session, user_id, organization_id)
        fields = clean_case_fields(fields).model_dump()
        await lock_evaluation_admission(self.session, organization_id)
        scope = await resolve_scope(self.session, organization_id, scope)
        count = await self.session.scalar(
            select(func.count())
            .select_from(AgentSkillEvaluationCase)
            .where(
                AgentSkillEvaluationCase.organization_id == organization_id,
                case_scope_filter(scope),
                AgentSkillEvaluationCase.is_deleted.is_(False),
            )
        )
        if count >= MAX_CASES:
            raise ValidationError("cases", "A skill can have at most 25 evaluation cases")
        case = AgentSkillEvaluationCase(
            organization_id=organization_id,
            owner_id=user_id,
            skill_id=scope.skill_id,
            draft_id=scope.draft_id,
            fields=fields,
        )
        self.session.add(case)
        await self._audit(case, user_id, Action.AGENT_EVALUATION_CASE_CREATED)
        await self.session.commit()
        await self.session.refresh(case)
        return case

    async def update(
        self, *, user_id: UUID, organization_id: UUID, case_id: UUID, fields: dict
    ) -> AgentSkillEvaluationCase:
        await require_agents_builder(self.session, user_id, organization_id)
        fields = clean_case_fields(fields).model_dump()
        case = await self._get(organization_id, case_id)
        case.fields = fields
        case.updated_at = datetime.now(UTC)
        await self._audit(case, user_id, Action.AGENT_EVALUATION_CASE_UPDATED)
        await self.session.commit()
        await self.session.refresh(case)
        return case

    async def delete(self, *, user_id: UUID, organization_id: UUID, case_id: UUID) -> None:
        await require_agents_builder(self.session, user_id, organization_id)
        case = await self._get(organization_id, case_id)
        case.is_deleted = True
        case.deleted_at = datetime.now(UTC)
        await self._audit(case, user_id, Action.AGENT_EVALUATION_CASE_DELETED)
        await self.session.commit()

    async def _get(self, organization_id: UUID, case_id: UUID) -> AgentSkillEvaluationCase:
        await lock_evaluation_admission(self.session, organization_id)
        case = (
            await self.session.execute(
                select(AgentSkillEvaluationCase)
                .where(
                    AgentSkillEvaluationCase.organization_id == organization_id,
                    AgentSkillEvaluationCase.id == case_id,
                    AgentSkillEvaluationCase.is_deleted.is_(False),
                )
                .with_for_update()
            )
        ).scalar_one_or_none()
        if case is None:
            raise NotFoundError("EvaluationCase", str(case_id))
        await resolve_scope(
            self.session,
            organization_id,
            EvaluationScope(skill_id=case.skill_id, draft_id=case.draft_id),
        )
        return case

    async def _audit(self, case: AgentSkillEvaluationCase, user_id: UUID, action: Action) -> None:
        await write_audit_event(
            self.session,
            organization_id=case.organization_id,
            actor_user_id=user_id,
            action=action,
            resource_type=AuditResourceType.SKILL_EVALUATION_CASE,
            resource_id=case.id,
        )
