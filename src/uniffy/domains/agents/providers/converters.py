"""Proto <-> domain converters for providers."""

from uniffy_proto.agents.v1.providers_pb2 import (
    CREDENTIAL_TYPE_API_KEY,
    CREDENTIAL_TYPE_SETUP_TOKEN,
    CREDENTIAL_TYPE_UNSPECIFIED,
    CredentialType,
    ProviderKeyInfo,
)
from uniffy_proto.agents.v1.providers_pb2 import (
    ModelInfo as ProtoModelInfo,
)

from uniffy.core.converters import datetime_to_timestamp
from uniffy.core.converters.common_proto import (
    access_mode_to_proto,
    content_role_to_proto,
)
from uniffy.core.models.agents.provider_key import ProviderKey
from uniffy.core.types import AccessMode, ContentRole
from uniffy.domains.agents.providers.base import ModelInfo as DomainModelInfo

# Domain credential_type string <-> proto enum mappings

CREDENTIAL_TYPE_TO_PROTO: dict[str, CredentialType] = {
    "api_key": CREDENTIAL_TYPE_API_KEY,
    "setup_token": CREDENTIAL_TYPE_SETUP_TOKEN,
}

CREDENTIAL_TYPE_FROM_PROTO: dict[int, str] = {
    CREDENTIAL_TYPE_API_KEY: "api_key",
    CREDENTIAL_TYPE_SETUP_TOKEN: "setup_token",
}


def credential_type_to_proto(cred_type: str) -> CredentialType:
    """Convert domain credential type string to proto enum.

    Parameters
    ----------
    cred_type : str
        Domain credential type (e.g. "api_key", "setup_token").

    Returns
    -------
    CredentialType
        Proto enum value.

    """
    return CREDENTIAL_TYPE_TO_PROTO.get(cred_type, CREDENTIAL_TYPE_UNSPECIFIED)


def credential_type_from_proto(proto_type: CredentialType) -> str:
    """Convert proto credential type enum to domain string.

    Parameters
    ----------
    proto_type : CredentialType
        Proto enum value.

    Returns
    -------
    str
        Domain credential type string.

    """
    return CREDENTIAL_TYPE_FROM_PROTO.get(proto_type, "api_key")


def provider_key_to_proto(
    key: ProviderKey,
    effective_access_mode: AccessMode | None = None,
    effective_baseline_role: ContentRole | None = None,
) -> ProviderKeyInfo:
    """Convert a ProviderKey model to proto ProviderKeyInfo.

    Parameters
    ----------
    key : ProviderKey
        Database model instance.

    Returns
    -------
    ProviderKeyInfo
        Proto message (credential never included).

    """
    resolved_mode = (
        effective_access_mode if effective_access_mode is not None else key.access_mode
    )
    resolved_baseline = (
        effective_baseline_role
        if effective_baseline_role is not None
        else key.baseline_role
    )

    info = ProviderKeyInfo(
        id=str(key.id),
        provider=key.provider,
        credential_type=credential_type_to_proto(key.credential_type),
        label=key.label,
        key_hint=key.key_hint,
        is_valid=key.is_valid,
        is_enabled=key.is_enabled,
        created_at=datetime_to_timestamp(key.created_at),
        updated_at=datetime_to_timestamp(key.updated_at),
        created_by=str(key.created_by),
        access_mode=access_mode_to_proto(resolved_mode) if resolved_mode is not None else 0,
    )

    if resolved_baseline is not None:
        info.baseline_role = content_role_to_proto(resolved_baseline)

    if key.last_validated_at:
        info.last_validated_at.CopyFrom(datetime_to_timestamp(key.last_validated_at))

    if key.last_used_at:
        info.last_used_at.CopyFrom(datetime_to_timestamp(key.last_used_at))

    if key.last_error:
        info.last_error = key.last_error

    return info


def model_info_to_proto(model: DomainModelInfo) -> ProtoModelInfo:
    """Convert a domain ModelInfo to proto ModelInfo.

    Parameters
    ----------
    model : DomainModelInfo
        Domain model info dataclass.

    Returns
    -------
    ProtoModelInfo
        Proto message.

    """
    return ProtoModelInfo(
        id=model.id,
        display_name=model.display_name,
        provider=model.provider,
        context_window=model.context_window,
        supports_tools=model.supports_tools,
        supports_vision=model.supports_vision,
        supports_thinking=model.supports_thinking,
    )
