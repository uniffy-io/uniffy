import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from common.v1 import common_pb2 as _common_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class AgentInfo(_message.Message):
    __slots__ = ("id", "organization_id", "owner_id", "name", "soul_prompt", "primary_model", "fallback_models", "enabled_tools", "avatar_emoji", "theme_color", "is_default", "created_at", "updated_at", "enabled_skills", "access_mode", "avatar_key", "image_model", "primary_provider_key_id", "image_provider_key_id", "prompt_id", "baseline_role", "user_role")
    ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    OWNER_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    SOUL_PROMPT_FIELD_NUMBER: _ClassVar[int]
    PRIMARY_MODEL_FIELD_NUMBER: _ClassVar[int]
    FALLBACK_MODELS_FIELD_NUMBER: _ClassVar[int]
    ENABLED_TOOLS_FIELD_NUMBER: _ClassVar[int]
    AVATAR_EMOJI_FIELD_NUMBER: _ClassVar[int]
    THEME_COLOR_FIELD_NUMBER: _ClassVar[int]
    IS_DEFAULT_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    ENABLED_SKILLS_FIELD_NUMBER: _ClassVar[int]
    ACCESS_MODE_FIELD_NUMBER: _ClassVar[int]
    AVATAR_KEY_FIELD_NUMBER: _ClassVar[int]
    IMAGE_MODEL_FIELD_NUMBER: _ClassVar[int]
    PRIMARY_PROVIDER_KEY_ID_FIELD_NUMBER: _ClassVar[int]
    IMAGE_PROVIDER_KEY_ID_FIELD_NUMBER: _ClassVar[int]
    PROMPT_ID_FIELD_NUMBER: _ClassVar[int]
    BASELINE_ROLE_FIELD_NUMBER: _ClassVar[int]
    USER_ROLE_FIELD_NUMBER: _ClassVar[int]
    id: str
    organization_id: str
    owner_id: str
    name: str
    soul_prompt: str
    primary_model: str
    fallback_models: _containers.RepeatedScalarFieldContainer[str]
    enabled_tools: _containers.RepeatedScalarFieldContainer[str]
    avatar_emoji: str
    theme_color: str
    is_default: bool
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    enabled_skills: _containers.RepeatedScalarFieldContainer[str]
    access_mode: _common_pb2.AccessMode
    avatar_key: str
    image_model: str
    primary_provider_key_id: str
    image_provider_key_id: str
    prompt_id: str
    baseline_role: _common_pb2.ContentRole
    user_role: _common_pb2.ContentRole
    def __init__(self, id: _Optional[str] = ..., organization_id: _Optional[str] = ..., owner_id: _Optional[str] = ..., name: _Optional[str] = ..., soul_prompt: _Optional[str] = ..., primary_model: _Optional[str] = ..., fallback_models: _Optional[_Iterable[str]] = ..., enabled_tools: _Optional[_Iterable[str]] = ..., avatar_emoji: _Optional[str] = ..., theme_color: _Optional[str] = ..., is_default: _Optional[bool] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., enabled_skills: _Optional[_Iterable[str]] = ..., access_mode: _Optional[_Union[_common_pb2.AccessMode, str]] = ..., avatar_key: _Optional[str] = ..., image_model: _Optional[str] = ..., primary_provider_key_id: _Optional[str] = ..., image_provider_key_id: _Optional[str] = ..., prompt_id: _Optional[str] = ..., baseline_role: _Optional[_Union[_common_pb2.ContentRole, str]] = ..., user_role: _Optional[_Union[_common_pb2.ContentRole, str]] = ...) -> None: ...

