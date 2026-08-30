"""Anthropic provider descriptor."""

from uniffy.domains.agents.providers.anthropic.provider import AnthropicProvider
from uniffy.domains.agents.providers.base import LLMProvider, ModelInfo, ProviderDescriptor
from uniffy.domains.agents.providers.catalog import model_infos_for_provider


class AnthropicDescriptor(ProviderDescriptor):
    """Bundles the Anthropic provider factory and model catalog."""

    @property
    def name(self) -> str:
        """Return the canonical provider name."""
        return "anthropic"

    @property
    def display_name(self) -> str:
        """Return the human-readable provider name."""
        return "Anthropic"

    def create(self, credential: str) -> LLMProvider:
        """Create an AnthropicProvider from a decrypted API key."""
        return AnthropicProvider(credential)

    def get_models(self) -> list[ModelInfo]:
        """Return the static Anthropic catalog (used when no live key is set)."""
        return model_infos_for_provider("anthropic")
