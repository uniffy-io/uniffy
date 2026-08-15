"""Proto <-> domain converters for providers."""

from uniffy_proto.agents.v1.providers_pb2 import (
    ModelInfo as ProtoModelInfo,
)
from uniffy_proto.agents.v1.providers_pb2 import ProviderKeyInfo

from uniffy.core.converters import datetime_to_timestamp
from uniffy.core.json_codec import dumps_str
from uniffy.core.models.agents.provider_key import ProviderKey
from uniffy.domains.agents.pricing import image_price_estimates
from uniffy.domains.agents.providers.base import ModelInfo as DomainModelInfo
from uniffy.domains.agents.providers.catalog import (
    get_image_parameter_schema,
    get_parameter_schema,
)


def provider_key_to_proto(
    key: ProviderKey,
    *,
    include_diagnostics: bool = False,
) -> ProviderKeyInfo:
    """Build the client-facing key message; the credential is never included.

    ``last_error`` is unredacted provider/transport text and only an org admin
    can act on it, so it rides only when the caller asks for diagnostics.
    """
    info = ProviderKeyInfo(
        id=str(key.id),
        provider=key.provider,
        label=key.label,
        key_hint=key.key_hint,
        is_valid=key.is_valid,
        is_enabled=key.is_enabled,
        created_at=datetime_to_timestamp(key.created_at),
        updated_at=datetime_to_timestamp(key.updated_at),
        created_by=str(key.created_by),
    )

    if key.last_validated_at:
        info.last_validated_at.CopyFrom(datetime_to_timestamp(key.last_validated_at))

    if key.last_used_at:
        info.last_used_at.CopyFrom(datetime_to_timestamp(key.last_used_at))

    if include_diagnostics and key.last_error:
        info.last_error = key.last_error

    return info


def model_info_to_proto(model: DomainModelInfo) -> ProtoModelInfo:
    return ProtoModelInfo(
        id=model.id,
        display_name=model.display_name,
        provider=model.provider,
        context_window=model.context_window,
        supports_tools=model.supports_tools,
        supports_vision=model.supports_vision,
        supports_thinking=model.supports_thinking,
        supports_image_generation=model.supports_image_generation,
        catalog_known=model.catalog_known,
        default_max_tokens=model.default_max_tokens or 0,
        supports_prompt_cache=model.supports_prompt_cache,
        deprecated=model.deprecated,
        reasoning_levels=list(model.reasoning_levels),
        default_reasoning_effort=model.default_reasoning_effort or "",
        input_per_1m=str(model.input_per_1m) if model.input_per_1m is not None else "",
        output_per_1m=str(model.output_per_1m) if model.output_per_1m is not None else "",
        cache_read_per_1m=str(model.cache_read_per_1m)
        if model.cache_read_per_1m is not None
        else "",
        cache_write_per_1m=str(model.cache_write_per_1m)
        if model.cache_write_per_1m is not None
        else "",
        parameter_schema_json=_parameter_schema_json(model),
        image_parameter_schema_json=_image_parameter_schema_json(model),
        image_price_estimates_json=_image_price_estimates_json(model),
    )


def _parameter_schema_json(model: DomainModelInfo) -> str:
    if not model.catalog_known:
        return ""
    schema = get_parameter_schema(model.provider, model.id)
    return dumps_str(schema) if schema else ""


def _image_parameter_schema_json(model: DomainModelInfo) -> str:
    if not model.catalog_known:
        return ""
    schema = get_image_parameter_schema(model.provider, model.id)
    return dumps_str(schema) if schema else ""


def _image_price_estimates_json(model: DomainModelInfo) -> str:
    if not (model.catalog_known and model.supports_image_generation):
        return ""
    estimates = image_price_estimates(model.provider, model.id)
    return dumps_str(estimates) if estimates else ""
