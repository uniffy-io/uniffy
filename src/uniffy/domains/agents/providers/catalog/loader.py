"""Load, validate, and resolve against the central model catalog.

The catalog is read once from ``catalog.json`` and cached. Parsing or
validation failure raises immediately - a malformed catalog must crash
startup, never degrade silently. ``load_catalog()`` is called in the app
and worker lifespans to surface a bad edit at boot.
"""

import re
from decimal import Decimal

from loguru import logger

from uniffy.core.data_files import DATA_DIR
from uniffy.domains.agents.providers.base import ModelInfo
from uniffy.domains.agents.providers.catalog.schema import (
    REASONING_KNOB,
    Catalog,
    Model,
    ParamSpec,
    ProviderCatalog,
)

logger = logger.bind(component="agents.providers.catalog")

_CATALOG_PATH = DATA_DIR / "models" / "catalog.json"

# Provider model ids often carry a trailing date snapshot
# (``gpt-4o-2024-08-06``, ``claude-3-5-sonnet-20241022``). When no exact or
# alias match exists, the date suffix is stripped before a prefix match.
_DATE_SUFFIX_RE = re.compile(r"-(\d{8}|\d{4}-\d{2}-\d{2})$")


_cache: tuple[float, Catalog] | None = None


def get_catalog() -> Catalog:
    """Return the parsed, validated catalog, re-reading when the file changes.

    Cached by ``catalog.json`` mtime so an edit (dev) or a redeploy with a new
    catalog (a long-running process) is picked up on the next call - without a
    restart. The stat is sub-millisecond; parsing only happens on change.
    """
    global _cache
    mtime = _CATALOG_PATH.stat().st_mtime
    if _cache is None or _cache[0] != mtime:
        _cache = (mtime, load_catalog())
    return _cache[1]


def load_catalog() -> Catalog:
    """Read and validate ``catalog.json``; raises on any violation."""
    raw = _CATALOG_PATH.read_text(encoding="utf-8")
    catalog = Catalog.model_validate_json(raw)
    logger.debug(
        "Loaded model catalog",
        providers=len(catalog.providers),
        models=sum(len(p.models) for p in catalog.providers.values()),
    )
    return catalog


def list_provider_ids() -> list[str]:
    """Return every provider id declared in the catalog."""
    return list(get_catalog().providers.keys())


def models_for_provider(provider: str) -> list[Model]:
    """Return the catalog ``Model`` entries for a provider (empty if unknown)."""
    pc = get_catalog().providers.get(provider)
    return list(pc.models) if pc else []


def get_model(provider: str, model_id: str) -> Model | None:
    """Resolve a model id to its catalog entry.

    Resolution order: exact id, declared alias, then date-suffix-stripped id.
    Returns ``None`` when nothing matches.
    """
    pc = get_catalog().providers.get(provider)
    if pc is None:
        return None

    for model in pc.models:
        if model.id == model_id or model_id in model.aliases:
            return model

    alias = _DATE_SUFFIX_RE.sub("", model_id)
    if alias != model_id:
        for model in pc.models:
            if model.id == alias or alias in model.aliases:
                return model
    return None


def resolve_pricing(provider: str, model_id: str) -> Model | None:
    """Return the catalog model carrying pricing, or ``None`` if unknown."""
    return get_model(provider, model_id)


def _spec_entry(spec: ParamSpec, override_default: object = None) -> dict:
    entry = spec.model_dump(exclude_none=True, exclude_defaults=True)
    entry["type"] = spec.type
    if override_default is not None:
        spec.check_value("option override", override_default)
        entry["default"] = override_default
    if spec.type == "integer":  # noqa: PLR2004
        for bound in ("minimum", "maximum", "step"):
            if bound in entry:
                entry[bound] = int(entry[bound])
    return entry


def get_parameter_schema(provider: str, model_id: str) -> dict | None:
    """Bounded per-model parameter schema, or ``None`` for unknown ids.

    Merges the provider ``params_base`` with the model's ``options``
    defaults, clamps ``max_tokens`` to the model's output ceiling, and
    derives the reasoning knob: models with ``reasoning_levels`` get an
    effort enum, budget-style reasoners (``can_reason`` without levels)
    get on/off, everything else gets no knob. "off" always means "do not
    request reasoning explicitly".
    """
    pc = get_catalog().providers.get(provider)
    model = get_model(provider, model_id)
    if pc is None or model is None:
        return None
    return merge_parameter_schema(pc, model)


def merge_parameter_schema(pc: ProviderCatalog, model: Model) -> dict:
    """The pure merge behind ``get_parameter_schema``."""
    schema: dict[str, dict] = {}
    for knob, spec in pc.params_base.items():
        if knob in model.unsupported_params:
            continue
        entry = _spec_entry(spec, model.options.get(knob))
        if knob == "max_tokens":  # noqa: PLR2004
            ceiling = model.default_max_tokens or model.context_window
            entry["maximum"] = ceiling
            if isinstance(entry.get("default"), int) and entry["default"] > ceiling:
                entry["default"] = ceiling
        schema[knob] = entry

    if model.can_reason:
        levels = ["off", *model.reasoning_levels] if model.reasoning_levels else ["off", "on"]
        schema[REASONING_KNOB] = {"type": "enum", "enum": levels, "default": "off"}

    model_opts = model.options.get("provider_options")
    declared = {
        key: _spec_entry(
            spec,
            model_opts.get(key) if isinstance(model_opts, dict) else None,
        )
        for key, spec in pc.provider_options.items()
        if key not in model.unsupported_provider_options
    }
    if declared:
        schema["provider_options"] = declared
    return schema


