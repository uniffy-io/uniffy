from base64 import b64decode, urlsafe_b64encode
from binascii import Error as Base64Error
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import NotFoundError, ValidationError
from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.agents.skill_evaluation_run import AgentSkillEvaluationRun
from uniffy.domains.agents.access import require_agents_builder
from uniffy.domains.agents.agents.operations import AgentOperations
from uniffy.domains.agents.skills.evaluations.access import EvaluationScope, resolve_scope


async def require_evaluation_agent(
    session: AsyncSession, *, user_id: UUID, organization_id: UUID, agent_id: UUID
) -> Agent:
    await require_agents_builder(session, user_id, organization_id)
    return await AgentOperations(session).get_for_runtime(user_id, organization_id, agent_id)


class EvaluationReader:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get(
        self, *, user_id: UUID, organization_id: UUID, run_id: UUID
    ) -> AgentSkillEvaluationRun:
        await require_agents_builder(self.session, user_id, organization_id)
        run = (
            await self.session.execute(
                select(AgentSkillEvaluationRun).where(
                    AgentSkillEvaluationRun.id == run_id,
                    AgentSkillEvaluationRun.organization_id == organization_id,
                )
            )
        ).scalar_one_or_none()
        if run is None:
            raise NotFoundError("EvaluationRun", str(run_id))
        await require_evaluation_agent(
            self.session, user_id=user_id, organization_id=organization_id, agent_id=run.agent_id
        )
        return run

    async def list(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        agent_id: UUID,
        scope: EvaluationScope,
        page_size: int = 20,
        cursor: str = "",
    ) -> tuple[list[AgentSkillEvaluationRun], str]:
        await require_evaluation_agent(
            self.session, user_id=user_id, organization_id=organization_id, agent_id=agent_id
        )
        scope = await resolve_scope(self.session, organization_id, scope)
        page_size = min(max(page_size or 20, 1), 50)
        query = select(AgentSkillEvaluationRun).where(
            AgentSkillEvaluationRun.organization_id == organization_id,
            AgentSkillEvaluationRun.agent_id == agent_id,
            AgentSkillEvaluationRun.skill_id == scope.skill_id
            if scope.skill_id is not None
            else AgentSkillEvaluationRun.draft_id == scope.draft_id,
        )
        if cursor:
            try:
                if len(cursor) > 64:
                    raise ValueError
                after_id = UUID(bytes=b64decode(cursor, altchars=b"-_", validate=True))
            except (ValueError, Base64Error) as exc:
                raise ValidationError("cursor", "Invalid pagination cursor") from exc
            query = query.where(AgentSkillEvaluationRun.id < after_id)
        rows = list(
            (
                await self.session.execute(
                    query.order_by(AgentSkillEvaluationRun.id.desc()).limit(page_size + 1)
                )
            )
            .scalars()
            .all()
        )
        page = rows[:page_size]
        next_cursor = urlsafe_b64encode(page[-1].id.bytes).decode() if len(rows) > page_size else ""
        return page, next_cursor
