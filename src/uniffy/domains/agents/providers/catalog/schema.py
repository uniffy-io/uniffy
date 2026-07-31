"""Pydantic schema for the model catalog.

Field names mirror the catwalk catalog (charmbracelet/catwalk) so a model
entry can be pasted across with minimal edits: ``name``, ``cost_per_1m_*``,
``can_reason``/``reasoning_levels``/``default_reasoning_effort``,
``supports_attachments``, ``context_window``, ``default_max_tokens``. A few
fields are ours (``aliases``, ``deprecated``, ``supports_tools``,
``image_prices``). Unknown keys are ignored so upstream-only fields
(``has_reasoning_efforts``, ``type``, ``api_key`` ...) don't break a paste.

Cache rates follow catwalk's convention: ``cost_per_1m_in_cached`` is the
cache-write (creation) rate, ``cost_per_1m_out_cached`` is the cache-read rate.

An invalid catalog is a hard startup error - see ``loader.load_catalog``.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# The reasoning knob is derived per model from ``can_reason`` +
# ``reasoning_levels`` by the loader; providers must not declare it.
REASONING_KNOB = "reasoning_effort"


def _to_decimal(value: object) -> Decimal | None:
    """Coerce a JSON number/string to an exact Decimal (no binary noise)."""
    if value is None:
        return None
    return Decimal(str(value))


class ParamSpec(BaseModel):
    """Bounds + default for one tunable request parameter."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["number", "integer", "boolean", "enum"]
    minimum: float | None = None
    maximum: float | None = None
    default: float | int | bool | str | None = None
    enum: list[str] | None = None
    step: float | None = None
    hidden: bool = False
    # "builder" knobs are settable only on the agent itself: they are stripped
    # from the tool schema the model sees and rejected on the per-conversation
    # override path, so neither a member nor the LLM can loosen a moderation
    # or output-format decision the builder made.
    audience: Literal["user", "builder"] = "user"

    @model_validator(mode="after")
    def _check(self) -> ParamSpec:
        if self.type == "enum" and not self.enum:
            raise ValueError("enum spec requires non-empty enum values")
        if self.type != "enum" and self.enum:
            raise ValueError(f"{self.type} spec must not carry enum values")
        if self.default is not None:
            self.check_value("default", self.default)
        return self

    def check_value(self, label: str, value: object) -> None:
        """Raise ``ValueError`` when ``value`` violates this spec."""
        match self.type:
            case "enum":
                if value not in (self.enum or []):
                    raise ValueError(f"{label} {value!r} not in enum {self.enum}")
            case "boolean":
                if not isinstance(value, bool):
                    raise ValueError(f"{label} {value!r} is not a boolean")
            case "integer":
                if isinstance(value, bool) or not isinstance(value, int):
                    raise ValueError(f"{label} {value!r} is not an integer")
            case "number":
                if isinstance(value, bool) or not isinstance(value, (int, float)):
                    raise ValueError(f"{label} {value!r} is not a number")
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            if self.minimum is not None and value < self.minimum:
                raise ValueError(f"{label} {value!r} below minimum {self.minimum}")
            if self.maximum is not None and value > self.maximum:
                raise ValueError(f"{label} {value!r} above maximum {self.maximum}")


class Model(BaseModel):
    """One model's catalog entry (catwalk-aligned)."""

    model_config = ConfigDict(extra="ignore")

    id: str
    name: str
    cost_per_1m_in: Decimal = Decimal(0)
    cost_per_1m_out: Decimal = Decimal(0)
    cost_per_1m_in_cached: Decimal = Decimal(0)
    cost_per_1m_out_cached: Decimal = Decimal(0)
    context_window: int = Field(gt=0)
    default_max_tokens: int | None = Field(default=None, gt=0)
    can_reason: bool = False
    reasoning_levels: list[str] = Field(default_factory=list)
    default_reasoning_effort: str | None = None
    supports_attachments: bool = False
    supports_tools: bool = True
    supports_image_generation: bool = False
    aliases: list[str] = Field(default_factory=list)
    deprecated: bool = False
    sunset_date: str | None = None
    # Per-size/quality image rates (OpenAI-style matrix).
    image_prices: dict[str, dict[str, Decimal]] | None = None
    # Flat per-image USD rate (Gemini-style), used when image_prices has no
    # matching size/quality.
    cost_per_image: Decimal | None = None
    # Token-metered image models (the gpt-image family) publish rates only for
    # their 1K sizes; output tokens scale with pixel count, so a larger size is
    # priced by scaling the nearest matrix entry. Every derived figure is an
    # estimate and is rendered as such.
    image_price_scales_with_pixels: bool = False
    # The model's API takes any WIDTHxHEIGHT inside its envelope rather than a
    # fixed size list, so a ratio + tier can be turned into exact pixels.
    image_arbitrary_size: bool = False
    # Per-model default overrides for the provider's image_params_base, and the
    # image knobs this model's API rejects. Same contract as options /
    # unsupported_params, applied to the image-generation endpoint.
    image_options: dict[str, object] = Field(default_factory=dict)
    unsupported_image_params: list[str] = Field(default_factory=list)
    # Narrows an image enum to the subset this model's API accepts, e.g.
    # gpt-image-1 takes three of the ten aspect ratios.
    image_enums: dict[str, list[str]] = Field(default_factory=dict)
    # Per-model default overrides for knobs declared in the provider's
    # params_base (catwalk-scalar shape); "provider_options" nests the
    # escape-hatch keys. Keys are validated against the provider decls.
    options: dict[str, object] = Field(default_factory=dict)
    # Knobs the model's API rejects outright (e.g. temperature on
    # Claude 4.7+ / OpenAI reasoning models). Removed from the schema,
    # rejected at write time, and never sent on the request.
    unsupported_params: list[str] = Field(default_factory=list)

    @field_validator(
        "cost_per_1m_in",
        "cost_per_1m_out",
        "cost_per_1m_in_cached",
        "cost_per_1m_out_cached",
        "cost_per_image",
        mode="before",
    )
    @classmethod
    def _exact_decimal(cls, value: object) -> object:
        return _to_decimal(value)

    @model_validator(mode="after")
    def _check_reasoning(self) -> Model:
        if (
            self.default_reasoning_effort
            and self.reasoning_levels
            and self.default_reasoning_effort not in self.reasoning_levels
        ):
            raise ValueError(
                f"model {self.id!r}: default_reasoning_effort "
                f"{self.default_reasoning_effort!r} not in reasoning_levels",
            )
        return self