def get_image_parameter_schema(provider: str, model_id: str) -> dict | None:
    """Bounded per-model image-generation schema, or ``None`` when the model
    generates no images.

    Same merge shape as ``get_parameter_schema`` so the frontend form renders
    both from one parser: provider ``image_params_base``, minus the knobs the
    model rejects, with per-model enum narrowing and default overrides applied.
    """
    pc = get_catalog().providers.get(provider)
    model = get_model(provider, model_id)
    if pc is None or model is None or not model.supports_image_generation:
        return None
    return merge_image_parameter_schema(pc, model)


def merge_image_parameter_schema(pc: ProviderCatalog, model: Model) -> dict:
    """The pure merge behind ``get_image_parameter_schema``."""
    schema: dict[str, dict] = {}
    for knob, spec in pc.image_params_base.items():
        if knob in model.unsupported_image_params:
            continue
        entry = _spec_entry(spec, model.image_options.get(knob))
        members = model.image_enums.get(knob)
        if members:
            entry["enum"] = list(members)
        schema[knob] = entry
    return schema


def image_knob_audiences(provider: str) -> dict[str, str]:
    """Knob -> ``"user"`` / ``"builder"`` for a provider's image knobs."""
    pc = get_catalog().providers.get(provider)
    if pc is None:
        return {}
    return {knob: spec.audience for knob, spec in pc.image_params_base.items()}


def provider_for_model(model_id: str) -> str | None:
    """Return the catalog provider id that owns ``model_id``, or ``None``.

    Used to route a model to a provider without a live API call - the catalog
    is the source of truth for which provider serves which model.
    """
    for provider in get_catalog().providers:
        if get_model(provider, model_id) is not None:
            return provider
    return None


def cache_read_rate(model: Model) -> Decimal | None:
    """Cache-read price per 1M tokens, or ``None`` if the model has none.

    catwalk is inconsistent about which field holds the cache-read rate
    (``cost_per_1m_out_cached`` for Anthropic/GPT-4o, ``cost_per_1m_in_cached``
    for GPT-5.x). A cache read is always cheaper than the other cached
    operation (write), so the read rate is the cheaper of the two non-zero
    cached rates.
    """
    cached = [r for r in (model.cost_per_1m_out_cached, model.cost_per_1m_in_cached) if r > 0]
    return min(cached) if cached else None


def cache_write_rate(model: Model) -> Decimal | None:
    """Cache-creation price per 1M tokens, or ``None`` when unpublished."""
    read_rate = cache_read_rate(model)
    if read_rate is None or model.cost_per_1m_in_cached <= read_rate:
        return None
    return model.cost_per_1m_in_cached


def to_model_info(provider: str, model: Model) -> ModelInfo:
    """Project a catalog ``Model`` onto the ``ModelInfo`` DTO consumers use."""
    read_rate = cache_read_rate(model)
    write_rate = cache_write_rate(model)
    input_rate = None if model.dynamic_pricing else model.cost_per_1m_in
    output_rate = None if model.dynamic_pricing else model.cost_per_1m_out
    return ModelInfo(
        id=model.id,
        display_name=model.name,
        provider=provider,
        context_window=model.context_window,
        supports_tools=model.supports_tools,
        supports_vision=model.supports_attachments,
        supports_thinking=model.can_reason,
        supports_prompt_cache=read_rate is not None,
        supports_image_generation=model.supports_image_generation,
        default_max_tokens=model.default_max_tokens,
        aliases=tuple(model.aliases),
        deprecated=model.deprecated,
        catalog_known=True,
        reasoning_levels=tuple(model.reasoning_levels),
        default_reasoning_effort=model.default_reasoning_effort,
        input_per_1m=input_rate,
        output_per_1m=output_rate,
        cache_read_per_1m=read_rate,
        cache_write_per_1m=write_rate,
    )


def model_infos_for_provider(provider: str) -> list[ModelInfo]:
    """Return ``ModelInfo`` for every catalog model of a provider."""
    return [to_model_info(provider, m) for m in models_for_provider(provider)]


def model_info_for(provider: str, model_id: str) -> ModelInfo | None:
    """Resolve a model id to a ``ModelInfo``, or ``None`` if unknown."""
    model = get_model(provider, model_id)
    return to_model_info(provider, model) if model else None


def model_info_or_default(
    provider: str,
    model_id: str,
    *,
    display_name: str | None = None,
    default_context_window: int = 128000,
) -> ModelInfo:
    """Catalog ``ModelInfo`` for ``model_id``, or a conservative default.

    Used to enrich a live provider model list: models the catalog knows get
    full metadata; an id the provider returns that the catalog has not seen
    yet still appears, with tools/vision assumed and no pricing.
    """
    info = model_info_for(provider, model_id)
    if info is not None:
        return info
    return ModelInfo(
        id=model_id,
        display_name=display_name or model_id,
        provider=provider,
        context_window=default_context_window,
        supports_tools=True,
        supports_vision=True,
    )
