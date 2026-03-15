"""Model catalog for OpenAI models.

Provides static model metadata including context window sizes and
capability flags.  Used as the fallback catalog when the OpenAI API
is unreachable and to enrich live model lists with capability data
not available from the API response.

The OpenAI ``models.list`` endpoint only returns ``id``, ``created``,
``object``, and ``owned_by`` - no capability information.  We maintain
a prefix-based override map for models whose capabilities differ from
the defaults (e.g. reasoning models that support thinking).  Unknown
models get generous defaults: tools and vision enabled, thinking
disabled.
"""

from dataclasses import dataclass

from uniffy.domains.agents.providers.base import ModelInfo


@dataclass(frozen=True)
class ModelCapabilities:
    """Capability metadata for OpenAI models.

    Attributes
    ----------
    context_window : int
        Maximum context window size in tokens.
    supports_tools : bool
        Whether the model supports tool/function calling.
    supports_vision : bool
        Whether the model supports image inputs.
    supports_thinking : bool
        Whether the model supports extended reasoning.

    """

    context_window: int
    supports_tools: bool
    supports_vision: bool
    supports_thinking: bool


# Overrides for models whose capabilities differ from the defaults.
# Keyed by model-ID prefix.  Longer prefixes are checked first so
# that e.g. "o3-mini" matches before "o3".
_CAPABILITY_OVERRIDES: list[tuple[str, ModelCapabilities]] = [
    (
        "o4-mini",
        ModelCapabilities(
            context_window=200_000,
            supports_tools=True,
            supports_vision=True,
            supports_thinking=True,
        ),
    ),
    (
        "o3-mini",
        ModelCapabilities(
            context_window=200_000,
            supports_tools=True,
            supports_vision=False,
            supports_thinking=True,
        ),
    ),
    (
        "o3",
        ModelCapabilities(
            context_window=200_000,
            supports_tools=True,
            supports_vision=True,
            supports_thinking=True,
        ),
    ),
    (
        "o1-mini",
        ModelCapabilities(
            context_window=128_000,
            supports_tools=False,
            supports_vision=False,
            supports_thinking=True,
        ),
    ),
    (
        "o1",
        ModelCapabilities(
            context_window=200_000,
            supports_tools=True,
            supports_vision=True,
            supports_thinking=True,
        ),
    ),
    (
        "gpt-4.1",
        ModelCapabilities(
            context_window=1_047_576,
            supports_tools=True,
            supports_vision=True,
            supports_thinking=False,
        ),
    ),
    (
        "gpt-3.5",
        ModelCapabilities(
            context_window=16_385,
            supports_tools=True,
            supports_vision=False,
            supports_thinking=False,
        ),
    ),
    (
        "dall-e",
        ModelCapabilities(
            context_window=4_096,
            supports_tools=False,
            supports_vision=True,
            supports_thinking=False,
        ),
    ),
    (
        "tts",
        ModelCapabilities(
            context_window=4_096,
            supports_tools=False,
            supports_vision=False,
            supports_thinking=False,
        ),
    ),
]

# Generous defaults for models not in the override map.
# Assumes modern models support tools and vision.
_DEFAULT_CAPABILITIES = ModelCapabilities(
    context_window=128_000,
    supports_tools=True,
    supports_vision=True,
    supports_thinking=False,
)


def get_capabilities(model_id: str) -> ModelCapabilities:
    """Look up capability metadata for a model ID.

    Matches by prefix so that versioned IDs (e.g. ``gpt-4o-2024-08-06``)
    resolve against the base entry (``gpt-4o``).  Unknown models get
    generous defaults (tools and vision enabled).

    Parameters
    ----------
    model_id : str
        The model identifier returned by the API.

    Returns
    -------
    ModelCapabilities
        Known capabilities, or generous defaults for unknown models.

    """
    for prefix, caps in _CAPABILITY_OVERRIDES:
        if model_id.startswith(prefix):
            return caps
    return _DEFAULT_CAPABILITIES


def format_display_name(model_id: str) -> str:
    """Format a model ID into a human-readable display name.

    Automatically capitalizes model IDs into readable names.  For IDs
    with a known base name, appends the version suffix in parentheses.
    Falls back to the raw model ID for unrecognized patterns.

    Parameters
    ----------
    model_id : str
        Model identifier.

    Returns
    -------
    str
        Formatted display name.

    """
    # Exact or prefix match against known display names
    for prefix, name in _KNOWN_DISPLAY_NAMES.items():
        if model_id == prefix:
            return name
        if model_id.startswith(prefix + "-"):
            suffix = model_id[len(prefix) + 1 :]
            return f"{name} ({suffix})"

    # Auto-format: uppercase "gpt" and "GPT", title-case the rest
    return model_id.replace("gpt-", "GPT-").replace("Gpt-", "GPT-")