class ProviderCatalog(BaseModel):
    """All models for one provider plus its default large/small picks."""

    model_config = ConfigDict(extra="ignore")

    display_name: str
    default_large_model_id: str | None = None
    default_small_model_id: str | None = None
    params_base: dict[str, ParamSpec] = Field(default_factory=dict)
    provider_options: dict[str, ParamSpec] = Field(default_factory=dict)
    image_params_base: dict[str, ParamSpec] = Field(default_factory=dict)
    models: list[Model]

    @model_validator(mode="after")
    def _check(self) -> ProviderCatalog:
        if REASONING_KNOB in self.params_base:
            raise ValueError(f"{REASONING_KNOB} is derived per model, not declared")
        ids: set[str] = set()
        for model in self.models:
            if model.id in ids:
                raise ValueError(f"duplicate model id {model.id!r}")
            ids.add(model.id)
            for alias in model.aliases:
                if alias in ids:
                    raise ValueError(f"alias {alias!r} collides with a model id")
            self._check_options(model)
            self._check_image_options(model)
        for label, default in (
            ("default_large_model_id", self.default_large_model_id),
            ("default_small_model_id", self.default_small_model_id),
        ):
            if default is not None and default not in ids:
                raise ValueError(f"{label} {default!r} is not a known model id")
        return self

    def _check_options(self, model: Model) -> None:
        for name in model.unsupported_params:
            if name not in self.params_base:
                raise ValueError(
                    f"model {model.id!r}: unsupported_params entry {name!r} "
                    "is not a declared knob",
                )
            if name in model.options:
                raise ValueError(f"model {model.id!r}: option {name!r} is unsupported")
        for key, value in model.options.items():
            if key == "provider_options":
                if not isinstance(value, dict):
                    raise ValueError(f"model {model.id!r}: provider_options must be an object")
                for opt_key, opt_value in value.items():
                    spec = self.provider_options.get(opt_key)
                    if spec is None:
                        raise ValueError(
                            f"model {model.id!r}: undeclared provider option {opt_key!r}",
                        )
                    spec.check_value(f"model {model.id!r} option {opt_key!r}", opt_value)
                continue
            spec = self.params_base.get(key)
            if spec is None:
                raise ValueError(f"model {model.id!r}: undeclared option {key!r}")
            spec.check_value(f"model {model.id!r} option {key!r}", value)

    def _check_image_options(self, model: Model) -> None:
        if not (model.image_options or model.unsupported_image_params or model.image_enums):
            return
        if not self.image_params_base:
            raise ValueError(
                f"model {model.id!r}: image options declared but the provider "
                "has no image_params_base",
            )
        for name in model.unsupported_image_params:
            if name not in self.image_params_base:
                raise ValueError(
                    f"model {model.id!r}: unsupported_image_params entry {name!r} "
                    "is not a declared image knob",
                )
            if name in model.image_options:
                raise ValueError(
                    f"model {model.id!r}: image option {name!r} is unsupported",
                )
        for key, value in model.image_options.items():
            spec = self.image_params_base.get(key)
            if spec is None:
                raise ValueError(f"model {model.id!r}: undeclared image option {key!r}")
            spec.check_value(f"model {model.id!r} image option {key!r}", value)
        for key, members in model.image_enums.items():
            spec = self.image_params_base.get(key)
            if spec is None:
                raise ValueError(f"model {model.id!r}: undeclared image enum {key!r}")
            if spec.type != "enum":
                raise ValueError(f"model {model.id!r}: image knob {key!r} is not an enum")
            if not members:
                raise ValueError(f"model {model.id!r}: image enum {key!r} is empty")
            for member in members:
                spec.check_value(f"model {model.id!r} image enum {key!r}", member)
            default = model.image_options.get(key, spec.default)
            if default is not None and default not in members:
                raise ValueError(
                    f"model {model.id!r}: image knob {key!r} default {default!r} "
                    "is outside its narrowed enum",
                )


class Catalog(BaseModel):
    """Root document: one ``ProviderCatalog`` per provider id."""

    model_config = ConfigDict(extra="ignore")

    schema_version: int = Field(ge=1)
    providers: dict[str, ProviderCatalog]
