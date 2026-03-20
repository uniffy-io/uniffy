"""Proto <-> domain converters for sessions and messages."""

import json

from uniffy_proto.agents.v1.sessions_pb2 import (
    MESSAGE_ROLE_ASSISTANT,
    MESSAGE_ROLE_SUMMARY,
    MESSAGE_ROLE_SYSTEM,
    MESSAGE_ROLE_TOOL,
    MESSAGE_ROLE_UNSPECIFIED,
    MESSAGE_ROLE_USER,
    SESSION_KIND_DIRECT,
    SESSION_KIND_GLOBAL,
    SESSION_KIND_GROUP,
    SESSION_KIND_UNSPECIFIED,
    MessageInfo,
    MessageRole,
    SessionInfo,
    SessionKind,
)

from uniffy.core.converters import datetime_to_timestamp
from uniffy.core.models.agents.message import AgentMessage
from uniffy.core.models.agents.session import AgentSession

# --- Session Kind mappings ---

SESSION_KIND_TO_PROTO: dict[str, SessionKind] = {
    "direct": SESSION_KIND_DIRECT,
    "group": SESSION_KIND_GROUP,
    "global": SESSION_KIND_GLOBAL,
}

SESSION_KIND_FROM_PROTO: dict[int, str] = {
    SESSION_KIND_DIRECT: "direct",
    SESSION_KIND_GROUP: "group",
    SESSION_KIND_GLOBAL: "global",
}


def session_kind_to_proto(kind: str) -> SessionKind:
    """Convert domain session kind string to proto enum.

    Parameters
    ----------
    kind : str
        Domain session kind (e.g. "direct", "group", "global").

    Returns
    -------
    SessionKind
        Proto enum value.

    """
    return SESSION_KIND_TO_PROTO.get(kind, SESSION_KIND_UNSPECIFIED)


def session_kind_from_proto(proto_kind: SessionKind) -> str:
    """Convert proto session kind enum to domain string.

    Parameters
    ----------
    proto_kind : SessionKind
        Proto enum value.

    Returns
    -------
    str
        Domain session kind string.

    """
    return SESSION_KIND_FROM_PROTO.get(proto_kind, "direct")


# --- Message Role mappings ---

MESSAGE_ROLE_TO_PROTO: dict[str, MessageRole] = {
    "user": MESSAGE_ROLE_USER,
    "assistant": MESSAGE_ROLE_ASSISTANT,
    "tool": MESSAGE_ROLE_TOOL,
    "system": MESSAGE_ROLE_SYSTEM,
    "summary": MESSAGE_ROLE_SUMMARY,
}

MESSAGE_ROLE_FROM_PROTO: dict[int, str] = {
    MESSAGE_ROLE_USER: "user",
    MESSAGE_ROLE_ASSISTANT: "assistant",
    MESSAGE_ROLE_TOOL: "tool",
    MESSAGE_ROLE_SYSTEM: "system",
    MESSAGE_ROLE_SUMMARY: "summary",
}


def message_role_to_proto(role: str) -> MessageRole:
    """Convert domain message role string to proto enum.

    Parameters
    ----------
    role : str
        Domain message role (e.g. "user", "assistant", "tool").

    Returns
    -------
    MessageRole
        Proto enum value.

    """
    return MESSAGE_ROLE_TO_PROTO.get(role, MESSAGE_ROLE_UNSPECIFIED)


def message_role_from_proto(proto_role: MessageRole) -> str:
    """Convert proto message role enum to domain string.

    Parameters
    ----------
    proto_role : MessageRole
        Proto enum value.

    Returns
    -------
    str
        Domain message role string.

    """
    return MESSAGE_ROLE_FROM_PROTO.get(proto_role, "user")


# --- Model converters ---


def session_to_proto(session: AgentSession) -> SessionInfo:
    """Convert a AgentSession model to proto SessionInfo.

    Parameters
    ----------
    session : AgentSession
        Database model instance.

    Returns
    -------
    SessionInfo
        Proto message.

    """
    info = SessionInfo(
        id=str(session.id),
        organization_id=str(session.organization_id),
        agent_id=str(session.agent_id),
        user_id=str(session.user_id),
        kind=session_kind_to_proto(session.kind),
        total_input_tokens=session.total_input_tokens,
        total_output_tokens=session.total_output_tokens,
        message_count=session.message_count,
        is_archived=session.is_archived,
        created_at=datetime_to_timestamp(session.created_at),
        updated_at=datetime_to_timestamp(session.updated_at),
    )

    if session.display_name:
        info.display_name = session.display_name

    if session.model_override:
        info.model_override = session.model_override

    if session.last_model_used:
        info.last_model_used = session.last_model_used

    return info


def message_to_proto(message: AgentMessage) -> MessageInfo:
    """Convert a AgentMessage model to proto MessageInfo.

    Parameters
    ----------
    message : AgentMessage
        Database model instance.

    Returns
    -------
    MessageInfo
        Proto message.

    """
    info = MessageInfo(
        id=str(message.id),
        session_id=str(message.session_id),
        role=message_role_to_proto(message.role),
        input_tokens=message.input_tokens,
        output_tokens=message.output_tokens,
        is_thinking=message.is_thinking,
        is_compacted=message.is_compacted,
        created_at=datetime_to_timestamp(message.created_at),
    )

    if message.content is not None:
        info.content = message.content

    if message.model:
        info.model = message.model

    if message.tool_name:
        info.tool_name = message.tool_name

    if message.tool_call_id:
        info.tool_call_id = message.tool_call_id

    if message.tool_args is not None:
        info.tool_args_json = json.dumps(message.tool_args)

    if message.tool_result is not None:
        info.tool_result = message.tool_result

    if message.file_ids:
        info.file_ids.extend(message.file_ids)

    return info
