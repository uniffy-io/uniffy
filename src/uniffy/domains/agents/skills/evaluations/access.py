from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import NotFoundError, ValidationError
from uniffy.core.models.agents.skill import AgentSkill, SkillSurface
from uniffy.core.models.agents.skill_draft import AgentSkillDraft, AgentSkillDraftStatus
from uniffy.core.models.agents.skill_version import AgentSkillVersion
from uniffy.domains.agents.skills.validation import clean_skill_write


@dataclass(frozen=True)
class EvaluationScope:
    skill_id: UUID | None = None
    draft_id: UUID | None = None

    def __post_init__(self) -> None:
        if (self.skill_id is None) == (self.draft_id is None):
            raise ValidationError("scope", "Select one skill or pending draft")


@dataclass(frozen=True)
class EvaluationTarget:
    skill_version_id: UUID | None = None
    draft_id: UUID | None = None
    draft_content: str | None = None

    def __post_init__(self) -> None:
        if (self.skill_version_id is None) == (self.draft_id is None):
            raise ValidationError("target", "Select one skill version or pending draft")
        if self.draft_content is not None and self.draft_id is None:
            raise ValidationError("draft_content", "Editor content requires a pending draft")


async def load_skill(session: AsyncSession, organization_id: UUID, skill_id: UUID) -> AgentSkill:
    skill = (
        await session.execute(
            select(AgentSkill).where(
                AgentSkill.id == skill_id,
                or_(
                    AgentSkill.organization_id == organization_id,
                    AgentSkill.organization_id.is_(None),
                ),
            )
        )
    ).scalar_one_or_none()
    if skill is None:
        raise NotFoundError("AgentSkill", str(skill_id))
    return skill


async def load_draft(
    session: AsyncSession, organization_id: UUID, draft_id: UUID
) -> AgentSkillDraft:
    draft = (
        await session.execute(
            select(AgentSkillDraft).where(
                AgentSkillDraft.id == draft_id,
                AgentSkillDraft.organization_id == organization_id,
                AgentSkillDraft.is_deleted.is_(False),
            )
        )
    ).scalar_one_or_none()
    if draft is None:
        raise NotFoundError("AgentSkillDraft", str(draft_id))
    if draft.status != AgentSkillDraftStatus.PENDING:
        raise ValidationError("draft", "Only a pending draft can be evaluated")
    return draft


async def resolve_scope(
    session: AsyncSession, organization_id: UUID, scope: EvaluationScope
) -> EvaluationScope:
    if scope.skill_id is not None:
        await load_skill(session, organization_id, scope.skill_id)
        return scope
    draft = await load_draft(session, organization_id, scope.draft_id)
    if draft.target_skill_id is not None:
        await load_skill(session, organization_id, draft.target_skill_id)
        return EvaluationScope(skill_id=draft.target_skill_id)
    return scope


async def resolve_target(
    session: AsyncSession, organization_id: UUID, target: EvaluationTarget
) -> tuple[EvaluationScope, dict]:
    if target.skill_version_id is not None:
        version = await session.get(AgentSkillVersion, target.skill_version_id)
        if version is None:
            raise NotFoundError("AgentSkillVersion", str(target.skill_version_id))
        await load_skill(session, organization_id, version.skill_id)
        return EvaluationScope(skill_id=version.skill_id), {
            "id": str(version.skill_id),
            "version_id": str(version.id),
            "version_number": version.version_number,
            "name": version.name,
            "display_name": version.display_name,
            "description": version.description,
            "content": version.content,
            "requires_tools": list(version.requires_tools or []),
            "supported_surfaces": list(version.supported_surfaces or []),
        }
    draft = await load_draft(session, organization_id, target.draft_id)
    scope = await resolve_scope(session, organization_id, EvaluationScope(draft_id=draft.id))
    clean = clean_skill_write(
        name=draft.name or "draft",
        display_name=draft.display_name or "Draft",
        description=draft.description,
        content=target.draft_content if target.draft_content is not None else draft.content,
    )
    surfaces = [SkillSurface(value).value for value in draft.supported_surfaces]
    return scope, {
        "id": str(scope.skill_id or draft.id),
        "version_id": str(draft.id),
        "version_number": 0,
        "name": clean.name,
        "display_name": clean.display_name,
        "description": clean.description,
        "content": clean.content,
        "requires_tools": list(draft.requires_tools),
        "supported_surfaces": surfaces,
    }