# Known display name mappings for formatting model IDs.
_KNOWN_DISPLAY_NAMES: dict[str, str] = {
    "gpt-5.3": "GPT-5.3",
    "gpt-5.2-pro": "GPT-5.2 Pro",
    "gpt-5.2": "GPT-5.2",
    "gpt-5.1-codex-max": "GPT-5.1 Codex Max",
    "gpt-5.1-codex-mini": "GPT-5.1 Codex Mini",
    "gpt-5.1-codex": "GPT-5.1 Codex",
    "gpt-5.1": "GPT-5.1",
    "gpt-5-pro": "GPT-5 Pro",
    "gpt-5-nano": "GPT-5 Nano",
    "gpt-5-mini": "GPT-5 Mini",
    "gpt-5-codex": "GPT-5 Codex",
    "gpt-5-search-api": "GPT-5 Search API",
    "gpt-5": "GPT-5",
    "gpt-4o-mini": "GPT-4o Mini",
    "gpt-4o-search-preview": "GPT-4o Search",
    "gpt-4o": "GPT-4o",
    "gpt-4.1-nano": "GPT-4.1 Nano",
    "gpt-4.1-mini": "GPT-4.1 Mini",
    "gpt-4.1": "GPT-4.1",
    "gpt-4-turbo": "GPT-4 Turbo",
    "gpt-4": "GPT-4",
    "gpt-3.5-turbo": "GPT-3.5 Turbo",
    "gpt-audio-mini": "GPT Audio Mini",
    "gpt-audio": "GPT Audio",
    "gpt-realtime-mini": "GPT Realtime Mini",
    "gpt-realtime": "GPT Realtime",
    "gpt-image": "GPT Image",
    "dall-e-3": "DALL-E 3",
    "dall-e-2": "DALL-E 2",
    "o4-mini": "o4-mini",
    "o3-mini": "o3-mini",
    "o3": "o3",
    "o1-pro": "o1 Pro",
    "o1-mini": "o1 Mini",
    "o1": "o1",
    "chatgpt-image": "ChatGPT Image",
    "computer-use-preview": "Computer Use Preview",
    "sora-2-pro": "Sora 2 Pro",
    "sora-2": "Sora 2",
    "tts-1-hd": "TTS 1 HD",
    "tts-1": "TTS 1",
    "whisper-1": "Whisper 1",
}


def map_finish_reason(finish_reason: str | None) -> str:
    """Map OpenAI finish_reason to Anthropic-style stop_reason.

    Parameters
    ----------
    finish_reason : str | None
        OpenAI finish reason.

    Returns
    -------
    str
        Mapped stop reason ("end_turn", "tool_use", "max_tokens").

    """
    if finish_reason == "tool_calls":
        return "tool_use"
    if finish_reason == "length":
        return "max_tokens"
    if finish_reason == "stop":
        return "end_turn"
    return "end_turn"


# Static fallback catalog used when the API is unreachable.
FALLBACK_MODELS: list[ModelInfo] = [
    ModelInfo(
        id="gpt-5.2",
        display_name="GPT-5.2",
        provider="openai",
        context_window=128_000,
        supports_tools=True,
        supports_vision=True,
        supports_thinking=False,
    ),
    ModelInfo(
        id="gpt-5",
        display_name="GPT-5",
        provider="openai",
        context_window=128_000,
        supports_tools=True,
        supports_vision=True,
        supports_thinking=False,
    ),
    ModelInfo(
        id="gpt-4o",
        display_name="GPT-4o",
        provider="openai",
        context_window=128_000,
        supports_tools=True,
        supports_vision=True,
        supports_thinking=False,
    ),
    ModelInfo(
        id="gpt-4o-mini",
        display_name="GPT-4o Mini",
        provider="openai",
        context_window=128_000,
        supports_tools=True,
        supports_vision=True,
        supports_thinking=False,
    ),
    ModelInfo(
        id="o3",
        display_name="o3",
        provider="openai",
        context_window=200_000,
        supports_tools=True,
        supports_vision=True,
        supports_thinking=True,
    ),
    ModelInfo(
        id="o4-mini",
        display_name="o4-mini",
        provider="openai",
        context_window=200_000,
        supports_tools=True,
        supports_vision=True,
        supports_thinking=True,
    ),
]
