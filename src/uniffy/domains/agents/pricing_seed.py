"""One-time seed for ``agents_model_pricing``.

Values are intentionally ballpark rather than authoritative. Once the
table is seeded, a system admin is expected to keep it current via
``agents.v1.PricingService.UpsertModelPricing``. If a provider changes
prices, land a new row with a later ``effective_from`` and set the old
row's ``effective_to`` to the same timestamp so historical run logs
stay consistent.

All rates are in USD. Text rates are per 1 million tokens. Image
``image_prices`` is a nested dict keyed first by ``size`` (matching the
``generate_image`` tool's enum) and then by ``quality``; the value is
the per-image price.
"""

from decimal import Decimal
from typing import TypedDict


class TextPricing(TypedDict, total=False):
    provider: str
    model: str
    input_per_1m: Decimal
    output_per_1m: Decimal
    cached_input_per_1m: Decimal
    thinking_per_1m: Decimal


class ImagePricing(TypedDict):
    provider: str
    model: str
    image_prices: dict[str, dict[str, Decimal]]


TEXT_PRICING_SEED: list[TextPricing] = [
    {
        "provider": "anthropic",
        "model": "claude-opus-4-6",
        "input_per_1m": Decimal("15.00"),
        "output_per_1m": Decimal("75.00"),
        "cached_input_per_1m": Decimal("1.50"),
    },
    {
        "provider": "anthropic",
        "model": "claude-sonnet-4-6",
        "input_per_1m": Decimal("3.00"),
        "output_per_1m": Decimal("15.00"),
        "cached_input_per_1m": Decimal("0.30"),
    },
    {
        "provider": "anthropic",
        "model": "claude-3-5-sonnet-20241022",
        "input_per_1m": Decimal("3.00"),
        "output_per_1m": Decimal("15.00"),
        "cached_input_per_1m": Decimal("0.30"),
    },
    {
        "provider": "openai",
        "model": "gpt-4o",
        "input_per_1m": Decimal("2.50"),
        "output_per_1m": Decimal("10.00"),
        "cached_input_per_1m": Decimal("1.25"),
    },
    {
        "provider": "openai",
        "model": "gpt-4-turbo",
        "input_per_1m": Decimal("10.00"),
        "output_per_1m": Decimal("30.00"),
    },
    {
        "provider": "openai",
        "model": "o1",
        "input_per_1m": Decimal("15.00"),
        "output_per_1m": Decimal("60.00"),
    },
    {
        "provider": "openai",
        "model": "o1-mini",
        "input_per_1m": Decimal("3.00"),
        "output_per_1m": Decimal("12.00"),
    },
    {
        "provider": "google",
        "model": "gemini-2.0-flash",
        "input_per_1m": Decimal("0.10"),
        "output_per_1m": Decimal("0.40"),
    },
    {
        "provider": "google",
        "model": "gemini-1.5-pro",
        "input_per_1m": Decimal("1.25"),
        "output_per_1m": Decimal("5.00"),
    },
]

IMAGE_PRICING_SEED: list[ImagePricing] = [
    {
        "provider": "openai",
        "model": "gpt-image-1",
        "image_prices": {
            "1024x1024": {
                "auto": Decimal("0.04"),
                "low": Decimal("0.01"),
                "high": Decimal("0.17"),
            },
            "1536x1024": {
                "auto": Decimal("0.06"),
                "low": Decimal("0.02"),
                "high": Decimal("0.25"),
            },
            "1024x1536": {
                "auto": Decimal("0.06"),
                "low": Decimal("0.02"),
                "high": Decimal("0.25"),
            },
        },
    },
    {
        "provider": "openai",
        "model": "dall-e-3",
        "image_prices": {
            "1024x1024": {
                "auto": Decimal("0.04"),
                "low": Decimal("0.04"),
                "high": Decimal("0.08"),
            },
            "1536x1024": {
                "auto": Decimal("0.08"),
                "low": Decimal("0.08"),
                "high": Decimal("0.12"),
            },
            "1024x1536": {
                "auto": Decimal("0.08"),
                "low": Decimal("0.08"),
                "high": Decimal("0.12"),
            },
        },
    },
]
