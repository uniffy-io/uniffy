"""xAI provider subpackage."""

from uniffy.domains.agents.providers.base import LLMProvider, ModelInfo, ProviderDescriptor
from uniffy.domains.agents.providers.catalog import model_infos_for_provider
from uniffy.domains.agents.providers.xai.provider import XAIProvider
from uniffy.domains.agents.providers.xai.validation import validate_xai_credential


class XAIDescriptor(ProviderDescriptor):
    """Bundles the xAI provider factory, model catalog, and credential validation."""

    @property
    def name(self) -> str:
        return "xai"

    @property
    def display_name(self) -> str:
        return "xAI"

    @property
    def supported_credential_types(self) -> list[str]:
        return ["api_key"]

    def create(self, credential: str, credential_type: str) -> LLMProvider:
        return XAIProvider(credential, credential_type=credential_type)

    def get_models(self) -> list[ModelInfo]:
        return model_infos_for_provider("xai")

    def validate_credential(self, credential: str, credential_type: str) -> None:
        validate_xai_credential(credential, credential_type)