class CreateAgentRequest(_message.Message):
    __slots__ = ("organization_id", "name", "soul_prompt", "primary_model", "fallback_models", "avatar_emoji", "theme_color", "is_default", "enabled_skills", "access_mode", "group_ids", "image_model", "primary_provider_key_id", "image_provider_key_id", "prompt_id", "baseline_role")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    SOUL_PROMPT_FIELD_NUMBER: _ClassVar[int]
    PRIMARY_MODEL_FIELD_NUMBER: _ClassVar[int]
    FALLBACK_MODELS_FIELD_NUMBER: _ClassVar[int]
    AVATAR_EMOJI_FIELD_NUMBER: _ClassVar[int]
    THEME_COLOR_FIELD_NUMBER: _ClassVar[int]
    IS_DEFAULT_FIELD_NUMBER: _ClassVar[int]
    ENABLED_SKILLS_FIELD_NUMBER: _ClassVar[int]
    ACCESS_MODE_FIELD_NUMBER: _ClassVar[int]
    GROUP_IDS_FIELD_NUMBER: _ClassVar[int]
    IMAGE_MODEL_FIELD_NUMBER: _ClassVar[int]
    PRIMARY_PROVIDER_KEY_ID_FIELD_NUMBER: _ClassVar[int]
    IMAGE_PROVIDER_KEY_ID_FIELD_NUMBER: _ClassVar[int]
    PROMPT_ID_FIELD_NUMBER: _ClassVar[int]
    BASELINE_ROLE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    name: str
    soul_prompt: str
    primary_model: str
    fallback_models: _containers.RepeatedScalarFieldContainer[str]
    avatar_emoji: str
    theme_color: str
    is_default: bool
    enabled_skills: _containers.RepeatedScalarFieldContainer[str]
    access_mode: _common_pb2.AccessMode
    group_ids: _containers.RepeatedScalarFieldContainer[str]
    image_model: str
    primary_provider_key_id: str
    image_provider_key_id: str
    prompt_id: str
    baseline_role: _common_pb2.ContentRole
    def __init__(self, organization_id: _Optional[str] = ..., name: _Optional[str] = ..., soul_prompt: _Optional[str] = ..., primary_model: _Optional[str] = ..., fallback_models: _Optional[_Iterable[str]] = ..., avatar_emoji: _Optional[str] = ..., theme_color: _Optional[str] = ..., is_default: _Optional[bool] = ..., enabled_skills: _Optional[_Iterable[str]] = ..., access_mode: _Optional[_Union[_common_pb2.AccessMode, str]] = ..., group_ids: _Optional[_Iterable[str]] = ..., image_model: _Optional[str] = ..., primary_provider_key_id: _Optional[str] = ..., image_provider_key_id: _Optional[str] = ..., prompt_id: _Optional[str] = ..., baseline_role: _Optional[_Union[_common_pb2.ContentRole, str]] = ...) -> None: ...

class AgentResponse(_message.Message):
    __slots__ = ("agent",)
    AGENT_FIELD_NUMBER: _ClassVar[int]
    agent: AgentInfo
    def __init__(self, agent: _Optional[_Union[AgentInfo, _Mapping]] = ...) -> None: ...

