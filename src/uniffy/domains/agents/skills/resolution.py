"""Exact immutable skill snapshots for explicit runtime invocations."""

from dataclasses import dataclass
from enum import StrEnum
from hashlib import sha256
from uuid import UUID

from prometheus_client import Histogram
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.cache.operations import cache_get_or_set_locked
from uniffy.core.errors import ValidationError
from uniffy.core.models.agents.skill import AgentSkill, SkillSurface
from uniffy.core.models.agents.skill_version import AgentSkillVersion
from uniffy.domains.agents.cache import BUNDLED_SKILLS_TAG

SKILL_RESOLUTION_SECONDS = Histogram(
    "uniffy_agent_skill_resolution_seconds", "Explicit skill resolution latency"
)


class SkillInvocationFailure(StrEnum):
    UNAVAILABLE = "unavailable"
    MISSING_TOOLS = "missing_tools"
    UNSUPPORTED_SURFACE = "unsupported_surface"


class SkillInvocationError(ValidationError):
    def __init__(self, reason: SkillInvocationFailure) -> None:
        self.reason = reason
        messages = {
            SkillInvocationFailure.UNAVAILABLE: "The selected skill is unavailable for this agent",
            SkillInvocationFailure.MISSING_TOOLS: "Required skill tools are unavailable",
            SkillInvocationFailure.UNSUPPORTED_SURFACE: "Skill cannot run in this conversation",
        }
        super().__init__("invoked_skill_id", messages[reason])


@dataclass(frozen=True)
class SkillSummary:
    id: UUID
    version_id: UUID
    version_number: int
    name: str
    display_name: str
    description: str
    requires_tools: tuple[str, ...]
    supported_surfaces: tuple[SkillSurface, ...]


@dataclass(frozen=True)
class ResolvedSkill(SkillSummary):
    content: str


def _snapshot_query(organization_id: UUID, skill_ids: list[UUID], *, content: bool):
    columns = [
        AgentSkillVersion.skill_id,
        AgentSkillVersion.id,
        AgentSkillVersion.version_number,
        AgentSkillVersion.name,
        AgentSkillVersion.display_name,
        AgentSkillVersion.description,
        AgentSkillVersion.requires_tools,
        AgentSkillVersion.supported_surfaces,
    ]
    if content:
        columns.append(AgentSkillVersion.content)
    return (
        select(*columns)
        .join(
            AgentSkill,
            (AgentSkill.active_version_id == AgentSkillVersion.id)
            & (AgentSkill.id == AgentSkillVersion.skill_id),
        )
        .where(
            AgentSkill.id.in_(skill_ids),
            or_(AgentSkill.organization_id == organization_id, AgentSkill.organization_id.is_(None)),
        )
        .order_by(AgentSkillVersion.name, AgentSkillVersion.skill_id)
    )


def _validate_requirements(
    skill: SkillSummary, surface: SkillSurface, executable_tools: frozenset[str]
) -> None:
    if skill.supported_surfaces and surface not in skill.supported_surfaces:
        raise SkillInvocationError(SkillInvocationFailure.UNSUPPORTED_SURFACE)
    if not set(skill.requires_tools).issubset(executable_tools):
        raise SkillInvocationError(SkillInvocationFailure.MISSING_TOOLS)


async def resolve_runnable_skills(
    session: AsyncSession,
    *,
    organization_id: UUID,
    enabled_skill_ids: list[str],
    surface: SkillSurface,
    executable_tools: frozenset[str],
) -> list[SkillSummary]:
    summaries = await resolve_assigned_skill_summaries(
        session, organization_id=organization_id, enabled_skill_ids=enabled_skill_ids
    )
    result = []
    for skill in summaries:
        try:
            _validate_requirements(skill, surface, executable_tools)
        except SkillInvocationError:
            continue
        result.append(skill)
    return result


async def resolve_assigned_skill_summaries(
    session: AsyncSession,
    *,
    organization_id: UUID,
    enabled_skill_ids: list[str],
) -> list[SkillSummary]:
    if not enabled_skill_ids:
        return []
    skill_ids = sorted({UUID(value) for value in enabled_skill_ids})
    fingerprint = sha256(",".join(map(str, skill_ids)).encode()).hexdigest()

    async def load() -> dict:
        rows = (
            await session.execute(_snapshot_query(organization_id, skill_ids, content=False))
        ).all()
        return {
            "skills": [
                {
                    "id": str(row.skill_id),
                    "version_id": str(row.id),
                    "version_number": row.version_number,
                    "name": row.name,
                    "display_name": row.display_name,
                    "description": row.description,
                    "requires_tools": list(row.requires_tools),
                    "supported_surfaces": list(row.supported_surfaces),
                }
                for row in rows
            ]
        }

    payload = await cache_get_or_set_locked(
        f"skill_menu:{organization_id}:{fingerprint}",
        load,
        ttl=900,
        tags=[BUNDLED_SKILLS_TAG, *(f"skill_snapshot:{sid}" for sid in skill_ids)],
    )
    result = []
    for entry in (payload or {}).get("skills", []):
        try:
            skill = SkillSummary(**{
                **entry,
                "id": UUID(entry["id"]),
                "version_id": UUID(entry["version_id"]),
                "requires_tools": tuple(entry["requires_tools"]),
                "supported_surfaces": tuple(
                    SkillSurface(value) for value in entry["supported_surfaces"]
                ),
            })
        except ValueError:
            continue
        result.append(skill)
    return result


async def resolve_skill_invocation(
    session: AsyncSession,
    *,
    organization_id: UUID,
    enabled_skill_ids: list[str],
    invoked_skill_id: UUID | None,
    surface: SkillSurface,
    executable_tools: frozenset[str],
) -> ResolvedSkill | None:
    if invoked_skill_id is None:
        return None
    if str(invoked_skill_id) not in enabled_skill_ids:
        raise SkillInvocationError(SkillInvocationFailure.UNAVAILABLE)

    async def load() -> dict:
        row = (
            await session.execute(_snapshot_query(organization_id, [invoked_skill_id], content=True))
        ).one_or_none()
        if row is None:
            raise SkillInvocationError(SkillInvocationFailure.UNAVAILABLE)
        return {
            "id": str(row.skill_id),
            "version_id": str(row.id),
            "version_number": row.version_number,
            "name": row.name,
            "display_name": row.display_name,
            "description": row.description,
            "content": row.content,
            "requires_tools": list(row.requires_tools),
            "supported_surfaces": list(row.supported_surfaces),
        }

    with SKILL_RESOLUTION_SECONDS.time():
        payload = await cache_get_or_set_locked(
            f"skill_snapshot:{organization_id}:{invoked_skill_id}",
            load,
            ttl=900,
            tags=[f"skill_snapshot:{invoked_skill_id}", BUNDLED_SKILLS_TAG],
        )
    if payload is None:
        raise SkillInvocationError(SkillInvocationFailure.UNAVAILABLE)
    try:
        surfaces = tuple(SkillSurface(value) for value in payload["supported_surfaces"])
    except ValueError as exc:
        raise SkillInvocationError(SkillInvocationFailure.UNSUPPORTED_SURFACE) from exc
    resolved = ResolvedSkill(
        id=UUID(payload["id"]),
        version_id=UUID(payload["version_id"]),
        version_number=payload["version_number"],
        name=payload["name"],
        display_name=payload["display_name"],
        description=payload["description"],
        content=payload["content"],
        requires_tools=tuple(payload["requires_tools"]),
        supported_surfaces=surfaces,
    )
    _validate_requirements(resolved, surface, executable_tools)
    return resolved
