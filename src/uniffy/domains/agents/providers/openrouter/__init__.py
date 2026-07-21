"""OpenRouter provider subpackage."""

from uniffy.domains.agents.providers.base import LLMProvider, ModelInfo, ProviderDescriptor
from uniffy.domains.agents.providers.catalog import model_infos_for_provider
from uniffy.domains.agents.providers.openrouter.provider import OpenRouterProvider
from uniffy.domains.agents.providers.openrouter.validation import validate_openrouter_credential


class OpenRouterDescriptor(ProviderDescriptor):
    """Bundles the OpenRouter provider factory, model catalog, and credential validation."""

    @property
    def name(self) -> str:
        return "openrouter"

    @property
    def display_name(self) -> str:
        return "OpenRouter"

    @property
    def supported_credential_types(self) -> list[str]:
        return ["api_key"]

    def create(self, credential: str, credential_type: str) -> LLMProvider:
        return OpenRouterProvider(credential, credential_type=credential_type)

    def get_models(self) -> list[ModelInfo]:
        return model_infos_for_provider("openrouter")

    def validate_credential(self, credential: str, credential_type: str) -> None:
        validate_openrouter_credential(credential, credential_type)
