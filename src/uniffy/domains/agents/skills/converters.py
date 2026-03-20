"""Proto <-> domain converters for skills."""

from uniffy_proto.agents.v1.skills_pb2 import (
    SKILL_SOURCE_BUNDLED,
    SKILL_SOURCE_ORGANIZATION,
    SKILL_SOURCE_PERSONAL,
    SKILL_SOURCE_UNSPECIFIED,
    SkillInfo,
    SkillSource,
)

from uniffy.core.converters import datetime_to_timestamp
from uniffy.core.models.agents.skill import AgentSkill

# --- Skill Source mappings ---

SKILL_SOURCE_TO_PROTO: dict[str, SkillSource] = {
    "bundled": SKILL_SOURCE_BUNDLED,
    "organization": SKILL_SOURCE_ORGANIZATION,
    "personal": SKILL_SOURCE_PERSONAL,
}

SKILL_SOURCE_FROM_PROTO: dict[int, str] = {
    SKILL_SOURCE_BUNDLED: "bundled",
    SKILL_SOURCE_ORGANIZATION: "organization",
    SKILL_SOURCE_PERSONAL: "personal",
}


def skill_source_to_proto(source: str) -> SkillSource:
    """Convert domain skill source string to proto enum.

    Parameters
    ----------
    source : str
        Domain skill source (e.g. "bundled", "organization").

    Returns
    -------
    SkillSource
        Proto enum value.

    """
    return SKILL_SOURCE_TO_PROTO.get(source, SKILL_SOURCE_UNSPECIFIED)


def skill_source_from_proto(proto_source: SkillSource) -> str:
    """Convert proto skill source enum to domain string.

    Parameters
    ----------
    proto_source : SkillSource
        Proto enum value.

    Returns
    -------
    str
        Domain skill source string.

    """
    return SKILL_SOURCE_FROM_PROTO.get(proto_source, "bundled")


def skill_to_proto(skill: AgentSkill) -> SkillInfo:
    """Convert a AgentSkill model to proto SkillInfo.

    Parameters
    ----------
    skill : AgentSkill
        Database model instance.

    Returns
    -------
    SkillInfo
        Proto message.

    """
    info = SkillInfo(
        id=str(skill.id),
        name=skill.name,
        display_name=skill.display_name,
        description=skill.description or "",
        content=skill.content or "",
        source=skill_source_to_proto(skill.source),
        always_active=skill.always_active,
        created_at=datetime_to_timestamp(skill.created_at),
        updated_at=datetime_to_timestamp(skill.updated_at),
    )

    if skill.organization_id is not None:
        info.organization_id = str(skill.organization_id)

    if skill.owner_id is not None:
        info.owner_id = str(skill.owner_id)

    return info
