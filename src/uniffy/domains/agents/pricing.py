"""Cost computation from the model catalog.

Pricing is defined per model in the catalog (USD per one million tokens).
Callers that get ``None`` from ``get_pricing`` leave ``AgentRunLog.cost``
null - we never guess at an unknown or dynamic price. Cost is computed at
write time and frozen on the run-log row, so editing a catalog price only
affects future runs.
"""

from decimal import Decimal

from loguru import logger

from uniffy.domains.agents.providers.catalog import get_model
from uniffy.domains.agents.providers.catalog.images import ImageQuality
from uniffy.domains.agents.providers.catalog.loader import (
    cache_read_rate,
    cache_write_rate,
)
from uniffy.domains.agents.providers.catalog.schema import Model

logger = logger.bind(component="agents.pricing")

_ONE_MILLION = Decimal("1000000")

# All catalog rates are USD; currency conversion to the org's display
# currency happens downstream in ``currency.py``.
PRICING_CURRENCY = "USD"


def get_pricing(*, provider: str, model: str) -> Model | None:
    """Return static catalog pricing, or ``None`` for unknown/dynamic models."""
    pricing = get_model(provider, model)
    if pricing is None or pricing.dynamic_pricing:
        return None
    return pricing


def compute_text_cost(
    pricing: Model,
    *,
    input_tokens: int,
    output_tokens: int,
    cache_creation_input_tokens: int = 0,
    cache_read_input_tokens: int = 0,
    thinking_tokens: int = 0,
) -> Decimal:
    """Compute a text-model cost in USD from token counts.

    ``input_tokens`` excludes cache reads and cache creation. Cache creation
    uses the published write rate, while reads fall back to the base input rate
    when no discounted rate exists. Thinking tokens use the output rate.
    """
    cost = Decimal(0)

    if pricing.cost_per_1m_in > 0 and input_tokens > 0:
        cost += (Decimal(input_tokens) * pricing.cost_per_1m_in) / _ONE_MILLION

    billable_output = output_tokens + max(thinking_tokens, 0)
    if pricing.cost_per_1m_out > 0 and billable_output > 0:
        cost += (Decimal(billable_output) * pricing.cost_per_1m_out) / _ONE_MILLION

    if cache_read_input_tokens > 0:
        rate = cache_read_rate(pricing) or pricing.cost_per_1m_in
        if rate > 0:
            cost += (Decimal(cache_read_input_tokens) * rate) / _ONE_MILLION

    if cache_creation_input_tokens > 0:
        rate = cache_write_rate(pricing) or pricing.cost_per_1m_in
        if rate > 0:
            cost += (Decimal(cache_creation_input_tokens) * rate) / _ONE_MILLION

    return cost.quantize(Decimal("0.000001"))


def compute_image_cost(
    pricing: Model,
    *,
    size: str,
    quality: str,
    count: int = 1,
) -> Decimal | None:
    """Compute image-generation cost, or ``None`` when no rate is configured.

    Prefers the per-size/quality matrix (OpenAI); falls back to a flat
    per-image rate (Gemini) when the matrix has no matching entry.
    """
    if count <= 0:
        return None

    unit = _image_unit_price(pricing, size=size, quality=quality)
    if unit is not None:
        return (unit * Decimal(count)).quantize(Decimal("0.000001"))

    if pricing.cost_per_image is not None:
        return (pricing.cost_per_image * Decimal(count)).quantize(Decimal("0.000001"))

    return None


def image_price_estimates(provider: str, model_id: str) -> dict[str, str]:
    """Per-image USD estimates keyed ``"{aspect_ratio}|{resolution}|{quality}"``.

    Precomputed server-side so the chat and builder forms can price the current
    selection without reimplementing the size math a provider needs. Absent keys
    mean "no published rate"; the UI shows no figure rather than a guess.
    """
    from uniffy.domains.agents.providers.catalog.loader import (
        get_image_parameter_schema,
    )
    from uniffy.domains.agents.providers.openai.images import compute_size

    pricing = get_model(provider, model_id)
    schema = get_image_parameter_schema(provider, model_id)
    if pricing is None or not schema:
        return {}

    ratios = schema.get("aspect_ratio", {}).get("enum") or [""]
    resolutions = schema.get("resolution", {}).get("enum") or [""]
    qualities = schema.get("quality", {}).get("enum") or [ImageQuality.AUTO]

    estimates: dict[str, str] = {}
    for ratio in ratios:
        for resolution in resolutions:
            size = (
                compute_size(ratio, resolution)
                if pricing.image_arbitrary_size
                else _fixed_size(pricing, ratio)
            )
            for quality in qualities:
                cost = compute_image_cost(pricing, size=size, quality=quality, count=1)
                if cost is not None:
                    estimates[f"{ratio}|{resolution}|{quality}"] = str(cost)
    return estimates


def _fixed_size(pricing: Model, aspect_ratio: str) -> str:
    """The priced size whose shape matches ``aspect_ratio`` on a fixed-size model."""
    wanted = {"1:1": "1024x1024", "3:2": "1536x1024", "2:3": "1024x1536"}
    return wanted.get(aspect_ratio, "1024x1024")


def _pixels(size: str) -> int | None:
    """Pixel count for a ``WIDTHxHEIGHT`` size string, or ``None``."""
    width, _, height = size.partition("x")
    try:
        return int(width) * int(height)
    except ValueError:
        return None


def _image_unit_price(pricing: Model, *, size: str, quality: str) -> Decimal | None:
    """Per-image rate from the size/quality matrix, scaled by pixels when the
    model is token-metered and the exact size has no published rate.

    ``auto`` bills as ``medium`` on the gpt-image family; the catalog matrix
    keys on the real quality names.
    """
    if not pricing.image_prices:
        return None

    tiers = pricing.image_prices.get(size)
    if isinstance(tiers, dict):
        raw_price = tiers.get(quality) or (
            tiers.get(ImageQuality.MEDIUM) if quality == ImageQuality.AUTO else None
        )
        if raw_price is not None:
            return Decimal(str(raw_price))

    if not pricing.image_price_scales_with_pixels:
        return None

    target_pixels = _pixels(size)
    if not target_pixels:
        return None

    # Output tokens scale with pixel count, so the published rate for another
    # size of the same quality tier scales across. Nearest priced size wins so
    # the estimate stays anchored to a real number.
    best: tuple[int, Decimal] | None = None
    for priced_size, tiers in pricing.image_prices.items():
        if not isinstance(tiers, dict):
            continue
        raw_price = tiers.get(quality) or (
            tiers.get(ImageQuality.MEDIUM) if quality == ImageQuality.AUTO else None
        )
        priced_pixels = _pixels(priced_size)
        if raw_price is None or not priced_pixels:
            continue
        distance = abs(priced_pixels - target_pixels)
        if best is None or distance < best[0]:
            scaled = Decimal(str(raw_price)) * Decimal(target_pixels) / Decimal(priced_pixels)
            best = (distance, scaled)
    return best[1] if best else None
