"""Model catalog for Google Gemini models.

Provides static model metadata including context window sizes and
capability flags.  Used as the fallback catalog when the Google AI
API is unreachable and to enrich live model lists with capability
data.
"""

from dataclasses import dataclass

from uniffy.domains.agents.providers.base import ModelInfo


@dataclass(frozen=True)
class ModelCapabilities:
    """Capability metadata for Google Gemini models.

    Attributes
    ----------
    context_window : int
        Maximum context window size in tokens.
    supports_tools : bool
        Whether the model supports function calling.
    supports_vision : bool
        Whether the model supports image inputs.
    supports_thinking : bool
        Whether the model supports extended thinking.

    """

    context_window: int
    supports_tools: bool
    supports_vision: bool
    supports_thinking: bool


# Keyed by model-ID prefix.  Longer prefixes are checked first.
MODEL_CAPABILITIES: list[tuple[str, ModelCapabilities]] = [
    (
        "gemini-2.5-pro",
        ModelCapabilities(
            context_window=1_048_576,
            supports_tools=True,
            supports_vision=True,
            supports_thinking=True,
        ),
    ),
    (
        "gemini-2.5-flash",
        ModelCapabilities(
            context_window=1_048_576,
            supports_tools=True,
            supports_vision=True,
            supports_thinking=True,
        ),
    ),
    (
        "gemini-2.0-flash",
        ModelCapabilities(
            context_window=1_048_576,
            supports_tools=True,
            supports_vision=True,
            supports_thinking=False,
        ),
    ),
    (
        "gemini-1.5-pro",
        ModelCapabilities(
            context_window=2_097_152,
            supports_tools=True,
            supports_vision=True,
            supports_thinking=False,
        ),
    ),
    (
        "gemini-1.5-flash",
        ModelCapabilities(
            context_window=1_048_576,
            supports_tools=True,
            supports_vision=True,
            supports_thinking=False,
        ),
    ),
]

# Conservative defaults for unknown Gemini models.
_DEFAULT_CAPABILITIES = ModelCapabilities(
    context_window=1_048_576,
    supports_tools=True,
    supports_vision=True,
    supports_thinking=False,
)


def get_capabilities(model_id: str) -> ModelCapabilities:
    """Look up capability metadata for a model ID.

    Matches by prefix so that versioned IDs resolve against the
    base entry.

    Parameters
    ----------
    model_id : str
        The model identifier.

    Returns
    -------
    ModelCapabilities
        Known capabilities, or conservative defaults for unknown models.

    """
    # Strip "models/" prefix that Google API sometimes returns
    clean_id = model_id.removeprefix("models/")
    for prefix, caps in MODEL_CAPABILITIES:
        if clean_id.startswith(prefix):
            return caps
    return _DEFAULT_CAPABILITIES


# Static fallback catalog used when the API is unreachable.
FALLBACK_MODELS: list[ModelInfo] = [
    ModelInfo(
        id="gemini-2.0-flash",
        display_name="Gemini 2.0 Flash",
        provider="google",
        context_window=1_048_576,
        supports_tools=True,
        supports_vision=True,
        supports_thinking=False,
    ),
    ModelInfo(
        id="gemini-2.5-pro",
        display_name="Gemini 2.5 Pro",
        provider="google",
        context_window=1_048_576,
        supports_tools=True,
        supports_vision=True,
        supports_thinking=True,
    ),
    ModelInfo(
        id="gemini-2.5-flash",
        display_name="Gemini 2.5 Flash",
        provider="google",
        context_window=1_048_576,
        supports_tools=True,
        supports_vision=True,
        supports_thinking=True,
    ),
]