class GetAgentRequest(_message.Message):
    __slots__ = ("organization_id", "agent_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    agent_id: str
    def __init__(self, organization_id: _Optional[str] = ..., agent_id: _Optional[str] = ...) -> None: ...

class ListAgentsRequest(_message.Message):
    __slots__ = ("organization_id", "pagination", "access_mode", "personal_only", "group_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    ACCESS_MODE_FIELD_NUMBER: _ClassVar[int]
    PERSONAL_ONLY_FIELD_NUMBER: _ClassVar[int]
    GROUP_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    pagination: _common_pb2.PaginationRequest
    access_mode: _common_pb2.AccessMode
    personal_only: bool
    group_id: str
    def __init__(self, organization_id: _Optional[str] = ..., pagination: _Optional[_Union[_common_pb2.PaginationRequest, _Mapping]] = ..., access_mode: _Optional[_Union[_common_pb2.AccessMode, str]] = ..., personal_only: _Optional[bool] = ..., group_id: _Optional[str] = ...) -> None: ...

class ListAgentsResponse(_message.Message):
    __slots__ = ("agents", "pagination")
    AGENTS_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    agents: _containers.RepeatedCompositeFieldContainer[AgentInfo]
    pagination: _common_pb2.PaginationResponse
    def __init__(self, agents: _Optional[_Iterable[_Union[AgentInfo, _Mapping]]] = ..., pagination: _Optional[_Union[_common_pb2.PaginationResponse, _Mapping]] = ...) -> None: ...

class UpdateAgentRequest(_message.Message):
    __slots__ = ("organization_id", "agent_id", "name", "soul_prompt", "primary_model", "fallback_models", "avatar_emoji", "theme_color", "is_default", "enabled_skills", "access_mode", "group_ids", "enabled_tools", "image_model", "primary_provider_key_id", "image_provider_key_id", "prompt_id", "clear_prompt", "baseline_role")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    SOUL_PROMPT_FIELD_NUMBER: _ClassVar[int]
    PRIMARY_MODEL_FIELD_NUMBER: _ClassVar[int]
    FALLBACK_MODELS_FIELD_NUMBER: _ClassVar[int]
    AVATAR_EMOJI_FIELD_NUMBER: _ClassVar[int]
    THEME_COLOR_FIELD_NUMBER: _ClassVar[int]
    IS_DEFAULT_FIELD_NUMBER: _ClassVar[int]
    ENABLED_SKILLS_FIELD_NUMBER: _ClassVar[int]
    ACCESS_MODE_FIELD_NUMBER: _ClassVar[int]
    GROUP_IDS_FIELD_NUMBER: _ClassVar[int]
    ENABLED_TOOLS_FIELD_NUMBER: _ClassVar[int]
    IMAGE_MODEL_FIELD_NUMBER: _ClassVar[int]
    PRIMARY_PROVIDER_KEY_ID_FIELD_NUMBER: _ClassVar[int]
    IMAGE_PROVIDER_KEY_ID_FIELD_NUMBER: _ClassVar[int]
    PROMPT_ID_FIELD_NUMBER: _ClassVar[int]
    CLEAR_PROMPT_FIELD_NUMBER: _ClassVar[int]
    BASELINE_ROLE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    agent_id: str
    name: str
    soul_prompt: str
    primary_model: str
    fallback_models: _containers.RepeatedScalarFieldContainer[str]
    avatar_emoji: str
    theme_color: str
    is_default: bool
    enabled_skills: _containers.RepeatedScalarFieldContainer[str]
    access_mode: _common_pb2.AccessMode
    group_ids: _containers.RepeatedScalarFieldContainer[str]
    enabled_tools: _containers.RepeatedScalarFieldContainer[str]
    image_model: str
    primary_provider_key_id: str
    image_provider_key_id: str
    prompt_id: str
    clear_prompt: bool
    baseline_role: _common_pb2.ContentRole
    def __init__(self, organization_id: _Optional[str] = ..., agent_id: _Optional[str] = ..., name: _Optional[str] = ..., soul_prompt: _Optional[str] = ..., primary_model: _Optional[str] = ..., fallback_models: _Optional[_Iterable[str]] = ..., avatar_emoji: _Optional[str] = ..., theme_color: _Optional[str] = ..., is_default: _Optional[bool] = ..., enabled_skills: _Optional[_Iterable[str]] = ..., access_mode: _Optional[_Union[_common_pb2.AccessMode, str]] = ..., group_ids: _Optional[_Iterable[str]] = ..., enabled_tools: _Optional[_Iterable[str]] = ..., image_model: _Optional[str] = ..., primary_provider_key_id: _Optional[str] = ..., image_provider_key_id: _Optional[str] = ..., prompt_id: _Optional[str] = ..., clear_prompt: _Optional[bool] = ..., baseline_role: _Optional[_Union[_common_pb2.ContentRole, str]] = ...) -> None: ...

class DeleteAgentRequest(_message.Message):
    __slots__ = ("organization_id", "agent_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    agent_id: str
    def __init__(self, organization_id: _Optional[str] = ..., agent_id: _Optional[str] = ...) -> None: ...

class DeleteAgentResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...

class UploadAgentAvatarRequest(_message.Message):
    __slots__ = ("organization_id", "agent_id", "image_data", "filename")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    IMAGE_DATA_FIELD_NUMBER: _ClassVar[int]
    FILENAME_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    agent_id: str
    image_data: bytes
    filename: str
    def __init__(self, organization_id: _Optional[str] = ..., agent_id: _Optional[str] = ..., image_data: _Optional[bytes] = ..., filename: _Optional[str] = ...) -> None: ...

class DeleteAgentAvatarRequest(_message.Message):
    __slots__ = ("organization_id", "agent_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    agent_id: str
    def __init__(self, organization_id: _Optional[str] = ..., agent_id: _Optional[str] = ...) -> None: ...

class PreviewSystemPromptRequest(_message.Message):
    __slots__ = ("organization_id", "agent_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    agent_id: str
    def __init__(self, organization_id: _Optional[str] = ..., agent_id: _Optional[str] = ...) -> None: ...

class PreviewSystemPromptResponse(_message.Message):
    __slots__ = ("system_prompt",)
    SYSTEM_PROMPT_FIELD_NUMBER: _ClassVar[int]
    system_prompt: str
    def __init__(self, system_prompt: _Optional[str] = ...) -> None: ...
