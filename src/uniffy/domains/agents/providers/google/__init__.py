"""Google Gemini provider subpackage."""

from uniffy.domains.agents.providers.base import LLMProvider, ModelInfo, ProviderDescriptor
from uniffy.domains.agents.providers.catalog import model_infos_for_provider
from uniffy.domains.agents.providers.google.provider import GoogleProvider


class GoogleDescriptor(ProviderDescriptor):
    """Bundles the Google provider factory and model catalog."""

    @property
    def name(self) -> str:
        """Return the canonical provider name."""
        return "google"

    @property
    def display_name(self) -> str:
        """Return the human-readable provider name."""
        return "Google"

    def create(self, credential: str) -> LLMProvider:
        """Create a GoogleProvider from a decrypted API key."""
        return GoogleProvider(credential)

    def get_models(self) -> list[ModelInfo]:
        """Return the static Google catalog (used when no live key is set)."""
        return model_infos_for_provider("google")
