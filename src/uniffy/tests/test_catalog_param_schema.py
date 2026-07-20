"""Parameter-schema merge and catalog param validation."""

import pytest
from pydantic import ValidationError

from uniffy.domains.agents.providers.catalog import (
    Catalog,
    get_catalog,
    get_parameter_schema,
    resolve_request_params,
)
from uniffy.domains.agents.providers.catalog.loader import merge_parameter_schema
from uniffy.observability.metrics import AGENT_MODEL_PARAM_DROPPED_TOTAL

CORE_KNOBS = ("temperature", "top_p", "max_tokens")


def _synthetic(provider_extra: dict | None = None, model_extra: dict | None = None) -> dict:
    return {
        "schema_version": 1,
        "providers": {
            "acme": {
                "display_name": "Acme",
                "params_base": {
                    "temperature": {"type": "number", "minimum": 0, "maximum": 2},
                    "max_tokens": {"type": "integer", "minimum": 1, "default": 8192},
                },
                "provider_options": {
                    "top_k": {"type": "integer", "minimum": 1},
                },
                **(provider_extra or {}),
                "models": [
                    {
                        "id": "acme-1",
                        "name": "Acme One",
                        "context_window": 100000,
                        "default_max_tokens": 4096,
                        **(model_extra or {}),
                    },
                ],
            },
        },
    }


def test_every_provider_declares_core_knobs() -> None:
    for provider_id, pc in get_catalog().providers.items():
        for knob in CORE_KNOBS:
            assert knob in pc.params_base, f"{provider_id} missing {knob}"


def test_effort_enum_from_reasoning_levels() -> None:
    schema = get_parameter_schema("anthropic", "claude-fable-5")
    assert schema["reasoning_effort"]["enum"] == ["off", "low", "medium", "high", "xhigh", "max"]
    assert schema["reasoning_effort"]["default"] == "off"


def test_budget_reasoner_gets_on_off() -> None:
    schema = get_parameter_schema("anthropic", "claude-opus-4-1-20250805")
    assert schema["reasoning_effort"]["enum"] == ["off", "on"]


def test_non_reasoner_has_no_effort_knob() -> None:
    schema = get_parameter_schema("openai", "gpt-4o")
    assert "reasoning_effort" not in schema


def test_max_tokens_clamped_to_model_ceiling() -> None:
    schema = get_parameter_schema("anthropic", "claude-fable-5")
    assert schema["max_tokens"]["maximum"] == 126000
    assert schema["max_tokens"]["default"] == 8192


def test_unknown_ids_return_none() -> None:
    assert get_parameter_schema("openai", "no-such-model") is None
    assert get_parameter_schema("no-such-provider", "gpt-4o") is None


def test_model_options_override_defaults() -> None:
    catalog = Catalog.model_validate(
        _synthetic(model_extra={"options": {"temperature": 0.5, "provider_options": {"top_k": 40}}}),
    )
    pc = catalog.providers["acme"]
    schema = merge_parameter_schema(pc, pc.models[0])
    assert schema["temperature"]["default"] == 0.5
    assert schema["provider_options"]["top_k"]["default"] == 40


def test_default_clamped_to_small_ceiling() -> None:
    catalog = Catalog.model_validate(_synthetic())
    pc = catalog.providers["acme"]
    schema = merge_parameter_schema(pc, pc.models[0])
    assert schema["max_tokens"]["maximum"] == 4096
    assert schema["max_tokens"]["default"] == 4096


def test_undeclared_option_rejected() -> None:
    with pytest.raises(ValidationError, match="undeclared option"):
        Catalog.model_validate(_synthetic(model_extra={"options": {"presence_penalty": 1}}))


def test_undeclared_provider_option_rejected() -> None:
    with pytest.raises(ValidationError, match="undeclared provider option"):
        Catalog.model_validate(
            _synthetic(model_extra={"options": {"provider_options": {"beam_width": 4}}}),
        )


def test_out_of_range_option_rejected() -> None:
    with pytest.raises(ValidationError, match="above maximum"):
        Catalog.model_validate(_synthetic(model_extra={"options": {"temperature": 3}}))


def test_reasoning_knob_must_not_be_declared() -> None:
    with pytest.raises(ValidationError, match="derived per model"):
        Catalog.model_validate(
            _synthetic(
                provider_extra={
                    "params_base": {
                        "reasoning_effort": {"type": "enum", "enum": ["low", "high"]},
                    },
                },
            ),
        )


def test_enum_spec_requires_values() -> None:
    with pytest.raises(ValidationError, match="non-empty enum"):
        Catalog.model_validate(
            _synthetic(provider_extra={"params_base": {"style": {"type": "enum"}}}),
        )


def _dropped_count(param: str, provider: str = "anthropic") -> float:
    return AGENT_MODEL_PARAM_DROPPED_TOTAL.labels(
        provider=provider, param=param,
    )._value.get()


def test_resolve_strip_counts_dropped_knob() -> None:
    before = _dropped_count("temperature")
    kept = resolve_request_params(
        {"temperature": 0.4, "reasoning_effort": "max"},
        None,
        "anthropic",
        "claude-fable-5",
    )
    assert kept == {"reasoning_effort": "max"}
    assert _dropped_count("temperature") == before + 1


def test_resolve_strip_counts_dropped_provider_option() -> None:
    before = _dropped_count("top_k", provider="openai")
    kept = resolve_request_params(
        {"provider_options": {"top_k": 40}, "temperature": 0.4},
        None,
        "openai",
        "gpt-4o",
    )
    assert kept == {"temperature": 0.4}
    assert _dropped_count("top_k", provider="openai") == before + 1
