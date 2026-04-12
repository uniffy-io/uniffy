"""Proto <-> domain converters for prompts."""

from uniffy_proto.agents.v1.prompts_pb2 import (
    PROMPT_SOURCE_BUNDLED,
    PROMPT_SOURCE_ORGANIZATION,
    PROMPT_SOURCE_PERSONAL,
    PROMPT_SOURCE_UNSPECIFIED,
    PromptInfo,
    PromptSource,
)

from uniffy.core.converters import datetime_to_timestamp
from uniffy.core.converters.common_proto import (
    access_mode_to_proto,
    content_role_to_proto,
)
from uniffy.core.models.agents.prompt import AgentPrompt

# --- Prompt Source mappings ---

PROMPT_SOURCE_TO_PROTO: dict[str, PromptSource] = {
    "bundled": PROMPT_SOURCE_BUNDLED,
    "organization": PROMPT_SOURCE_ORGANIZATION,
    "personal": PROMPT_SOURCE_PERSONAL,
}

PROMPT_SOURCE_FROM_PROTO: dict[int, str] = {
    PROMPT_SOURCE_BUNDLED: "bundled",
    PROMPT_SOURCE_ORGANIZATION: "organization",
    PROMPT_SOURCE_PERSONAL: "personal",
}


def prompt_source_to_proto(source: str) -> PromptSource:
    """Convert domain prompt source string to proto enum.

    Parameters
    ----------
    source : str
        Domain prompt source (e.g. "bundled", "organization").

    Returns
    -------
    PromptSource
        Proto enum value.

    """
    return PROMPT_SOURCE_TO_PROTO.get(source, PROMPT_SOURCE_UNSPECIFIED)


def prompt_source_from_proto(proto_source: PromptSource) -> str:
    """Convert proto prompt source enum to domain string.

    Parameters
    ----------
    proto_source : PromptSource
        Proto enum value.

    Returns
    -------
    str
        Domain prompt source string.

    """
    return PROMPT_SOURCE_FROM_PROTO.get(proto_source, "bundled")


def prompt_to_proto(prompt: AgentPrompt) -> PromptInfo:
    """Convert an AgentPrompt model to proto PromptInfo.

    Parameters
    ----------
    prompt : AgentPrompt
        Database model instance.

    Returns
    -------
    PromptInfo
        Proto message.

    """
    info = PromptInfo(
        id=str(prompt.id),
        name=prompt.name,
        display_name=prompt.display_name,
        description=prompt.description or "",
        content=prompt.content or "",
        source=prompt_source_to_proto(prompt.source),
        created_at=datetime_to_timestamp(prompt.created_at),
        updated_at=datetime_to_timestamp(prompt.updated_at),
        access_mode=access_mode_to_proto(prompt.access_mode),
        created_by=str(prompt.created_by) if prompt.created_by else "",
    )

    if prompt.baseline_role is not None:
        info.baseline_role = content_role_to_proto(prompt.baseline_role)

    if prompt.organization_id is not None:
        info.organization_id = str(prompt.organization_id)

    if prompt.owner_id is not None:
        info.owner_id = str(prompt.owner_id)

    return info
