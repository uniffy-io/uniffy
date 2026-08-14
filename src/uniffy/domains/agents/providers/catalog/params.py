"""Validate and resolve tuned model-parameter values against the catalog schema."""

from loguru import logger

from uniffy.domains.agents.providers.catalog.loader import get_catalog, get_model
from uniffy.domains.agents.providers.catalog.schema import REASONING_KNOB
from uniffy.observability.metrics import AGENT_MODEL_PARAM_DROPPED_TOTAL

logger = logger.bind(component="agents.providers.catalog.params")


def validate_model_params(provider: str, model_id: str, params: dict) -> None:
    """Raise ``ValueError`` when ``params`` violates the model's schema.

    Empty params are always valid. A model without a catalog entry has no
    schema, so only empty params pass for it.
    """
    if not params:
        return
    pc = get_catalog().providers.get(provider)
    model = get_model(provider, model_id)
    if pc is None or model is None:
        raise ValueError(f"model {model_id!r} has no parameter schema")

    for knob, value in params.items():
        if knob == "provider_options":
            if not isinstance(value, dict):
                raise ValueError("provider_options must be an object")
            for opt_key, opt_value in value.items():
                spec = pc.provider_options.get(opt_key)
                if spec is None:
                    raise ValueError(f"unknown provider option {opt_key!r}")
                if opt_key in model.unsupported_provider_options:
                    raise ValueError(f"model {model_id!r} does not accept {opt_key!r}")
                spec.check_value(opt_key, opt_value)
            continue
        if knob == REASONING_KNOB:
            if not model.can_reason:
                raise ValueError(f"model {model_id!r} does not support reasoning")
            levels = (
                ["off", *model.reasoning_levels] if model.reasoning_levels else ["off", "on"]
            )
            if value not in levels:
                raise ValueError(f"{REASONING_KNOB} {value!r} not in {levels}")
            continue
        spec = pc.params_base.get(knob)
        if spec is None:
            raise ValueError(f"unknown parameter {knob!r}")
        if knob in model.unsupported_params:
            raise ValueError(f"model {model_id!r} does not accept {knob!r}")
        spec.check_value(knob, value)
        if knob == "max_tokens":
            ceiling = model.default_max_tokens or model.context_window
            if isinstance(value, int) and value > ceiling:
                raise ValueError(f"max_tokens {value} above model ceiling {ceiling}")


def resolve_request_params(
    agent_params: dict | None,
    override_params: dict | None,
    provider: str,
    model_id: str,
) -> dict:
    """Merge channel-binding overrides over agent values for one request.

    The result is stripped to what the TARGET model accepts (the stored
    values were validated against their layer's effective model, but a
    model override or fallback can land the request elsewhere).
    Dropping with a warning beats failing the whole run.
    """
    base = agent_params or {}
    over = override_params or {}
    merged: dict = {**base, **over}
    nested = {
        **(base.get("provider_options") or {}),
        **(over.get("provider_options") or {}),
    }
    if nested:
        merged["provider_options"] = nested
    if not merged:
        return {}

    kept: dict = {}
    for knob, value in merged.items():
        if knob == "provider_options":
            kept_nested = {}
            for opt_key, opt_value in value.items():
                try:
                    validate_model_params(
                        provider, model_id, {"provider_options": {opt_key: opt_value}},
                    )
                except ValueError as exc:
                    AGENT_MODEL_PARAM_DROPPED_TOTAL.labels(
                        provider=provider, param=opt_key,
                    ).inc()
                    logger.warning(
                        "Dropped provider option not valid for the target model",
                        model=model_id,
                        param=opt_key,
                        reason=str(exc),
                    )
                    continue
                kept_nested[opt_key] = opt_value
            if kept_nested:
                kept["provider_options"] = kept_nested
            continue
        try:
            validate_model_params(provider, model_id, {knob: value})
        except ValueError as exc:
            AGENT_MODEL_PARAM_DROPPED_TOTAL.labels(provider=provider, param=knob).inc()
            logger.warning(
                "Dropped model param not valid for the target model",
                model=model_id,
                param=knob,
                reason=str(exc),
            )
            continue
        kept[knob] = value
    return kept
