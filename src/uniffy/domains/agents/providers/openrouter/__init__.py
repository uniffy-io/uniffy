"""OpenRouter provider subpackage."""

from uniffy.domains.agents.providers.base import LLMProvider, ModelInfo, ProviderDescriptor
from uniffy.domains.agents.providers.catalog import model_infos_for_provider
from uniffy.domains.agents.providers.openrouter.provider import OpenRouterProvider


class OpenRouterDescriptor(ProviderDescriptor):
    """Bundles the OpenRouter provider factory and model catalog."""

    @property
    def name(self) -> str:
        return "openrouter"

    @property
    def display_name(self) -> str:
        return "OpenRouter"

    def create(self, credential: str) -> LLMProvider:
        return OpenRouterProvider(credential)

    def get_models(self) -> list[ModelInfo]:
        return model_infos_for_provider("openrouter")
