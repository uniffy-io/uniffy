from __future__ import annotations

import pytest

from uniffy.domains.agents.providers.catalog.image_params import (
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
