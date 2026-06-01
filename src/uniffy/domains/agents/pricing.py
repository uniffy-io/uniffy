"""Cost computation from the model catalog.

Pricing is defined per model in the catalog (USD per one million tokens).
Callers that get ``None`` from ``get_pricing`` leave ``AgentRunLog.cost``
null and log a warning - we never guess at a price. Cost is computed at
write time and frozen on the run-log row, so editing a catalog price only
affects future runs.
"""

from decimal import Decimal

from loguru import logger

from uniffy.domains.agents.providers.catalog import get_model
from uniffy.domains.agents.providers.catalog.loader import cache_read_rate
from uniffy.domains.agents.providers.catalog.schema import Model

logger = logger.bind(component="agents.pricing")

_ONE_MILLION = Decimal("1000000")

# All catalog rates are USD; currency conversion to the org's display
# currency happens downstream in ``currency.py``.
PRICING_CURRENCY = "USD"


def get_pricing(*, provider: str, model: str) -> Model | None:
    """Return the catalog model carrying pricing for ``(provider, model)``."""
    return get_model(provider, model)


def compute_text_cost(
    pricing: Model,
    *,
    input_tokens: int,
    output_tokens: int,
    cache_read_input_tokens: int = 0,
    thinking_tokens: int = 0,
) -> Decimal:
    """Compute a text-model cost in USD from token counts.

    ``input_tokens`` should exclude cached reads; cached reads are priced at
    the model's cache-read rate (falling back to the input rate). Thinking
    tokens are billed at the output rate - the catalog carries no separate
    thinking price.
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

    if pricing.image_prices:
        sizes = pricing.image_prices.get(size)
        if isinstance(sizes, dict):
            raw_price = sizes.get(quality)
            if raw_price is not None:
                return (Decimal(str(raw_price)) * Decimal(count)).quantize(
                    Decimal("0.000001")
                )

    if pricing.cost_per_image is not None:
        return (pricing.cost_per_image * Decimal(count)).quantize(Decimal("0.000001"))

    return None
