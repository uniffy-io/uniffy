"""OpenAI provider descriptor."""

from uniffy.domains.agents.providers.base import LLMProvider, ModelInfo, ProviderDescriptor
from uniffy.domains.agents.providers.catalog import model_infos_for_provider
from uniffy.domains.agents.providers.openai.provider import OpenAIProvider


class OpenAIDescriptor(ProviderDescriptor):
    """Bundles the OpenAI provider factory and model catalog."""

    @property
    def name(self) -> str:
        """Return the canonical provider name."""
        return "openai"

    @property
    def display_name(self) -> str:
        """Return the human-readable provider name."""
        return "OpenAI"

    def create(self, credential: str) -> LLMProvider:
        """Create an OpenAIProvider from a decrypted API key."""
        return OpenAIProvider(credential)

    def get_models(self) -> list[ModelInfo]:
        """Return the static OpenAI catalog (used when no live key is set)."""
        return model_infos_for_provider("openai")
