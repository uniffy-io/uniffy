"""Load, validate, and resolve against the central model catalog.

The catalog is read once from ``catalog.json`` and cached. Parsing or
validation failure raises immediately - a malformed catalog must crash
startup, never degrade silently. ``load_catalog()`` is called in the app
and worker lifespans to surface a bad edit at boot.
"""

import re
from decimal import Decimal
from pathlib import Path

from loguru import logger

from uniffy.domains.agents.providers.base import ModelInfo
from uniffy.domains.agents.providers.catalog.schema import Catalog, Model

logger = logger.bind(component="agents.providers.catalog")

_CATALOG_PATH = Path(__file__).parent / "catalog.json"

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

    Resolution order: exact id, declared alias, date-suffix-stripped id,
    then longest-prefix match (so ``claude-opus-4-6-20990101`` resolves to
    ``claude-opus-4-6``). Returns ``None`` when nothing matches.
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

    best: Model | None = None
    for model in pc.models:
        if model_id.startswith(model.id) and (best is None or len(model.id) > len(best.id)):
            best = model
    return best


def resolve_pricing(provider: str, model_id: str) -> Model | None:
    """Return the catalog model carrying pricing, or ``None`` if unknown."""
    return get_model(provider, model_id)


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
    cached = [
        r
        for r in (model.cost_per_1m_out_cached, model.cost_per_1m_in_cached)
        if r > 0
    ]
    return min(cached) if cached else None


def to_model_info(provider: str, model: Model) -> ModelInfo:
    """Project a catalog ``Model`` onto the ``ModelInfo`` DTO consumers use."""
    read_rate = cache_read_rate(model)
    write_rate = (
        model.cost_per_1m_in_cached
        if read_rate is not None and model.cost_per_1m_in_cached > read_rate
        else None
    )
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
        input_per_1m=model.cost_per_1m_in,
        output_per_1m=model.cost_per_1m_out,
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
