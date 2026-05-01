"""Proto <-> domain converters for the pricing sub-service."""

from decimal import Decimal

from uniffy_proto.agents.v1.pricing_pb2 import ImagePrice, ModelPricing

from uniffy.core.converters import datetime_to_timestamp
from uniffy.core.models.agents.model_pricing import AgentModelPricing


def _decimal_to_str(value: Decimal | None) -> str | None:
    """Convert a Decimal to the wire string, preserving precision."""
    if value is None:
        return None
    # ``str(Decimal(...))`` already gives the plain canonical form
    # (no scientific notation for the ranges we deal with).
    return str(value)


def _image_prices_to_proto(
    image_prices: dict[str, dict[str, str]] | None,
) -> list[ImagePrice]:
    """Flatten a nested JSON prices dict into a list of ImagePrice."""
    out: list[ImagePrice] = []
    if not image_prices:
        return out
    for size, qualities in image_prices.items():
        if not isinstance(qualities, dict):
            continue
        for quality, price in qualities.items():
            out.append(
                ImagePrice(size=size, quality=quality, price_usd=str(price))
            )
    return out


def model_pricing_to_proto(row: AgentModelPricing) -> ModelPricing:
    """Convert an ``AgentModelPricing`` row to the proto message."""
    msg = ModelPricing(
        id=str(row.id),
        provider=row.provider,
        model=row.model,
        kind=row.kind,
        image_prices=_image_prices_to_proto(row.image_prices),
    )

    if row.input_per_1m_usd is not None:
        msg.input_per_1m_usd = _decimal_to_str(row.input_per_1m_usd) or ""
    if row.output_per_1m_usd is not None:
        msg.output_per_1m_usd = _decimal_to_str(row.output_per_1m_usd) or ""
    if row.cached_input_per_1m_usd is not None:
        msg.cached_input_per_1m_usd = _decimal_to_str(row.cached_input_per_1m_usd) or ""
    if row.thinking_per_1m_usd is not None:
        msg.thinking_per_1m_usd = _decimal_to_str(row.thinking_per_1m_usd) or ""

    msg.effective_from.CopyFrom(datetime_to_timestamp(row.effective_from))
    if row.effective_to is not None:
        msg.effective_to.CopyFrom(datetime_to_timestamp(row.effective_to))
    msg.created_at.CopyFrom(datetime_to_timestamp(row.created_at))
    msg.updated_at.CopyFrom(datetime_to_timestamp(row.updated_at))
    return msg
