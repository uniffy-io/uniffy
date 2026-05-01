"""Pricing lookup and cost computation helpers.

The public surface is intentionally small so every code path that
writes an ``AgentRunLog`` agrees on how cost is calculated. Callers
are expected to handle ``None`` returns from ``get_pricing`` by
leaving ``AgentRunLog.cost_usd`` null and logging a warning - we
never guess at a price.
"""

from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation

from loguru import logger
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.agents.model_pricing import AgentModelPricing

_ONE_MILLION = Decimal("1000000")


async def get_pricing(
    session: AsyncSession,
    *,
    provider: str,
    model: str,
    at_time: datetime | None = None,
) -> AgentModelPricing | None:
    """Return the pricing row active for ``(provider, model)`` at ``at_time``.

    Prefers the row with the latest ``effective_from`` that is still in
    the past relative to ``at_time`` and whose ``effective_to`` is
    either null or in the future. If no row matches, returns ``None``.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    provider : str
        Provider key (``anthropic`` / ``openai`` / ``google`` / ``other``).
    model : str
        Provider-specific model id.
    at_time : datetime | None
        Point in time the pricing should be valid for. Defaults to "now".

    """
    when = at_time or datetime.now(UTC)
    result = await session.execute(
        select(AgentModelPricing)
        .where(
            AgentModelPricing.provider == provider,
            AgentModelPricing.model == model,
            AgentModelPricing.effective_from <= when,
            or_(
                AgentModelPricing.effective_to.is_(None),
                AgentModelPricing.effective_to > when,
            ),
        )
        .order_by(AgentModelPricing.effective_from.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


def compute_text_cost(
    pricing: AgentModelPricing,
    *,
    input_tokens: int,
    output_tokens: int,
    cache_read_input_tokens: int = 0,
    thinking_tokens: int = 0,
) -> Decimal:
    """Compute a text-model cost from token counts and the pricing row.

    Cached input tokens are priced using ``cached_input_per_1m_usd`` when
    set, otherwise at the regular input rate. Thinking tokens are priced
    using ``thinking_per_1m_usd`` when set, otherwise at the regular
    output rate. Regular ``input_tokens`` is expected to exclude cached
    reads and ``output_tokens`` is expected to exclude thinking tokens;
    the caller is responsible for splitting the counts correctly.

    Parameters
    ----------
    pricing : AgentModelPricing
        Pricing row returned by ``get_pricing`` (must be ``kind='text'``).
    input_tokens : int
        Regular (non-cached) input tokens.
    output_tokens : int
        Regular (non-thinking) output tokens.
    cache_read_input_tokens : int
        Prompt-cache read tokens.
    thinking_tokens : int
        Extended-thinking output tokens.

    Returns
    -------
    Decimal
        Total cost in USD, rounded to 6 decimal places.

    """
    cost = Decimal(0)

    if pricing.input_per_1m_usd is not None and input_tokens > 0:
        cost += (Decimal(input_tokens) * pricing.input_per_1m_usd) / _ONE_MILLION

    if pricing.output_per_1m_usd is not None and output_tokens > 0:
        cost += (Decimal(output_tokens) * pricing.output_per_1m_usd) / _ONE_MILLION

    if cache_read_input_tokens > 0:
        cached_rate = pricing.cached_input_per_1m_usd or pricing.input_per_1m_usd
        if cached_rate is not None:
            cost += (Decimal(cache_read_input_tokens) * cached_rate) / _ONE_MILLION

    if thinking_tokens > 0:
        thinking_rate = pricing.thinking_per_1m_usd or pricing.output_per_1m_usd
        if thinking_rate is not None:
            cost += (Decimal(thinking_tokens) * thinking_rate) / _ONE_MILLION

    # Quantize to the DECIMAL(12,6) column precision so the value we
    # return matches what a round-trip through the DB would produce.
    return cost.quantize(Decimal("0.000001"))


def compute_image_cost(
    pricing: AgentModelPricing,
    *,
    size: str,
    quality: str,
    count: int = 1,
) -> Decimal | None:
    """Compute the cost of generating ``count`` images at ``(size, quality)``.

    Returns ``None`` when the pricing row has no entry for the requested
    ``(size, quality)`` pair - callers leave the run log's ``cost_usd``
    null and log the miss.

    Parameters
    ----------
    pricing : AgentModelPricing
        Pricing row returned by ``get_pricing`` (must be ``kind='image'``).
    size : str
        Image size enum value (e.g. ``1024x1024``).
    quality : str
        Image quality enum value (e.g. ``auto``).
    count : int
        Number of images produced in the run.

    Returns
    -------
    Decimal | None
        Total cost in USD, or ``None`` when no price is available.

    """
    if pricing.image_prices is None or count <= 0:
        return None

    sizes = pricing.image_prices.get(size)
    if not isinstance(sizes, dict):
        return None

    raw_price = sizes.get(quality)
    if raw_price is None:
        return None

    try:
        price = Decimal(str(raw_price))
    except (InvalidOperation, TypeError):
        logger.warning(
            "Unparseable image price in pricing row",
            model=pricing.model,
            size=size,
            quality=quality,
            raw_price=raw_price,
        )
        return None

    cost = price * Decimal(count)
    return cost.quantize(Decimal("0.000001"))
