from __future__ import annotations

import pytest

from uniffy.domains.agents.providers.catalog.images import (
    resolve_image_params,
    validate_image_params,
)


def test_builder_rejects_transparent_jpeg() -> None:
    with pytest.raises(ValueError, match="PNG or WebP"):
        validate_image_params(
            "openai",
            "gpt-image-1",
            {"background": "transparent", "output_format": "jpeg"},
        )


def test_runtime_normalizes_layered_transparent_jpeg() -> None:
    resolved = resolve_image_params(
        {"output_format": "jpeg"},
        None,
        {"background": "transparent"},
        "openai",
        "gpt-image-1",
    )

    assert resolved["background"] == "transparent"
    assert resolved["output_format"] == "png"


@pytest.mark.parametrize("model", ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"])
@pytest.mark.parametrize("quality", ["xhigh", "max", "auto", "invalid", None])
def test_image_quality_cannot_exceed_organization_ceiling(model: str, quality: str | None) -> None:
    resolved = resolve_image_params(
        None,
        None,
        {"quality": quality} if quality else None,
        "openai",
        model,
        max_quality="high",
    )

    assert resolved["quality"] == "high"


@pytest.mark.parametrize("model", ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"])
def test_image_quality_below_ceiling_is_preserved(model: str) -> None:
    resolved = resolve_image_params(
        {"quality": "max"},
        None,
        {"quality": "xhigh"},
        "openai",
        model,
        max_quality="max",
    )

    assert resolved["quality"] == "xhigh"


@pytest.mark.parametrize("model", ["gpt-image-1", "gpt-image-2", "chatgpt-image-latest"])
def test_image_model_rejects_unsupported_quality(model: str) -> None:
    with pytest.raises(ValueError, match="not supported"):
        validate_image_params("openai", model, {"quality": "max"})


def test_flash_lite_image_rejects_higher_resolution() -> None:
    with pytest.raises(ValueError, match="not supported"):
        validate_image_params("google", "gemini-3.1-flash-lite-image", {"resolution": "2K"})
