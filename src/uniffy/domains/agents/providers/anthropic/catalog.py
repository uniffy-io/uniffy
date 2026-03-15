"""Capability overlay for Anthropic models.

The Anthropic ``models.list()`` API returns only ``id``, ``display_name``,
``created_at``, and ``type``.  It does not include capability metadata like
context window size, tool-use support, or vision support.

This module provides a static capability map keyed by model-ID prefix.
When the live model list is fetched from the API, each model is enriched
with the matching entry from this map.  Models whose ID does not match any
known prefix receive conservative defaults so that newly released models
still appear in the catalog.
"""

from dataclasses import dataclass

from uniffy.domains.agents.providers.base import ModelInfo


@dataclass(frozen=True)
class ModelCapabilities:
    """Capability metadata not available from the Anthropic API.

    Attributes
    ----------
    context_window : int
        Maximum context window size in tokens.
    supports_tools : bool
        Whether the model supports tool use.
    supports_vision : bool
        Whether the model supports image inputs.
    supports_thinking : bool
        Whether the model supports extended thinking.

    """

    context_window: int
    supports_tools: bool
    supports_vision: bool
    supports_thinking: bool


# Keyed by model-ID prefix.  Order matters: longer prefixes are checked
# first so that "claude-sonnet-4" matches before "claude-".
MODEL_CAPABILITIES: list[tuple[str, ModelCapabilities]] = [
    (
        "claude-opus-4",
        ModelCapabilities(
            context_window=200_000,
            supports_tools=True,
            supports_vision=True,
            supports_thinking=True,
        ),
    ),
    (
        "claude-sonnet-4",
        ModelCapabilities(
            context_window=200_000,
            supports_tools=True,
            supports_vision=True,
            supports_thinking=True,
        ),
    ),
    (
        "claude-haiku-4",
        ModelCapabilities(
            context_window=200_000,
            supports_tools=True,
            supports_vision=True,
            supports_thinking=False,
        ),
    ),
    (
        "claude-sonnet-3",
        ModelCapabilities(
            context_window=200_000,
            supports_tools=True,
            supports_vision=True,
            supports_thinking=False,
        ),
    ),
    (
        "claude-haiku-3",
        ModelCapabilities(
            context_window=200_000,
            supports_tools=True,
            supports_vision=True,
            supports_thinking=False,
        ),
    ),
]

# Conservative defaults for models not in the capability map.
_DEFAULT_CAPABILITIES = ModelCapabilities(
    context_window=200_000,
    supports_tools=True,
    supports_vision=True,
    supports_thinking=False,
)


def get_capabilities(model_id: str) -> ModelCapabilities:
    """Look up capability metadata for a model ID.

    Matches by prefix so that versioned IDs (e.g. ``claude-opus-4-6``)
    resolve against the base entry (``claude-opus-4``).

    Parameters
    ----------
    model_id : str
        The model identifier returned by the API.

    Returns
    -------
    ModelCapabilities
        Known capabilities, or conservative defaults for unknown models.

    """
    for prefix, caps in MODEL_CAPABILITIES:
        if model_id.startswith(prefix):
            return caps
    return _DEFAULT_CAPABILITIES


# Static fallback catalog used when the API is unreachable (e.g. setup
# tokens that cannot call models.list, or network errors).
FALLBACK_MODELS: list[ModelInfo] = [
    ModelInfo(
        id="claude-opus-4-6",
        display_name="Claude Opus 4.6",
        provider="anthropic",
        context_window=200_000,
        supports_tools=True,
        supports_vision=True,
        supports_thinking=True,
    ),
    ModelInfo(
        id="claude-sonnet-4-6",
        display_name="Claude Sonnet 4.6",
        provider="anthropic",
        context_window=200_000,
        supports_tools=True,
        supports_vision=True,
        supports_thinking=True,
    ),
]
