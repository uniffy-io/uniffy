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

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


def _to_decimal(value: object) -> Decimal | None:
    """Coerce a JSON number/string to an exact Decimal (no binary noise)."""
    if value is None:
        return None
    return Decimal(str(value))


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
    models: list[Model]

    @model_validator(mode="after")
    def _check(self) -> ProviderCatalog:
        ids: set[str] = set()
        for model in self.models:
            if model.id in ids:
                raise ValueError(f"duplicate model id {model.id!r}")
            ids.add(model.id)
            for alias in model.aliases:
                if alias in ids:
                    raise ValueError(f"alias {alias!r} collides with a model id")
        for label, default in (
            ("default_large_model_id", self.default_large_model_id),
            ("default_small_model_id", self.default_small_model_id),
        ):
            if default is not None and default not in ids:
                raise ValueError(f"{label} {default!r} is not a known model id")
        return self


class Catalog(BaseModel):
    """Root document: one ``ProviderCatalog`` per provider id."""

    model_config = ConfigDict(extra="ignore")

    schema_version: int = Field(ge=1)
    providers: dict[str, ProviderCatalog]
