"""Proto <-> domain converters for skills."""

from uniffy_proto.agents.v1.skills_pb2 import (
    SKILL_SOURCE_BUNDLED,
    SKILL_SOURCE_ORGANIZATION,
    SKILL_SOURCE_UNSPECIFIED,
    RunnableSkill,
    SkillDraft,
    SkillInfo,
    SkillSource,
    SkillVersion,
)

from uniffy.core.converters import datetime_to_timestamp
from uniffy.core.models.agents.skill import AgentSkill
from uniffy.core.models.agents.skill_draft import AgentSkillDraft
from uniffy.core.models.agents.skill_version import AgentSkillVersion
from uniffy.domains.agents.skills.resolution import SkillSummary

SKILL_SOURCE_TO_PROTO: dict[str, SkillSource] = {
    "bundled": SKILL_SOURCE_BUNDLED,
    "organization": SKILL_SOURCE_ORGANIZATION,
}

SKILL_SOURCE_FROM_PROTO: dict[int, str] = {
    SKILL_SOURCE_BUNDLED: "bundled",
    SKILL_SOURCE_ORGANIZATION: "organization",
}


def skill_source_to_proto(source: str) -> SkillSource:
    return SKILL_SOURCE_TO_PROTO.get(source, SKILL_SOURCE_UNSPECIFIED)


def skill_source_from_proto(proto_source: SkillSource) -> str:
    return SKILL_SOURCE_FROM_PROTO.get(proto_source, "bundled")


def skill_to_proto(skill: AgentSkill, *, active_version_number: int | None = None) -> SkillInfo:
    """Convert a AgentSkill model to proto SkillInfo.

    ``active_version_number`` is the main version's number, resolved by the
    caller against ``active_version_id``. When omitted it falls back to the
    latest, which is correct for the unpinned (follow-latest) default.
    """
    info = SkillInfo(
        id=str(skill.id),
        name=skill.name,
        display_name=skill.display_name,
        description=skill.description or "",
        content=skill.content or "",
        source=skill_source_to_proto(skill.source),
        created_at=datetime_to_timestamp(skill.created_at),
        updated_at=datetime_to_timestamp(skill.updated_at),
        requires_tools=list(skill.requires_tools or []),
        supported_surfaces=list(skill.supported_surfaces or []),
        status=skill.status or "active",
        origin=skill.origin or "user",
        latest_version_number=skill.latest_version_number or 1,
        active_version_number=active_version_number
        if active_version_number is not None
        else (skill.latest_version_number or 1),
        active_version_pinned=bool(skill.active_version_pinned),
    )

    if skill.organization_id is not None:
        info.organization_id = str(skill.organization_id)

    return info


def runnable_skill_to_proto(skill: SkillSummary) -> RunnableSkill:
    """Convert a skill to the lean slash-menu entry (no content)."""
    return RunnableSkill(
        id=str(skill.id),
        name=skill.name,
        display_name=skill.display_name,
        description=skill.description or "",
    )


def skill_version_to_proto(version: AgentSkillVersion) -> SkillVersion:
    """Convert an immutable version snapshot to proto."""
    proto = SkillVersion(
        id=str(version.id),
        skill_id=str(version.skill_id),
        version_number=version.version_number,
        name=version.name,
        display_name=version.display_name,
        description=version.description or "",
        content=version.content or "",
        requires_tools=list(version.requires_tools or []),
        supported_surfaces=list(version.supported_surfaces or []),
        author_kind=version.author_kind or "user",
        change_summary=version.change_summary or "",
        created_at=datetime_to_timestamp(version.created_at),
    )
    if version.author_id is not None:
        proto.author_id = str(version.author_id)
    if version.parent_version_id is not None:
        proto.parent_version_id = str(version.parent_version_id)
    return proto


def skill_draft_to_proto(draft: AgentSkillDraft) -> SkillDraft:
    """Convert a pending draft to proto for the review card / drafts inbox."""
    proto = SkillDraft(
        id=str(draft.id),
        organization_id=str(draft.organization_id),
        owner_id=str(draft.owner_id),
        kind=draft.kind,
        evidence_message_ids=[str(m) for m in (draft.evidence_message_ids or [])],
        rationale=draft.rationale or "",
        name=draft.name or "",
        display_name=draft.display_name or "",
        description=draft.description or "",
        content=draft.content or "",
        requires_tools=list(draft.requires_tools or []),
        supported_surfaces=list(draft.supported_surfaces or []),
        status=draft.status or "pending",
        created_at=datetime_to_timestamp(draft.created_at),
        updated_at=datetime_to_timestamp(draft.updated_at),
    )
    if draft.target_skill_id is not None:
        proto.target_skill_id = str(draft.target_skill_id)
    if draft.proposed_by_agent_id is not None:
        proto.proposed_by_agent_id = str(draft.proposed_by_agent_id)
    if draft.session_id is not None:
        proto.session_id = str(draft.session_id)
    if draft.channel_id is not None:
        proto.channel_id = str(draft.channel_id)
    if draft.origin_chat_message_id is not None:
        proto.origin_chat_message_id = str(draft.origin_chat_message_id)
    return proto
