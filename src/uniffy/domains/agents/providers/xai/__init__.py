"""xAI provider subpackage."""

from uniffy.domains.agents.providers.base import LLMProvider, ModelInfo, ProviderDescriptor
from uniffy.domains.agents.providers.catalog import model_infos_for_provider
from uniffy.domains.agents.providers.xai.provider import XAIProvider


class XAIDescriptor(ProviderDescriptor):
    """Bundles the xAI provider factory and model catalog."""

    @property
    def name(self) -> str:
        return "xai"

    @property
    def display_name(self) -> str:
        return "xAI"

    def create(self, credential: str) -> LLMProvider:
        return XAIProvider(credential)

    def get_models(self) -> list[ModelInfo]:
        return model_infos_for_provider("xai")
